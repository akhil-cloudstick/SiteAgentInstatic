/**
 * Bundles the caller has handed us, held until an import names one.
 *
 * The mirror of the export download route, and needed for the same reason. A
 * finished bundle is ~1.7 MB — roughly 420,000 tokens as a tool argument, so it
 * cannot be passed inline — and `path` resolves on THIS host, on a share the
 * caller cannot write to. Without a route for bytes to travel inbound, the
 * agreed recovery mechanism is unexecutable: Instatic has no published-version
 * restore, so recovery is "re-import a known-good bundle and republish", and
 * that is precisely the operation with no route.
 *
 * Uploads are deliberately temporary. They are a transfer buffer, not storage:
 * the durable copy lives with whoever built the bundle, and keeping ours around
 * would accumulate whole copies of client sites on disk for no one's benefit.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Where uploaded bundles land. Configurable so it can point at shared storage. */
export const UPLOAD_DIR_ENV = 'MMS_CONNECTOR_UPLOAD_DIR'

/** How long an upload is retained. Overridable for tests and for slow pipelines. */
export const UPLOAD_TTL_ENV = 'MMS_CONNECTOR_UPLOAD_TTL_MS'

/** URL prefix uploads are POSTed to. Lives here for the same no-cycle reason as exports. */
export const UPLOAD_ROUTE = '/imports'

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

export type UploadKind = 'zip' | 'json'

export interface StoredUpload {
  uploadId: string
  path: string
  kind: UploadKind
  bytes: number
  sha256: string
  createdAt: number
  expiresAt: number
}

export function uploadDir(): string {
  const configured = process.env[UPLOAD_DIR_ENV]?.trim()
  return configured ? resolve(configured) : resolve(import.meta.dir, '../../uploads')
}

export function uploadTtlMs(): number {
  const raw = Number(process.env[UPLOAD_TTL_ENV])
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS
}

