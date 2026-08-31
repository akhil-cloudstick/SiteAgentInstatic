/**
 * Row hashes — the content half of the approval binding.
 *
 * The document hash covers the site, its pages, templates and components. It
 * does not cover the post rows, so binding only the document would let every
 * post body change between approval and release with the check still passing.
 *
 * Two distinct things live here:
 *   - the per-row hash, which the release sends as `If-Match` on each row
 *     publish and the server re-checks inside its transaction;
 *   - the aggregate digest, which proves the approved SET is unchanged (no rows
 *     added or removed) and is what the approval record binds.
 *
 * A client-side aggregate can never replace the per-row server check: it proves
 * what the CLI saw, not what the server is about to publish.
 */

import { createHash } from 'node:crypto'
import { canonicalJson, dataRowContentHash } from './canonical'

export interface HashableRow {
  id: string
  tableId: string
  slug: string
  cells: unknown
  authorUserId?: string | null
}

export interface RowHashEntry {
  rowId: string
  expectedRowHash: string
}

export function rowHash(row: HashableRow): string {
  return dataRowContentHash(row)
}

/**
 * Deterministic digest over the approved row set.
 *
 * Sorted bytewise by rowId so the digest is independent of the order rows were
 * discovered in — otherwise re-running ingest against the same source could
 * produce a different digest and invalidate a valid approval.
 */
export function rowsDigest(rows: readonly HashableRow[]): {
  digest: string
  entries: RowHashEntry[]
} {
  const entries: RowHashEntry[] = rows
    .map((row) => ({ rowId: row.id, expectedRowHash: rowHash(row) }))
    .sort((a, b) => (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0))

  const digest = createHash('sha256').update(canonicalJson(entries)).digest('hex')
  return { digest, entries }
}
