/**
 * Row-level CRUD and publishing.
 *
 * This is the full-access surface: list, read, create, update, delete, change
 * status, publish a row, and publish the whole site.
 *
 * Two behaviours are worth knowing before using them, because neither is
 * obvious from the endpoint names:
 *
 * **Publishing a row makes it public immediately.** There is no staging step and
 * no undo — the row handlers expose no previous-version activation route, so
 * "unpublish" is a status change, not a rollback to prior content.
 *
 * **Full-site publish requires a step-up challenge**, and step-up rotates the
 * session cookie. The session object handles the rotation; the caller only has
 * to remember that a stale step-up means the publish fails.
 */

import { InstaticHttpError, type InstaticSession } from './session'

export interface DataRow {
  id: string
  tableId: string
  slug: string
  cells: Record<string, unknown>
  status: 'draft' | 'published' | 'unpublished' | 'scheduled'
  authorUserId?: string | null
  createdAt?: string
  updatedAt?: string
  publishedAt?: string | null
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listTables(session: InstaticSession): Promise<unknown> {
  const res = await session.request('/data/tables', { method: 'GET', context: 'list tables' })
  return res.json()
}

/**
 * Run a table call by id, falling back to the table's slug.
 *
 * Callers name a table the way it reads — "news" — while the CMS routes only by
 * id, and a custom table's id is generated (`n1tozRulkDeu8H21nKdJz`). The id is
 * tried first, so a call that already names it costs nothing extra; only a 404
 * looks the slug up and retries once. Any other failure, or a name that is
 * neither an id nor a slug, surfaces the original error.
 */
export async function withTableSlug<T>(
  session: InstaticSession,
  tableId: string,
  run: (tableId: string) => Promise<T>,
): Promise<T> {
  try {
    return await run(tableId)
  } catch (err) {
    if (!(err instanceof InstaticHttpError) || err.status !== 404) throw err
    const { tables } = (await listTables(session)) as { tables?: { id: string; slug?: string }[] }
    const bySlug = tables?.find((t) => t.slug === tableId && t.id !== tableId)
    if (!bySlug) throw err
    return run(bySlug.id)
  }
}

/**
 * List rows, paginated.
 *
 * `fields: 'summary'` is the default at the tool layer and matters more than the
 * page size: a page row carries its whole body tree, so even a small page of
 * full rows is measured in megabytes. Summary returns what a list view needs.
 */
export async function listRows(
  session: InstaticSession,
  tableId: string,
  query: { limit?: number; offset?: number; fields?: 'summary' | 'full' } = {},
): Promise<unknown> {
  const params = new URLSearchParams()
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  if (query.fields === 'summary') params.set('fields', 'summary')
  const suffix = params.toString() ? `?${params}` : ''
  const res = await session.request(`/data/tables/${encodeURIComponent(tableId)}/rows${suffix}`, {
    method: 'GET',
    context: `list rows in ${tableId}`,
  })
  return res.json()
}

export async function getRow(session: InstaticSession, rowId: string): Promise<DataRow> {
  const res = await session.request(`/data/rows/${encodeURIComponent(rowId)}`, {
    method: 'GET',
    context: `get row ${rowId}`,
  })
  return (await res.json()) as DataRow
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function createRow(
  session: InstaticSession,
  tableId: string,
  body: { slug?: string; cells?: Record<string, unknown>; status?: string },
): Promise<DataRow> {
  const res = await session.request(`/data/tables/${encodeURIComponent(tableId)}/rows`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    context: `create row in ${tableId}`,
  })
  return (await res.json()) as DataRow
}

/**
 * Update a row. The item route is PUT, not PATCH — posting PATCH here returns a
 * 405 that reads like the row does not exist.
 */
export async function updateRow(
  session: InstaticSession,
  rowId: string,
  body: { slug?: string; cells?: Record<string, unknown> },
): Promise<DataRow> {
  const res = await session.request(`/data/rows/${encodeURIComponent(rowId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    context: `update row ${rowId}`,
  })
  return (await res.json()) as DataRow
}

export async function deleteRow(session: InstaticSession, rowId: string): Promise<unknown> {
  const res = await session.request(`/data/rows/${encodeURIComponent(rowId)}`, {
    method: 'DELETE',
    context: `delete row ${rowId}`,
  })
  return res.status === 204 ? { ok: true, rowId } : res.json()
}

/** Move between draft and unpublished. Retracts a live route without deleting content. */
export async function setRowStatus(
  session: InstaticSession,
  rowId: string,
  status: 'draft' | 'unpublished',
): Promise<unknown> {
  const res = await session.request(`/data/rows/${encodeURIComponent(rowId)}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
    context: `set status of ${rowId}`,
  })
  return res.json()
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

/** Publish one row. Live immediately, and there is no previous-version rollback. */
export async function publishRow(session: InstaticSession, rowId: string): Promise<unknown> {
  const res = await session.request(`/data/rows/${encodeURIComponent(rowId)}/publish`, {
    method: 'POST',
    context: `publish row ${rowId}`,
  })
  return res.json()
}

/**
 * Publish the whole site: builds the site snapshot and page versions. Needs step-up.
 *
 * With `expectedDraftSiteHash`, the CMS publishes only if the draft it is about
 * to bake — after flushing in-flight editor changes, under its publish lock —
 * hashes to exactly that value, and answers 412 otherwise. Checking the hash
 * here instead would miss an edit still in the editor's debounce window, which
 * the publish flushes in.
 */
export async function publishSite(session: InstaticSession, expectedDraftSiteHash?: string): Promise<unknown> {
  const res = await session.request('/publish', {
    method: 'POST',
    headers: expectedDraftSiteHash ? { 'if-match': `"${expectedDraftSiteHash}"` } : undefined,
    context: 'full-site publish',
  })
  return res.json()
}

export async function publishStatus(session: InstaticSession): Promise<unknown> {
  const res = await session.request('/publish/status', {
    method: 'GET',
    context: 'publish status',
  })
  return res.json()
}

/** The draft site hash the CMS reports — what an expected-hash publish is compared against. Null when there is no draft. */
export async function draftSiteHash(session: InstaticSession): Promise<string | null> {
  const status = (await publishStatus(session)) as { draftSiteHash?: unknown }
  if (status.draftSiteHash === null) return null
  if (typeof status.draftSiteHash === 'string' && /^[0-9a-f]{64}$/.test(status.draftSiteHash)) {
    return status.draftSiteHash
  }
  throw new Error(
    'The CMS publish status carries no draftSiteHash, so it is running a build from before the ' +
      'expected-hash publish. Restart it on the current build.',
  )
}
