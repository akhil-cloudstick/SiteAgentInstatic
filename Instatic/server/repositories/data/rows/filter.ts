/**
 * Operator-object filter querying for the `api.cms.content.*` plugin surface.
 *
 *   listDataRowsWithFilter — list rows in a table with operator-object
 *                            filters, sort, and pagination
 *
 * The filter SQL is dialect-naive (ANSI lower/like, the `jsonField()` helper
 * for cells_json paths) — `db-postgres-isms.test.ts` gates against drift.
 */
import type { DbClient } from '../../../db/client'
import type { DataRow } from '@core/data/schemas'
import type { StorageFilterOperator, StorageFilterValue } from '@core/plugin-sdk/storageSchemas'
import { jsonField, jsonFieldNumeric } from '../../../db/jsonExtract'
import { placeholder, selectHydratedDataRows } from './mapper'

/**
 * Options accepted by `listDataRowsWithFilter`. Mirrors the plugin SDK's
 * StorageListOptions shape (operator-object filter, asc/desc orderBy,
 * limit/offset) plus a status filter scoped to the row's lifecycle.
 *
 * `filter` keys are top-level JSON paths under `cells_json` (e.g. `title`,
 * `featuredMedia`). The repository validates each key against an identifier
 * regex before splicing it into SQL.
 *
 * `orderBy` accepts JSON-cell paths AND the four row-level columns
 * `slug` / `status` / `created_at` / `updated_at` (recognised by suffix
 * so the SQL stays dialect-naive).
 */
interface ListDataRowsFilterOptions {
  filter?: Record<string, StorageFilterValue>
  orderBy?: Record<string, 'asc' | 'desc'>
  status?: 'any' | 'draft' | 'published' | 'scheduled'
  limit?: number
  offset?: number
  /**
   * Restrict to rows this user owns. Applied in SQL, not afterwards.
   *
   * Its own field rather than a `filter` entry, because `filter` addresses
   * `cells_json` keys and this addresses columns on the row itself.
   *
   * The caller used to page in SQL and then filter by owner in JavaScript,
   * which meant an own-scope user was handed whatever survived from one page of
   * everyone's rows: usually fewer than they asked for, often none at all, and
   * always beside a `totalCount` describing the whole table. Owning five of a
   * hundred rows showed "100 rows" above an empty grid.
   */
  ownerUserId?: string | null
  /**
   * Declared types of the table's fields, by field key — used to order numeric
   * cells numerically.
   *
   * Supplied by the caller rather than read here, because every caller has
   * already resolved the table (and therefore its `fields`) before calling.
   * Looking it up again would be a third query, and `filter.test.ts` pins this
   * function at exactly two.
   *
   * Optional: without it, ordering falls back to the text form it has always
   * used, so a caller that does not have the schema to hand is unchanged.
   */
  fieldTypes?: Readonly<Record<string, string>>
}

/** Build the `fieldTypes` option from a table's declared fields. */
export function fieldTypesOf(
  fields: ReadonlyArray<{ key: string; type: string }> | undefined,
): Record<string, string> | undefined {
  if (!fields || fields.length === 0) return undefined
  const types: Record<string, string> = {}
  for (const field of fields) types[field.key] = field.type
  return types
}

interface ListDataRowsWithFilterResult {
  rows: DataRow[]
  totalCount: number
}

/** Identifier regex — same rule as `jsonField`. */
const FIELD_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** Row-level columns plugins are allowed to order by directly. */
const ROW_LEVEL_ORDER_KEYS = new Set([
  'slug',
  'status',
  'created_at',
  'updated_at',
  'published_at',
])

/**
 * List rows in a table with operator-object filters, sort, and pagination.
 *
 * Two queries total, independent of page size: a single hydrated SELECT (the
 * filter + pagination live in a `filtered_ids` CTE that the row + user-ref
 * joins are restricted to) plus one COUNT. The CTE keeps the SQL dialect-naive
 * — both Postgres and SQLite support `with` — while collapsing what used to be
 * one hydration round-trip per matching id.
 */
