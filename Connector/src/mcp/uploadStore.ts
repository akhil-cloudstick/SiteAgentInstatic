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
