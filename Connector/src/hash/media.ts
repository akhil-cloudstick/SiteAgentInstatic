/**
 * Media digest — byte-level, not id-level.
 *
 * Rows can reference media whose bytes changed while the media id and every cell
 * value stayed identical. An id-level digest would not notice, and the site
 * would publish different images than the ones that were approved.
 */

import { createHash } from 'node:crypto'
import { canonicalJson } from './canonical'

export interface MediaHashEntry {
  mediaId: string
  byteSha256: string
}

export function mediaBytesHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function mediaDigest(
  assets: readonly { mediaId: string; bytes: Uint8Array }[],
): { digest: string; entries: MediaHashEntry[] } {
  const entries: MediaHashEntry[] = assets
    .map((a) => ({ mediaId: a.mediaId, byteSha256: mediaBytesHash(a.bytes) }))
    .sort((a, b) => (a.mediaId < b.mediaId ? -1 : a.mediaId > b.mediaId ? 1 : 0))

  const digest = createHash('sha256').update(canonicalJson(entries)).digest('hex')
  return { digest, entries }
}