function ensureDir(): string {
  const dir = uploadDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

/** `<id>.meta.json` — kind and hash, so a later import need not re-derive them. */
function metaPathFor(file: string): string {
  return `${file}.meta.json`
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Delete uploads past their TTL.
 *
 * Called on every write and every read rather than on a timer: a timer keeps a
 * process alive and needs shutting down, and this store is only ever touched by
 * a request, so a request is the natural moment to tidy. Failures are ignored —
 * a file that will not delete is a housekeeping matter, not a reason to fail
 * the upload someone is waiting on.
 */
export function pruneExpiredUploads(now = Date.now()): number {
  const dir = uploadDir()
  if (!existsSync(dir)) return 0
  const ttl = uploadTtlMs()
  let removed = 0
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.meta.json')) continue
    const file = resolve(dir, name)
    try {
      if (now - statSync(file).mtimeMs <= ttl) continue
      rmSync(file, { force: true })
      rmSync(metaPathFor(file), { force: true })
      removed++
    } catch {
      // ignore — see above
    }
  }
  return removed
}

/**
 * Store one uploaded bundle.
 *
 * `expectedSha256` is verified BEFORE anything is written. A corrupted transfer
 * must be refused outright rather than stored and then discovered by an import
 * halfway through replacing a site's contents.
 */
export function saveUpload(
  bytes: Uint8Array,
  kind: UploadKind,
  options: { expectedSha256?: string; now?: number } = {},
): { ok: true; upload: StoredUpload } | { ok: false; reason: string } {
  const sha256 = sha256Of(bytes)
  const expected = options.expectedSha256?.trim().toLowerCase()
  if (expected && expected !== sha256) {
    return {
      ok: false,
      reason:
        `Upload rejected: sha256 mismatch. Expected ${expected}, received ${sha256}. ` +
        'The bytes did not arrive intact, so nothing was stored.',
    }
  }

  const now = options.now ?? Date.now()
  pruneExpiredUploads(now)
  const dir = ensureDir()

  // Name carries the hash, not a counter: two uploads of the same bytes are
  // interchangeable, and a caller retrying after a timeout should not litter
  // the directory with copies.
  const uploadId = `upload-${sha256.slice(0, 16)}.${kind}`
  const file = resolve(dir, uploadId)
  writeFileSync(file, bytes)

  const upload: StoredUpload = {
    uploadId,
    path: file,
    kind,
    bytes: bytes.length,
    sha256,
    createdAt: now,
    expiresAt: now + uploadTtlMs(),
  }
  writeFileSync(metaPathFor(file), JSON.stringify({ kind, sha256, createdAt: now }))
  return { ok: true, upload }
}

export type UploadLookup =
  | { ok: true; upload: StoredUpload; bytes: Uint8Array }
  | { ok: false; reason: string }

/**
 * Resolve an `uploadId` to its bytes, refusing anything that escapes the
 * directory or has expired.
 *
 * Two containment checks, same reasoning as the export store: the character
 * class gives the clear message, the resolved-path check is what actually
 * holds if the first is ever loosened.
 */
export function resolveUpload(id: string, now = Date.now()): UploadLookup {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    return { ok: false, reason: 'uploadId contains characters that are not allowed in a file name.' }
  }
  const dir = uploadDir()
  const file = resolve(dir, id)
  if (!file.startsWith(resolve(dir))) {
    return { ok: false, reason: 'uploadId resolves outside the upload directory.' }
  }
  if (!existsSync(file)) {
    return {
      ok: false,
      reason:
        `No upload named "${id}" is held. It may have expired — uploads are kept for ` +
        `${Math.round(uploadTtlMs() / 3_600_000)}h — or it was never received. Upload it again.`,
    }
  }

  const createdAt = statSync(file).mtimeMs
  if (now - createdAt > uploadTtlMs()) {
    // Expired but not yet pruned. Refused on age rather than served, so the
    // TTL means the same thing whether or not a prune has run since.
    rmSync(file, { force: true })
    rmSync(metaPathFor(file), { force: true })
    return { ok: false, reason: `Upload "${id}" has expired. Upload it again.` }
  }

  const bytes = new Uint8Array(readFileSync(file))
  let kind: UploadKind = id.endsWith('.json') ? 'json' : 'zip'
  let sha256 = ''
  try {
    const meta = JSON.parse(readFileSync(metaPathFor(file), 'utf8')) as { kind?: UploadKind; sha256?: string }
    if (meta.kind) kind = meta.kind
    if (meta.sha256) sha256 = meta.sha256
  } catch {
    // Sidecar missing or unreadable — derive rather than fail. The bytes are
    // the artefact; the sidecar is a convenience.
  }

  return {
    ok: true,
    bytes,
    upload: {
      uploadId: id,
      path: file,
      kind,
      bytes: bytes.length,
      sha256: sha256 || sha256Of(bytes),
      createdAt,
      expiresAt: createdAt + uploadTtlMs(),
    },
  }
}

// ---------------------------------------------------------------------------
// Uploads in parts — for a caller that can send tool arguments but not HTTP
// ---------------------------------------------------------------------------

/** Largest decoded part accepted. A caller sending base64 through tool arguments will use far less. */
export const UPLOAD_PART_MAX_BYTES = 8 * 1024 * 1024

/** Most parts one upload may be split into. */
export const UPLOAD_MAX_PARTS = 2000

export type UploadPartResult =
  | { ok: true; done: false; parts: number; received: number[]; missing: number[]; expiresAt: number }
  | { ok: true; done: true; parts: number; upload: StoredUpload }
  | { ok: false; reason: string }

/** Where incomplete part sets wait — inside the upload directory, so they move with it. */
function partsRoot(): string {
  return resolve(uploadDir(), '.parts')
}

const partFile = (setDir: string, part: number): string =>
  resolve(setDir, `part-${String(part).padStart(4, '0')}.bin`)

/**
 * Discard part sets not completed within the upload TTL.
 *
 * Same trigger as `pruneExpiredUploads` — a request, not a timer — and the same
 * attitude to failure: a directory that will not delete is housekeeping, never
 * a reason to refuse the part someone is sending.
 */
export function pruneExpiredPartSets(now = Date.now()): number {
  const root = partsRoot()
  if (!existsSync(root)) return 0
  let removed = 0
  for (const name of readdirSync(root)) {
    const setDir = resolve(root, name)
    try {
      if (now - statSync(setDir).mtimeMs <= uploadTtlMs()) continue
      rmSync(setDir, { recursive: true, force: true })
      removed++
    } catch {
      // ignore — see above
    }
  }
  return removed
}

