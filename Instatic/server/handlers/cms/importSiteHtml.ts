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

const MIME_BY_EXT: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
}

/**
 * Inline the design's LOCAL image files as data URIs so they render in the CMS and
 * on the published site. Designs put assets in `public/` and reference them from the
 * web root (`<img src="/images/hero.svg">`); nothing in the CMS serves a `/images/*`
 * route, and SVGs can't be served inline from `/uploads/*` (XSS hardening), so the
 * safe universal path is a self-contained data URI. We replace EVERY occurrence of
 * the web-root ref (not just `src="…"`) so JS-built images (`p.image = '/images/x'`)
 * are covered too. External `http(s)` images pass through untouched; assets over the
 * size limit are left as-is to avoid bloating the page.
 */
function inlineLocalImages(html: string, files: FileMap['files']): string {
  const MAX_INLINE_BYTES = 512 * 1024
  let out = html
  for (const [path, entry] of Object.entries(files)) {
    const ext = (path.split('.').pop() ?? '').toLowerCase()
    const mime = entry.mimeType || MIME_BY_EXT[ext]
    if (!MIME_BY_EXT[ext] || !entry.bytes?.length || entry.bytes.length > MAX_INLINE_BYTES) continue
    // File `public/images/hero.svg` is referenced from the web root as `/images/hero.svg`.
    const ref = `/${path.replace(/^public\//, '')}`
    if (!out.includes(ref)) continue
    const dataUri = `data:${mime};base64,${Buffer.from(entry.bytes).toString('base64')}`
    out = out.split(ref).join(dataUri)
  }
  return out
}

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
  // Inline the design's local images (data URIs) into each HTML page BEFORE parsing,
  // so the imported pages carry their images and render in the CMS + published site.
  for (const [path, entry] of Object.entries(files)) {
    if (!/\.html?$/i.test(path)) continue
    const html = Buffer.from(entry.bytes).toString('utf8')
    const inlined = inlineLocalImages(html, files)
    if (inlined !== html) files[path] = { ...entry, bytes: new Uint8Array(Buffer.from(inlined, 'utf8')) }
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
