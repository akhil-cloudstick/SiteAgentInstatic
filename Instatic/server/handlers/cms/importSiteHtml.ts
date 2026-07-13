/**
 * Share to CMS — server-side static-HTML import (no browser).
 *
 *   POST /admin/api/cms/import/site-html?strategy=merge-overwrite
 *
 * Body: { files: { "<path>": { base64: "<bytes>", mimeType?: "<type>" }, … } }
 *
 * OpenDesign posts a tenant's built site here (authenticated as the Owner via the
 * SSO session). We run Instatic's own headless `buildImportPlan`, convert the plan
 * into a SiteBundle with STABLE page ids (same-slug pages upsert — no duplicates on
 * re-push), and apply it through the existing bundle importer with `merge-overwrite`.
 * Requires `data.import` (the SSO'd Owner has it). GET-less: this is a POST but it
 * is reached directly (not through the CSRF-checked CMS dispatcher's mutating path
 * for browsers) — the caller is the daemon holding an Owner session.
 */
import type { DbClient } from '../../db/client'
import { requireCapability } from '../../auth/authz'
import { jsonResponse, badRequest, readValidatedBody } from '../../http'
import { Type } from '@core/utils/typeboxHelpers'
import { getDraftSite } from '../../repositories/site'
import { listDataTables } from '../../repositories/data/tables'
import { listDataRows } from '../../repositories/data/rows'
import { pageFromRow } from '@core/data/pageFromRow'
import { buildImportPlan } from '@core/siteImport'
import type { FileMap } from '@core/siteImport'
import type { SiteDocument } from '@core/page-tree'
import { CMS_API_PREFIX, type CmsHandlerOptions } from './shared'
import { handleImportRoute } from './import'
import { applyPlanToBundle } from './siteImport/applyPlan'
import { ensureServerDomParser } from './siteImport/domPolyfill'

const IMPORT_SITE_HTML_PATH = `${CMS_API_PREFIX}/import/site-html`

const SiteHtmlImportBodySchema = Type.Object({
  files: Type.Record(
    Type.String(),
    Type.Object({
      base64: Type.String(),
      mimeType: Type.Optional(Type.String()),
    }),
  ),
})

export async function handleImportSiteHtmlRoute(
  req: Request,
  db: DbClient,
  options: CmsHandlerOptions = {},
): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== IMPORT_SITE_HTML_PATH) return null
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 })

  const user = await requireCapability(req, db, 'data.import')
  if (user instanceof Response) return user

  const body = await readValidatedBody(req, SiteHtmlImportBodySchema)
  if (!body) return badRequest('Invalid body: expected { files: { path: { base64, mimeType? } } }')

  // Build the FileMap (decode Base64 → bytes).
  const files: FileMap['files'] = {}
  for (const [path, entry] of Object.entries(body.files)) {
    files[path] = { bytes: new Uint8Array(Buffer.from(entry.base64, 'base64')), mimeType: entry.mimeType }
  }
  const fileMap: FileMap = { files }

  // Assemble currentSite (shell + pages) so conflict detection can match imported
  // pages to existing ones by slug → same-slug pages upsert (no duplicates).
  const shell = await getDraftSite(db)
  if (!shell) return jsonResponse({ error: 'Site not initialised — run setup first' }, { status: 409 })
  const pageRows = await listDataRows(db, 'pages', {})
  const currentSite: SiteDocument = {
    ...shell,
    pages: pageRows.map(pageFromRow),
    visualComponents: [],
    layouts: [],
  }

  ensureServerDomParser() // parseHtml uses the global DOMParser — install happy-dom's on the server
  const plan = buildImportPlan({ fileMap, currentSite })

  const tables = await listDataTables(db)
  const pagesTable = tables.find((t) => t.id === 'pages')
  if (!pagesTable) return jsonResponse({ error: 'pages system table missing' }, { status: 500 })

  const bundle = applyPlanToBundle(plan, currentSite, pagesTable)

  // Apply through the existing bundle importer (atomic, upsert-by-id) by forwarding
  // the Owner session. Force merge-overwrite (the no-duplicate mode).
  const strategy = url.searchParams.get('strategy') ?? 'merge-overwrite'
  const syntheticReq = new Request(`${url.origin}${CMS_API_PREFIX}/import?strategy=${encodeURIComponent(strategy)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: req.headers.get('cookie') ?? '' },
    body: JSON.stringify(bundle),
  })
  const result = await handleImportRoute(syntheticReq, db, options)
  return result ?? jsonResponse({ error: 'Import failed' }, { status: 500 })
}
