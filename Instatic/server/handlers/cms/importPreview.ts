/**
 * Import preview endpoint.
 *
 *   POST /cms/api/cms/import/preview
 *
 * Accepts a `SiteBundle` body and returns a read-only diff (`BundlePreview`)
 * that describes what a subsequent import would do — without actually changing
 * any data. The operator uses this to review the bundle contents before
 * committing an import.
 *
 * For each table in the bundle the preview reports:
 *   - `inBundle`     — how many rows the bundle carries for this table
 *   - `willReplace`  — bundle rows whose id already exists locally
 *   - `willAdd`      — bundle rows whose id does not exist locally
 *   - `currentLocal` — how many rows the local table currently has
 *
 * It also reports `unknownFields`: cells the bundle carries for fields the
 * destination table does not define. The import accepts those cells and stores
 * them, but nothing ever reads them back, so a bundle can import "cleanly" and
 * still lose every value it was sent to deliver. Preview is the last point that
 * mismatch is cheap to fix.
 *
 * Requires `data.export` capability (paired with the actual export
 * endpoint — preview is the read-only dry-run that precedes import).
 */
import type { DbClient } from '../../db/client'
import { requireCapability } from '../../auth/authz'
import { listDataRows } from '../../repositories/data/rows'
import { listDataTables } from '../../repositories/data/tables'
import { jsonResponse, readValidatedBody } from '../../http'
import { parseValue } from '@core/utils/typeboxHelpers'
import {
  SiteBundleSchema,
  BundlePreviewSchema,
  type BundlePreview,
  type BundleRowConflict,
  type BundleUnknownField,
  type BundleUnresolvedClass,
  type SiteBundle,
} from '@core/data/bundleSchema'
import type { DataRow, DataTable } from '@core/data/schemas'
import { CMS_API_PREFIX } from './shared'
import { InvalidImportStrategyError, resolveImportStrategy } from './importStrategy'