/**
 * Receive one part of a bundle; on the last one, reassemble, verify and store it.
 *
 * The inbound mirror of `connector_export_bundle`'s parts, for a caller whose
 * only channel is tool arguments. Every check runs before anything is written —
 * the B0.6d lesson — so a refused call leaves nothing behind.
 *
 * A part set is keyed by the whole bundle's sha256 and its part count, not by a
 * session id the caller has to carry: parts can arrive in any order, a lost
 * response can simply be resent, and two calls for the same bytes can only ever
 * build the same bundle. The finished bundle goes through `saveUpload`, so it is
 * exactly what `POST /imports` would have stored.
 */
export function saveUploadPart(
  input: { sha256: string; parts: number; part: number; data: Uint8Array; kind?: UploadKind },
  now = Date.now(),
): UploadPartResult {
  const sha256 = input.sha256.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    return { ok: false, reason: 'sha256 must be the 64-hex sha256 of the WHOLE bundle. Nothing was stored.' }
  }
  if (!Number.isInteger(input.parts) || input.parts < 1 || input.parts > UPLOAD_MAX_PARTS) {
    return { ok: false, reason: `parts must be a whole number from 1 to ${UPLOAD_MAX_PARTS}. Nothing was stored.` }
  }
  if (!Number.isInteger(input.part) || input.part < 1 || input.part > input.parts) {
    return { ok: false, reason: `part must be a whole number from 1 to ${input.parts}. Nothing was stored.` }
  }
  if (input.data.length === 0) return { ok: false, reason: 'This part is empty. Nothing was stored.' }
  if (input.data.length > UPLOAD_PART_MAX_BYTES) {
    return {
      ok: false,
      reason:
        `This part is ${input.data.length} bytes; the limit is ${UPLOAD_PART_MAX_BYTES} per part. ` +
        'Split the bundle into more parts. Nothing was stored.',
    }
  }

  pruneExpiredPartSets(now)
  const setDir = resolve(partsRoot(), `${sha256}-${input.parts}`)
  const file = partFile(setDir, input.part)
  if (existsSync(file)) {
    // A resend after a lost response is fine; a different part under the same
    // number is how a corrupted bundle gets assembled, so it is refused.
    if (sha256Of(new Uint8Array(readFileSync(file))) !== sha256Of(input.data)) {
      return {
        ok: false,
        reason:
          `Part ${input.part} was already received with different bytes. Nothing was stored. If the ` +
          'bundle itself changed, it has a new sha256 — send its parts under that.',
      }
    }
  } else {
    mkdirSync(setDir, { recursive: true })
    writeFileSync(file, input.data)
  }

  const received: number[] = []
  const missing: number[] = []
  for (let p = 1; p <= input.parts; p++) (existsSync(partFile(setDir, p)) ? received : missing).push(p)
  if (missing.length > 0) {
    return { ok: true, done: false, parts: input.parts, received, missing, expiresAt: now + uploadTtlMs() }
  }

  const chunks = received.map((p) => new Uint8Array(readFileSync(partFile(setDir, p))))
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }

  const discard = (reason: string): UploadPartResult => {
    rmSync(setDir, { recursive: true, force: true })
    return { ok: false, reason }
  }

  const actual = sha256Of(bytes)
  if (actual !== sha256) {
    return discard(
      `All ${input.parts} parts arrived, but they reassemble to sha256 ${actual}, not ${sha256}. ` +
        'The parts were discarded and nothing was stored. Check each part number and its bytes, then ' +
        'send them again.',
    )
  }

  let kind: UploadKind
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    kind = 'zip'
  } else {
    try {
      JSON.parse(new TextDecoder().decode(bytes))
      kind = 'json'
    } catch {
      return discard('The reassembled bytes are neither a ZIP archive nor JSON, so they are not a site bundle. Nothing was stored.')
    }
  }
  if (input.kind && input.kind !== kind) {
    return discard(`kind says ${input.kind}, but the reassembled bytes are ${kind}. Nothing was stored.`)
  }

  const stored = saveUpload(bytes, kind, { expectedSha256: sha256, now })
  rmSync(setDir, { recursive: true, force: true })
  if (!stored.ok) return { ok: false, reason: stored.reason }
  return { ok: true, done: true, parts: input.parts, upload: stored.upload }
}
