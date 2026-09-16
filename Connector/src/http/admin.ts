/**
 * Schema, media and session-elevation operations.
 *
 * These are the calls that were reachable in the CMS but never exposed through
 * the connector, so work that should have been one request became either
 * impossible or a few hundred manual ones.
 *
 * Note on redirects: there is deliberately no redirect function here. Instatic
 * has no HTTP route for them — redirects exist only as a bundle category, and
 * only the `replace` import strategy carries them. A tool that pretended
 * otherwise would fail at call time instead of at design time.
 */

import type { InstaticSession } from './session'

// ---------------------------------------------------------------------------
// Session elevation
// ---------------------------------------------------------------------------

/**
 * Re-authenticate for a destructive or schema-changing operation.
 *
 * Step-up rotates the session cookie, and the session object swaps it in. That
 * rotation is the whole point: a stale cookie after a step-up looks like the
 * challenge silently failed.
 */
export async function stepUp(
  session: InstaticSession,
  secret: string,
  mfaCode?: string,
): Promise<{ ok: true }> {
  await session.stepUp(secret, mfaCode)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Tables and fields
// ---------------------------------------------------------------------------

export interface DataField {
  id: string
  type: string
  label: string
  required?: boolean
  builtIn?: boolean
  [key: string]: unknown
}

export interface DataTable {
  id: string
  name: string
  slug: string
  kind: string
  routeBase?: string
  singularLabel?: string
  pluralLabel?: string
  primaryFieldId?: string
  fields: DataField[]
  system?: boolean
}

export async function getTable(session: InstaticSession, tableId: string): Promise<DataTable> {
  const res = await session.request(`/data/tables/${encodeURIComponent(tableId)}`, {
    method: 'GET',
    context: `get table ${tableId}`,
  })
  const body = (await res.json()) as { table: DataTable }
  return body.table
}

export async function createTable(
  session: InstaticSession,
  input: {
    name: string
    slug: string
    kind: 'data' | 'postType'
    routeBase?: string
    singularLabel?: string
    pluralLabel?: string
    fields?: DataField[]
  },
): Promise<unknown> {
  const res = await session.request('/data/tables', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    context: `create table ${input.slug}`,
  })
  return res.json()
}

/**
 * Add fields to a table without disturbing what is already there.
 *
 * The server keeps post-type built-ins regardless, but sending only the new
 * fields would still drop every previously-added custom field — the update
 * replaces the array rather than merging it. So the current fields are read
 * first and the new ones appended. Fields whose id already exists are updated
 * in place rather than duplicated.
 */
export async function addTableFields(
  session: InstaticSession,
  tableId: string,
  newFields: DataField[],
): Promise<{ table: unknown; added: string[]; updated: string[] }> {
  const table = await getTable(session, tableId)
  const existing = new Map(table.fields.map((f) => [f.id, f]))

  const added: string[] = []
  const updated: string[] = []
  for (const field of newFields) {
    if (existing.has(field.id)) updated.push(field.id)
    else added.push(field.id)
    existing.set(field.id, { ...existing.get(field.id), ...field })
  }

  const res = await session.request(`/data/tables/${encodeURIComponent(tableId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fields: [...existing.values()] }),
    context: `add fields to ${tableId}`,
  })
  return { table: await res.json(), added, updated }
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export async function uploadMedia(
  session: InstaticSession,
  fileName: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<unknown> {
  const form = new FormData()
  form.append('file', new Blob([bytes as BlobPart], { type: contentType }), fileName)
  // No content-type header here on purpose: fetch sets the multipart boundary
  // itself, and overriding it produces a body the server cannot parse.
  const res = await session.request('/media', {
    method: 'POST',
    body: form,
    context: `upload ${fileName}`,
  })
  return res.json()
}

export async function listMedia(session: InstaticSession): Promise<unknown> {
  const res = await session.request('/media', { method: 'GET', context: 'list media' })
  return res.json()
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/** One family in `site.settings.fonts.items`, as the CMS stores it. */
export interface FontEntry {
  id: string
  source: 'google' | 'custom'
  family: string
  variants: string[]
  subsets: string[]
  files: unknown[]
  [key: string]: unknown
}

export interface FontToken {
  familyId?: string
  [key: string]: unknown
}

/** The draft site shell — everything but pages. Only the fonts are typed; the rest round-trips untouched. */
export interface SiteShell {
  settings?: {
    fonts?: { items?: FontEntry[]; tokens?: FontToken[]; [key: string]: unknown }
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** The draft site shell and its sync seq — the base a shell save is checked against. */
export async function getSiteShell(session: InstaticSession): Promise<{ site: SiteShell; seq: number }> {
  const res = await session.request('/site', { method: 'GET', context: 'read site shell' })
  return (await res.json()) as { site: SiteShell; seq: number }
}

/**
 * Download a Google family's woff2 files into the site's uploads and return its
 * entry. On-disk work only: the entry reaches the site through `saveSiteShell`.
 * The CMS wipes the family's directory before writing, so the selection must
 * name every variant the site keeps, not only the new ones.
 */
export async function installGoogleFont(
  session: InstaticSession,
  selection: { family: string; variants: string[]; subsets: string[] },
): Promise<FontEntry> {
  const res = await session.request('/fonts/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(selection),
    context: `install font ${selection.family}`,
  })
  return ((await res.json()) as { font: FontEntry }).font
}

/**
 * Save a changed site shell and nothing else. Incremental, with the seq the
 * shell was read at, so a shell another session changed in between is refused
 * with 409 instead of silently overwritten.
 */
export async function saveSiteShell(
  session: InstaticSession,
  site: SiteShell,
  shellBaseSeq: number,
): Promise<{ seq: number }> {
  const res = await session.request('/site-document', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'incremental',
      site,
      changedPages: [],
      deletedPageIds: [],
      changedComponents: [],
      deletedComponentIds: [],
      changedLayouts: [],
      deletedLayoutIds: [],
      baseSeqs: {},
      shellBaseSeq,
    }),
    context: 'save site shell',
  })
  return (await res.json()) as { seq: number }
}
