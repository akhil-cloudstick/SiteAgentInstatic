/**
 * Share to CMS — stage a FileMap for the real "Import Site" wizard to run.
 *
 *   POST /admin/api/cms/import/site-html
 *     Body: { files: { "<path>": { base64: "<bytes>", mimeType?: "<type>" }, … } }
 *     Response: { token: "<opaque>" }
 *
 *   GET  /admin/api/cms/import/staged/:token
 *     Response: { files: { ... } } (same shape as the POST body) — single-use,
 *     burned on read.
 *
 * OpenDesign posts a tenant's built site here (authenticated as the Owner via
 * the SSO session), gets back a short-lived token, and redirects the
 * tenant's BROWSER (through the existing SSO route,
 * `redirect=/admin/site?importToken=<token>`) to fetch it and run it through
 * `SiteImportModal.tsx` — the SAME analysis+commit code a manual drag-drop
 * import uses (`buildImportPlan` + `commitImportPlan` against the live
 * editor store), not a separate server-side reimplementation. This is why
 * there is no `buildImportPlan`/commit call in this file: staging is the
 * entire job. See `docs/phase5-share-to-cms-design.md` for the original
 * design and `siteImport/stagedImports.ts` for the handoff store.
 *
 * Requires `data.import` on both routes (the SSO'd Owner has it).
 */
import type { DbClient } from '../../db/client'
import { requireCapability } from '../../auth/authz'
import { jsonResponse, badRequest, readValidatedBody } from '../../http'
import { Type } from '@core/utils/typeboxHelpers'
import type { FileMap } from '@core/siteImport'
import { CMS_API_PREFIX } from './shared'
import { stageFileMap, takeStagedFileMap } from './siteImport/stagedImports'

const IMPORT_SITE_HTML_PATH = `${CMS_API_PREFIX}/import/site-html`
const STAGED_IMPORT_PREFIX = `${CMS_API_PREFIX}/import/staged/`

const SiteHtmlImportBodySchema = Type.Object({
  files: Type.Record(
    Type.String(),
    Type.Object({
      base64: Type.String(),
      mimeType: Type.Optional(Type.String()),
    }),
  ),
})

/** POST /admin/api/cms/import/site-html — stage a FileMap, return its token. */
export async function handleImportSiteHtmlRoute(
  req: Request,
  db: DbClient,
): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== IMPORT_SITE_HTML_PATH) return null
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 })

  const user = await requireCapability(req, db, 'data.import')
  if (user instanceof Response) return user

  const body = await readValidatedBody(req, SiteHtmlImportBodySchema)
  if (!body) return badRequest('Invalid body: expected { files: { path: { base64, mimeType? } } }')

  const files: FileMap['files'] = {}
  for (const [path, entry] of Object.entries(body.files)) {
    files[path] = { bytes: new Uint8Array(Buffer.from(entry.base64, 'base64')), mimeType: entry.mimeType }
  }
  const token = stageFileMap({ files }, user.id)
  return jsonResponse({ token }, { status: 201 })
}

/** GET /admin/api/cms/import/staged/:token — single-use fetch for the browser wizard. */
export async function handleStagedImportFetchRoute(
  req: Request,
  db: DbClient,
): Promise<Response | null> {
  const url = new URL(req.url)
  if (!url.pathname.startsWith(STAGED_IMPORT_PREFIX)) return null
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, { status: 405 })

  const user = await requireCapability(req, db, 'data.import')
  if (user instanceof Response) return user

  const token = url.pathname.slice(STAGED_IMPORT_PREFIX.length)
  if (!token) return badRequest('Missing token')

  const fileMap = takeStagedFileMap(token, user.id)
  if (!fileMap) return jsonResponse({ error: 'Import link expired or already used' }, { status: 404 })

  const files: Record<string, { base64: string; mimeType?: string }> = {}
  for (const [path, entry] of Object.entries(fileMap.files)) {
    files[path] = entry.mimeType === undefined
      ? { base64: Buffer.from(entry.bytes).toString('base64') }
      : { base64: Buffer.from(entry.bytes).toString('base64'), mimeType: entry.mimeType }
  }
  return jsonResponse({ files })
}
