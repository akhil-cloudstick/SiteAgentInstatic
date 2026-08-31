/**
 * Instatic CMS operations the connector performs.
 *
 * Two endpoint rules are enforced here rather than left to the caller, because
 * getting either wrong produces a confusing failure:
 *
 *   - JSON bundles go to `/import`; ZIP archives go to `/import/archive`. The
 *     server rejects an archive posted to the JSON endpoint and names the right
 *     door, but only after you have uploaded the whole thing.
 *   - Preview is a separate endpoint, not a flag. Adding `?dryRun=1` to
 *     `/import` does not preview — it imports, and the flag is ignored.
 */

import type { InstaticSession } from './session'

export type ImportStrategy = 'replace' | 'merge-add' | 'merge-overwrite'

export interface ImportPreview {
  meta: { exportedAt: string; sourceSiteName?: string; schemaVersion: number }
  tables: {
    id: string
    name: string
    kind: string
    inBundle: number
    willReplace: number
    willAdd: number
    currentLocal: number
  }[]
  totals: {
    rows: number
    mediaFiles: number
    mediaEmbedded: number
    mediaFolders: number
    redirects: number
  }
}

export interface ImportResult {
  ok: true
  strategy: ImportStrategy
  tablesAffected: number
  rowsInserted: number
  rowsReplaced: number
  rowsSkipped: number
  mediaImported: number
  mediaFoldersImported: number
  redirectsImported: number
}

/**
 * Dry run. Writes nothing, and is the only honest way to answer "what would this
 * do" before doing it.
 */
export async function previewBundle(
  session: InstaticSession,
  bundle: unknown,
): Promise<ImportPreview> {
  const res = await session.request('/import/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bundle),
    context: 'import preview',
  })
  return (await res.json()) as ImportPreview
}

/**
 * Import a JSON bundle as DRAFT state.
 *
 * This does not publish. Rows land in the database without an active version, so
 * nothing becomes publicly visible until a separate release step runs. That
 * separation is deliberate: it is what makes the result reviewable before it is
 * live, and reversible if it is wrong.
 */
/**
 * Import a JSON bundle.
 *
 * All three strategies are available here. The guard against an accidental
 * `replace` lives at the tool layer, not in this function: a low-level client
 * that refuses a strategy the server supports is the wrong place to enforce
 * policy, and it made the ZIP and JSON paths behave differently for no reason.
 *
 * `replace` is also the only strategy that carries redirects and media folders —
 * the merge strategies silently skip both.
 */
export async function importBundle(
  session: InstaticSession,
  bundle: unknown,
  strategy: ImportStrategy = 'merge-overwrite',
): Promise<ImportResult> {
  const res = await session.request(`/import?strategy=${strategy}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bundle),
    context: `import (${strategy})`,
  })
  return (await res.json()) as ImportResult
}

/** Import a ZIP archive as DRAFT state. Different endpoint from the JSON path. */
export async function importArchive(
  session: InstaticSession,
  zipBytes: Uint8Array,
  strategy: ImportStrategy = 'merge-overwrite',
): Promise<ImportResult> {
  const res = await session.request(`/import/archive?strategy=${strategy}`, {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: zipBytes as unknown as BodyInit,
    context: `import archive (${strategy})`,
  })
  return (await res.json()) as ImportResult
}

/**
 * Export the current site as a ZIP.
 *
 * `includeMedia` is requested explicitly because the endpoint defaults it to
 * FALSE while defaulting site, media folders and redirects to true. Omitting it
 * produces an archive that looks complete — right table and row counts — with
 * every image silently missing, which is the worst kind of wrong for something
 * meant to be diffed or kept as a snapshot.
 */
export async function exportBundle(
  session: InstaticSession,
  options: { includeMedia?: boolean } = {},
): Promise<Uint8Array> {
  const includeMedia = options.includeMedia !== false
  const res = await session.request(`/export?includeMedia=${includeMedia ? '1' : '0'}`, {
    method: 'GET',
    context: 'export',
  })
  return new Uint8Array(await res.arrayBuffer())
}