export async function handleImportPreviewRoute(
  req: Request,
  db: DbClient,
): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== `${CMS_API_PREFIX}/import/preview`) return null
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 })

  const user = await requireCapability(req, db, 'data.export')
  if (user instanceof Response) return user

  const bundle = await readValidatedBody(req, SiteBundleSchema)
  if (!bundle) {
    return jsonResponse({ error: 'Invalid bundle: body does not conform to SiteBundleSchema' }, { status: 400 })
  }

  // Which strategy this preview is FOR — resolved by the SAME reader the import
  // endpoints use, so an absent parameter means here exactly what it means
  // there. Preview previously read an absent value as a merge while both import
  // endpoints read it as `replace`, so a default preview reported a row-by-row
  // diff for a run that actually wipes the site first.
  //
  // `replace` deletes every row before inserting, so nothing survives to
  // collide with. Reporting slug conflicts for it was not merely noise: it read
  // as "your homepage will be renamed to index-2", which an operator would
  // either abort on or accept and end up with no page at `/`. The wipe is what
  // the preview must diff against, not the rows the wipe is about to remove.
  let isReplace: boolean
  try {
    isReplace = resolveImportStrategy(url) === 'replace'
  } catch (err) {
    if (!(err instanceof InvalidImportStrategyError)) throw err
    return jsonResponse({ error: err.message }, { status: 400 })
  }

  // Fetch current local tables to know which ones exist
  const localTables = await listDataTables(db)
  const localTableIds = new Set(localTables.map((t) => t.id))

  const rowConflicts: BundleRowConflict[] = []
  const unknownFields: BundleUnknownField[] = []
  const localTablesById = new Map(localTables.map((t) => [t.id, t]))

  // For each bundle table, compute the diff against local row ids and active slugs.
  const tableEntries = await Promise.all(
    bundle.tables.map(async (table) => {
      // Rows in the bundle for this table
      const bundleRowsForTable = bundle.rows
        .filter((r) => r.tableId === table.id)
      const bundleRowIdsForTable = bundleRowsForTable.map((r) => r.id)

      // Local rows for this table (0 if the table doesn't exist locally yet).
      // Under `replace` the local side is empty by the time anything is
      // inserted, so the diff is taken against nothing — otherwise every count
      // describes a state that will not exist when the import runs.
      let localRows: DataRow[]
      if (!isReplace && localTableIds.has(table.id)) {
        localRows = await listDataRows(db, table.id)
      } else {
        localRows = []
      }
      const localRowIds = new Set(localRows.map((r) => r.id))
      rowConflicts.push(...findRowSlugConflicts(table, bundleRowsForTable, localRows))
      unknownFields.push(
        ...findUnknownFields(table, localTablesById.get(table.id), bundleRowsForTable),
      )

      const willReplace = bundleRowIdsForTable.filter((id) => localRowIds.has(id)).length
      const willAdd = bundleRowIdsForTable.filter((id) => !localRowIds.has(id)).length

      return {
        id: table.id,
        name: table.name,
        kind: table.kind,
        inBundle: bundleRowIdsForTable.length,
        willReplace,
        willAdd,
        currentLocal: localRowIds.size,
      }
    }),
  )

  const unresolvedClasses = findUnresolvedClasses(bundle)

  // What the run destroys that no count above mentions. Only `replace` clears
  // the published version, and it does so silently: the rows come back from the
  // bundle, the published version does not come back from anything.
  const destructiveEffects: string[] = []
  if (isReplace) {
    destructiveEffects.push(
      'Clears the published version: the site stops being published and every '
        + 'public URL serves whatever was last deployed until a new publish runs. '
        + 'The admin shows no sign of this.',
    )
    destructiveEffects.push(
      'Deletes every row, every non-system table, all media folders and all '
        + 'redirects. Anything the bundle does not carry is not restored.',
    )
  }

  const preview: BundlePreview = {
    meta: {
      exportedAt: bundle.exportedAt,
      sourceSiteName: bundle.sourceSiteName ?? null,
      schemaVersion: bundle.schemaVersion,
    },
    tables: tableEntries,
    rowConflicts,
    unknownFields,
    totals: {
      rows: bundle.rows.length,
      mediaFiles: bundle.media?.length ?? 0,
      mediaEmbedded: (bundle.media?.length ?? 0) > 0,
      mediaFolders: bundle.mediaFolders?.length ?? 0,
      redirects: bundle.redirects?.length ?? 0,
    },
    unresolvedClasses,
    destructiveEffects,
  }

  // Paranoia: validate the shape before returning
  parseValue(BundlePreviewSchema, preview)

  return jsonResponse(preview)
}

/**
 * Cells in the bundle addressed to fields that will not exist after the import.
 *
 * The importer writes `cells` verbatim, so these arrive, persist, and are then
 * invisible to every reader — nothing errors and nothing renders. Counting them
 * here turns a clean-looking preview into an actionable one: the sender learns
 * to add the field (or ship the table definition) before committing the import.
 *
 * Checked against the union of the bundle's own table definition and the local
 * one, because a bundle that carries a table carries its fields too — `replace`
 * and `merge-overwrite` both apply them. Comparing against the local schema
 * alone would flag every field the bundle is in the middle of adding, which
 * would fire on exactly the well-formed bundles this is supposed to wave
 * through. The residue it still catches is the real fault: a cell addressed to
 * a field that neither side defines.
 *
 * `merge-add` is the one gap — it leaves an existing table's fields alone, so a
 * field only the bundle declares will not be created and its cells will be
 * stored unread. Preview does not receive the strategy, and under-warning on
 * the rarest strategy beats crying wolf on the common ones.
 */