export async function listDataRowsWithFilter(
  db: DbClient,
  tableId: string,
  options: ListDataRowsFilterOptions = {},
): Promise<ListDataRowsWithFilterResult> {
  const {
    filter,
    orderBy,
    status = 'any',
    limit = 100,
    offset = 0,
    ownerUserId = null,
    fieldTypes,
  } = options

  const params: unknown[] = [tableId]
  let paramIdx = 1
  function addParam(value: unknown): string {
    params.push(value)
    paramIdx++
    return placeholder(db.dialect, paramIdx)
  }

  let whereSql = `data_rows.table_id = ${placeholder(db.dialect, 1)} and data_rows.deleted_at is null`

  if (status !== 'any') {
    whereSql += ` and data_rows.status = ${addParam(status)}`
  }

  // Ownership, in the WHERE rather than after the page is cut.
  //
  // Placed before `countParamCount` is taken below, so the count query picks it
  // up too and `totalCount` describes what this user can actually see rather
  // than the whole table.
  //
  // The predicate matches `isOwnedByUser` exactly — author wins, and a row with
  // no author falls back to its creator. Two bindings rather than one because
  // the placeholder helper is positional.
  if (ownerUserId) {
    const byAuthor = addParam(ownerUserId)
    const byCreator = addParam(ownerUserId)
    whereSql +=
      ` and (data_rows.author_user_id = ${byAuthor}` +
      ` or (data_rows.author_user_id is null and data_rows.created_by_user_id = ${byCreator}))`
  }

  if (filter) {
    for (const [key, value] of Object.entries(filter)) {
      if (!FIELD_KEY_RE.test(key)) {
        throw new Error(`[content] invalid filter field name: ${JSON.stringify(key)}`)
      }
      const fragment = jsonField('cells_json', key, db.dialect).sql

      if (value === null || typeof value !== 'object') {
        whereSql += ` and ${fragment} = ${addParam(value)}`
      } else {
        const op = value as StorageFilterOperator
        // An ordered comparison against a NUMBER is compared as a number.
        //
        // Postgres `->>` yields text, SQLite `json_extract` yields the JSON
        // value's own type — so `{ price: { gt: 100 } }` compared numerically on
        // one and lexicographically on the other, where `'9' > '100'` is true.
        // Since every test runs SQLite, the dialect that was wrong was the one
        // nothing exercised. The caller's own value settles the intent: a JS
        // number means a numeric comparison was asked for.
        //
        // `eq`/`ne`/`in` stay on the text form. Equality is the one case where
        // both dialects already agree for the values that matter, and casting
        // there would turn a perfectly good `{ status: 'draft' }` into an error
        // on Postgres.
        const ordered = (v: unknown): string =>
          typeof v === 'number' ? jsonFieldNumeric('cells_json', key, db.dialect).sql : fragment
        if (op.eq !== undefined) whereSql += ` and ${fragment} = ${addParam(op.eq)}`
        if (op.ne !== undefined) whereSql += ` and ${fragment} != ${addParam(op.ne)}`
        if (op.gt !== undefined) whereSql += ` and ${ordered(op.gt)} > ${addParam(op.gt)}`
        if (op.gte !== undefined) whereSql += ` and ${ordered(op.gte)} >= ${addParam(op.gte)}`
        if (op.lt !== undefined) whereSql += ` and ${ordered(op.lt)} < ${addParam(op.lt)}`
        if (op.lte !== undefined) whereSql += ` and ${ordered(op.lte)} <= ${addParam(op.lte)}`
        if (op.in !== undefined) {
          if (op.in.length === 0) {
            whereSql += ` and 1=0`
          } else {
            const inPlaceholders = op.in.map((v) => addParam(v))
            whereSql += ` and ${fragment} in (${inPlaceholders.join(', ')})`
          }
        }
        if (op.like !== undefined) {
          whereSql += ` and lower(${fragment}) like lower(${addParam(op.like)})`
        }
      }
    }
  }

  const countParamCount = params.length

  let orderBySql = 'data_rows.updated_at desc, data_rows.created_at desc'
  if (orderBy && Object.keys(orderBy).length > 0) {
    const parts: string[] = []
    for (const [key, dir] of Object.entries(orderBy)) {
      const normalizedDir = dir === 'desc' ? 'desc' : 'asc'
      if (ROW_LEVEL_ORDER_KEYS.has(key)) {
        parts.push(`data_rows.${key} ${normalizedDir}`)
        continue
      }
      if (!FIELD_KEY_RE.test(key)) {
        throw new Error(`[content] invalid orderBy field name: ${JSON.stringify(key)}`)
      }
      // A numeric cell is ordered numerically.
      //
      // Postgres `->>` yields text and SQLite `json_extract` yields the JSON
      // value's own type, so without the cast the same `orderBy` gives
      // `'10', '100', '9'` on one and `9, 10, 100` on the other.
      //
      // Unlike the comparison operators above, an `order by` carries no bound
      // value whose JS type declares the intent — so the field's DECLARED type
      // settles it. The caller passes it in (see `fieldTypes`); it has already
      // resolved the table, so this costs no extra query and the two-query
      // contract `filter.test.ts` pins still holds.
      //
      // Unknown or non-numeric fields keep the text form, which is correct for
      // them and is what every caller without a schema still gets.
      const fragment =
        fieldTypes?.[key] === 'number'
          ? jsonFieldNumeric('cells_json', key, db.dialect).sql
          : jsonField('cells_json', key, db.dialect).sql
      parts.push(`${fragment} ${normalizedDir}`)
    }
    orderBySql = parts.join(', ')
  }

  const limitPlaceholder = addParam(Math.max(1, Math.min(500, limit)))
  const offsetPlaceholder = addParam(Math.max(0, offset))

  // The CTE selects (and orders + paginates) the matching id page; the outer
  // hydrated SELECT joins it back to data_rows + user refs in one round-trip.
  // The outer `order by` is re-applied because a JOIN does not preserve the
  // CTE's row order.
  const cte = `filtered_ids as (
    select data_rows.id
    from data_rows
    where ${whereSql}
    order by ${orderBySql}
    limit ${limitPlaceholder} offset ${offsetPlaceholder}
  )`

  const countSql = `
    select count(*) as total
    from data_rows
    where ${whereSql}
  `

  const countParams = params.slice(0, countParamCount)

  const [rows, countResult] = await Promise.all([
    selectHydratedDataRows(db, {
      cte,
      join: 'join filtered_ids on filtered_ids.id = data_rows.id',
      tail: `order by ${orderBySql}`,
      params,
    }),
    db.unsafe<{ total: number | bigint | string }>(countSql, countParams),
  ])

  return {
    rows,
    totalCount: Number(countResult.rows[0]?.total ?? 0),
  }
}
