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
} from '@core/data/bundleSchema'
import type { DataRow, DataTable } from '@core/data/schemas'
import { CMS_API_PREFIX } from './shared'

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

      // Local rows for this table (0 if the table doesn't exist locally yet)
      let localRows: DataRow[]
      if (localTableIds.has(table.id)) {
        localRows = await listDataRows(db, table.id)
      } else {
        localRows = []
      }
      const localRowIds = new Set(localRows.map((r) => r.id))
      rowConflicts.push(...findRowSlugConflicts(table, bundleRowsForTable, localRows))
      // The destination table's schema wins: a table the bundle also creates
      // brings its own fields, but importing into an existing table keeps the
      // local field list, so that is what the cells must match.
      unknownFields.push(
        ...findUnknownFields(localTablesById.get(table.id) ?? table, bundleRowsForTable),
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
  }

  // Paranoia: validate the shape before returning
  parseValue(BundlePreviewSchema, preview)

  return jsonResponse(preview)
}

/**
 * Cells in the bundle addressed to fields the destination table does not have.
 *
 * The importer writes `cells` verbatim, so these arrive, persist, and are then
 * invisible to every reader — nothing errors and nothing renders. Counting them
 * here turns a clean-looking preview into an actionable one: the sender learns
 * to add the field (or ship the table definition) before committing the import.
 */
function findUnknownFields(table: DataTable, bundleRows: DataRow[]): BundleUnknownField[] {
  const knownFieldIds = new Set(table.fields.map((field) => field.id))
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