export function findUnknownFields(
  bundleTable: DataTable,
  localTable: DataTable | undefined,
  bundleRows: DataRow[],
): BundleUnknownField[] {
  const table = localTable ?? bundleTable
  const knownFieldIds = new Set([
    ...bundleTable.fields.map((field) => field.id),
    ...(localTable?.fields ?? []).map((field) => field.id),
  ])
  const rowCountByFieldId = new Map<string, number>()

  for (const row of bundleRows) {
    for (const fieldId of Object.keys(row.cells)) {
      if (knownFieldIds.has(fieldId)) continue
      rowCountByFieldId.set(fieldId, (rowCountByFieldId.get(fieldId) ?? 0) + 1)
    }
  }

  return [...rowCountByFieldId]
    .map(([fieldId, rowCount]) => ({
      tableId: table.id,
      tableName: table.name,
      fieldId,
      rowCount,
    }))
    .toSorted((a, b) => b.rowCount - a.rowCount || a.fieldId.localeCompare(b.fieldId))
}

function findRowSlugConflicts(
  table: DataTable,
  bundleRows: DataRow[],
  localRows: DataRow[],
): BundleRowConflict[] {
  const localRowsBySlug = new Map(
    localRows
      .filter((row) => row.slug)
      .map((row) => [row.slug, row]),
  )
  const reservedSlugs = new Set([
    ...localRowsBySlug.keys(),
    ...bundleRows.map((row) => row.slug).filter((slug) => slug.length > 0),
  ])
  const conflicts: BundleRowConflict[] = []

  for (const row of bundleRows) {
    const localRow = row.slug ? localRowsBySlug.get(row.slug) : undefined
    if (!localRow || localRow.id === row.id) continue
    conflicts.push({
      tableId: table.id,
      tableName: table.name,
      rowId: row.id,
      rowTitle: rowTitle(row, table.primaryFieldId),
      slug: row.slug,
      existingRowId: localRow.id,
      suggestedSlug: nextAvailableSlug(row.slug, reservedSlugs),
    })
  }

  return conflicts
}

function rowTitle(row: DataRow, primaryFieldId: string): string {
  const primary = row.cells[primaryFieldId]
  if (typeof primary === 'string' && primary.trim()) return primary
  return row.slug || row.id
}

function nextAvailableSlug(slug: string, reservedSlugs: Set<string>): string {
  let index = 2
  let candidate = `${slug}-${index}`
  while (reservedSlugs.has(candidate)) {
    index++
    candidate = `${slug}-${index}`
  }
  reservedSlugs.add(candidate)
  return candidate
}

/**
 * Node `classIds` that match no style rule in the bundle's own registry.
 *
 * The publisher keeps a style rule only when some node references its id, so a
 * bundle whose rule ids disagree with its `classIds` publishes with almost no
 * CSS. Every other check passes — counts, hashes, schema validation — because
 * nothing else relates the two halves of that reference. It took a screenshot
 * of a published site to find the first instance.
 *
 * Deliberately advisory. A sender may reference a rule it chose not to ship:
 * a class whose stylesheet was gated behind JavaScript that import strips would
 * hide the node rather than style it, so dropping the rule and keeping the
 * class is the correct call. Refusing the bundle would reject it for the one
 * thing it got right, so this reports and does not block.
 */
export function findUnresolvedClasses(bundle: SiteBundle): BundleUnresolvedClass[] {
  const ruleIds = new Set(Object.keys(bundle.site?.styleRules ?? {}))
  // No registry at all means nothing to resolve against — every class would be
  // reported, which is noise rather than a finding.
  if (ruleIds.size === 0) return []

  const nodeCountByClass = new Map<string, number>()
  for (const row of bundle.rows) {
    const body = row.cells?.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) continue
    const nodes = (body as { nodes?: Record<string, { classIds?: string[] }> }).nodes
    if (!nodes || typeof nodes !== 'object') continue
    for (const node of Object.values(nodes)) {
      for (const classId of node?.classIds ?? []) {
        if (ruleIds.has(classId)) continue
        nodeCountByClass.set(classId, (nodeCountByClass.get(classId) ?? 0) + 1)
      }
    }
  }

  return [...nodeCountByClass]
    .map(([className, nodeCount]) => ({ className, nodeCount }))
    .toSorted((a, b) => b.nodeCount - a.nodeCount || a.className.localeCompare(b.className))
}
