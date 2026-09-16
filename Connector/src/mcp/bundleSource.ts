/**
 * Turn "which bundle" into bytes and, where possible, a previewable object.
 *
 * Four ways a caller can name a bundle — inline JSON, a path on this host, an
 * `uploadId` they sent us, or the sha256 of an artefact on the relay — and two
 * things the CMS wants: a JSON object for the dry run, raw archive bytes for an
 * import that carries media. Resolving that in one place keeps
 * `preview_import`, `import_replace` and `import_archive` agreeing about what a
 * bundle is.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { resolveUpload, saveUpload, sha256Of, UPLOAD_ROUTE, type UploadKind } from './uploadStore'
import { callerRootUrl } from './requestContext'
import { fetchRelayArtefact } from '../http/relay'

/**
 * Where to send a bundle, addressed to whoever is asking.
 *
 * Attached to the "no source given" refusal so the route is discoverable at the
 * moment a caller needs it, rather than only in a document they would have to
 * already know exists.
 */
export function uploadHint(): string {
  const root = callerRootUrl()
  const post = root
    ? `POST the bundle to ${root}${UPLOAD_ROUTE} with your bearer token, then pass the uploadId it returns`
    : `POST the bundle to ${UPLOAD_ROUTE} with your bearer token, then pass the uploadId it returns`
  return `${post} — or upload it to the relay and pass its sha256 as relaySha256.`
}

/** The manifest path inside a site bundle — the JSON everything else is derived from. */
export const MANIFEST_PATH = '.instatic/site-bundle.json'

/** Media bytes live under this prefix inside a bundle archive. */
export const MEDIA_PREFIX = 'media/'

/** The `relaySha256` tool argument, shared so every import tool describes it identically. */
export const RELAY_SHA256_PROP = {
  type: 'string',
  description:
    'Or the sha256 of a bundle artefact held on the relay — the route for a real site, since nothing is ' +
    'typed through arguments. The Connector fetches the bytes from the relay itself, verifies they hash ' +
    'to exactly this, and keeps them as an upload for the retention period, so a preview and the import ' +
    'after it fetch once. On a gated target the GO names this same sha256.',
} as const

export interface ResolvedBundle {
  /** Archive bytes, when the source was a ZIP. Absent for inline JSON. */
  archive?: Uint8Array
  /** A previewable bundle object. Always present — a ZIP's manifest is extracted. */
  bundle: unknown
  /** Media files carried in the archive, counted from its entries. */
  mediaFilesInArchive: number
  /** Where this came from, for the response so a caller can see what was used. */
  source: string
  /**
   * sha256 of the transferred bytes — what an owner's GO is signed over.
   * Absent for an inline bundle: a parsed object has no single byte form, so
   * there is nothing a signature could be bound to.
   */
  sha256?: string
}

export type BundleResolution =
  | { ok: true; value: ResolvedBundle }
  | { ok: false; reason: string }

/**
 * Read a ZIP's manifest as something the preview endpoint accepts.
 *
 * `media` is dropped deliberately. In an archive it is metadata — the bytes are
 * separate `media/` entries — whereas a JSON bundle carries the bytes inline,
 * so the two schemas disagree on that one field. Passing archive metadata to a
 * preview expecting embedded bytes is how a dry run fails for a reason that has
 * nothing to do with the caller's content. The file count is reported alongside
 * instead, so nothing is silently hidden.
 */
export function bundleFromArchive(archive: Uint8Array): BundleResolution {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(archive)
  } catch (err) {
    return { ok: false, reason: `Not a readable ZIP archive: ${err instanceof Error ? err.message : String(err)}` }
  }

  const manifest = entries[MANIFEST_PATH]
  if (!manifest) {
    return {
      ok: false,
      reason: `The archive has no ${MANIFEST_PATH}, so it is not a site bundle.`,
    }
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(strFromU8(manifest)) as Record<string, unknown>
  } catch (err) {
    return { ok: false, reason: `${MANIFEST_PATH} is not valid JSON: ${err instanceof Error ? err.message : String(err)}` }
  }

  const { media: _archiveMediaMetadata, ...previewable } = parsed
  return {
    ok: true,
    value: {
      archive,
      bundle: previewable,
      mediaFilesInArchive: Object.keys(entries).filter((e) => e.startsWith(MEDIA_PREFIX)).length,
      source: 'archive manifest',
    },
  }
}

/**
 * Resolve whichever of `bundle` / `path` / `uploadId` the caller supplied.
 *
 * Exactly one is required. Accepting several and picking a winner would mean a
 * caller who passed both a stale inline bundle and a fresh uploadId gets the
 * wrong one imported, with nothing in the response to show which.
 */
export function resolveBundleSource(args: {
  bundle?: unknown
  path?: string
  uploadId?: string
}): BundleResolution {
  const hasBundle = args.bundle !== undefined && args.bundle !== null
  const hasPath = typeof args.path === 'string' && args.path.trim() !== ''
  const hasUpload = typeof args.uploadId === 'string' && args.uploadId.trim() !== ''
  const given = [hasBundle, hasPath, hasUpload].filter(Boolean).length

  if (given === 0) {
    return {
      ok: false,
      reason: `Provide exactly one of bundle, uploadId or path. None was given. ${uploadHint()}`,
    }
  }
  if (given > 1) {
    return {
      ok: false,
      reason:
        'Provide exactly one of bundle, uploadId or path. More than one was given, and guessing ' +
        'which to import is how the wrong content lands on a site.',
    }
  }

  if (hasBundle) {
    return {
      ok: true,
      value: { bundle: args.bundle, mediaFilesInArchive: 0, source: 'inline bundle' },
    }
  }

  if (hasUpload) {
    const found = resolveUpload(args.uploadId!.trim())
    if (!found.ok) return { ok: false, reason: found.reason }
    // Hashed from the bytes, not from the upload's sidecar: the sidecar is a
    // convenience, and a GO must bind what is actually about to be imported.
    const sha256 = sha256Of(found.bytes)
    if (found.upload.kind === 'json') {
      try {
        return {
          ok: true,
          value: {
            bundle: JSON.parse(new TextDecoder().decode(found.bytes)),
            mediaFilesInArchive: 0,
            source: `upload ${found.upload.uploadId}`,
            sha256,
          },
        }
      } catch (err) {
        return { ok: false, reason: `Upload is not valid JSON: ${err instanceof Error ? err.message : String(err)}` }
      }
    }
    const fromArchive = bundleFromArchive(found.bytes)
    if (!fromArchive.ok) return fromArchive
    return { ok: true, value: { ...fromArchive.value, source: `upload ${found.upload.uploadId}`, sha256 } }
  }

  let archive: Uint8Array
  try {
    archive = new Uint8Array(readFileSync(resolve(args.path!.trim())))
  } catch (err) {
    return { ok: false, reason: `Could not read ${args.path}: ${err instanceof Error ? err.message : String(err)}` }
  }
  const fromArchive = bundleFromArchive(archive)
  if (!fromArchive.ok) return fromArchive
  return { ok: true, value: { ...fromArchive.value, source: `path ${args.path}`, sha256: sha256Of(archive) } }
}

/** An upload already holding exactly these bytes — how a preview and its import share one fetch. */
function heldUploadFor(sha256: string): string | null {
  for (const kind of ['zip', 'json'] as const) {
    const found = resolveUpload(`upload-${sha256.slice(0, 16)}.${kind}`)
    if (found.ok && sha256Of(found.bytes) === sha256) return found.upload.uploadId
  }
  return null
}

/**
 * `resolveBundleSource`, plus the relay: `relaySha256` names a bundle artefact
 * the relay holds, and the Connector fetches it.
 *
 * Still exactly one source. The fetched bytes are hashed on arrival and kept
 * as an ordinary upload, then resolved through the same path an `uploadId`
 * takes — so a relay bundle is previewed, imported and bound to a GO exactly
 * like one sent to `/imports`.
 */
export async function resolveBundleSourceWithRelay(args: {
  bundle?: unknown
  path?: string
  uploadId?: string
  relaySha256?: string
}): Promise<BundleResolution> {
  const relaySha256 = args.relaySha256?.trim().toLowerCase()
  if (!relaySha256) return resolveBundleSource(args)

  const others = [
    args.bundle !== undefined && args.bundle !== null,
    typeof args.path === 'string' && args.path.trim() !== '',
    typeof args.uploadId === 'string' && args.uploadId.trim() !== '',
  ].filter(Boolean).length
  if (others > 0) {
    return {
      ok: false,
      reason:
        'Provide exactly one of bundle, uploadId, path or relaySha256. More than one was given, and ' +
        'guessing which to import is how the wrong content lands on a site.',
    }
  }
  if (!/^[0-9a-f]{64}$/.test(relaySha256)) {
    return { ok: false, reason: 'relaySha256 must be the 64-hex sha256 of an artefact held on the relay.' }
  }

  let uploadId = heldUploadFor(relaySha256)
  const fetched = uploadId === null
  if (uploadId === null) {
    const got = await fetchRelayArtefact(relaySha256)
    if (!got.ok) return { ok: false, reason: got.reason }

    let kind: UploadKind = 'zip'
    if (!(got.bytes[0] === 0x50 && got.bytes[1] === 0x4b)) {
      try {
        JSON.parse(new TextDecoder().decode(got.bytes))
        kind = 'json'
      } catch {
        return { ok: false, reason: `Relay artefact ${relaySha256} is neither a ZIP archive nor JSON, so it is not a site bundle.` }
      }
    }
    const stored = saveUpload(got.bytes, kind, { expectedSha256: relaySha256 })
    if (!stored.ok) return { ok: false, reason: stored.reason }
    uploadId = stored.upload.uploadId
  }

  const resolved = resolveBundleSource({ uploadId })
  if (!resolved.ok) return resolved
  return {
    ok: true,
    value: {
      ...resolved.value,
      source: `relay artefact ${relaySha256} (${fetched ? 'fetched from the relay' : 'already held'} as upload ${uploadId})`,
      sha256: relaySha256,
    },
  }
}
