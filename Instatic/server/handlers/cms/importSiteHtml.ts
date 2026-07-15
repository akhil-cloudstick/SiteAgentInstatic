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
import { buildImportPlan, applyAssetRewrites } from '@core/siteImport'
import type { FileMap, ImportPlan } from '@core/siteImport'
import type { SiteDocument } from '@core/page-tree'
import { CMS_API_PREFIX, type CmsHandlerOptions } from './shared'
import { handleImportRoute } from './import'
import { applyPlanToBundle } from './siteImport/applyPlan'
import { ensureServerDomParser } from './siteImport/domPolyfill'
import { acceptUploadedMedia, EXTENSION_FOR_MIME } from './mediaUpload'
import { installGoogleFont } from '../../fonts/googleFontsInstaller'
import type { FontEntry } from '@core/fonts'

const IMPORT_SITE_HTML_PATH = `${CMS_API_PREFIX}/import/site-html`

/** Every MIME the CMS media library accepts (images, video, web fonts). */
const MEDIA_IMPORT_MIMES = Object.keys(EXTENSION_FOR_MIME) as Array<keyof typeof EXTENSION_FOR_MIME>
const MAX_IMPORT_ASSET_BYTES = 50 * 1024 * 1024

/**
 * Upload every asset the plan references into the CMS media library and return a
 * `sourcePath → /uploads/… URL` rewrite map. This is the headless equivalent of
 * the browser wizard's `uploadPlanAssets` (`src/core/siteImport/commitPlan.ts`):
 * it runs each asset through the same server media-commit path the Media tab uses
 * (`acceptUploadedMedia` — magic-byte MIME sniff, SVG sanitise, responsive
 * variants), so imported images/SVGs/fonts land in the library as first-class,
 * reusable assets. `applyAssetRewrites` then swaps the plan's FileMap-key URLs for
 * the returned `/uploads/…` paths. A single failed asset is skipped (its reference
 * stays unrewritten) so one bad file never aborts the whole import.
 */
async function uploadImportedAssets(
  db: DbClient,
  plan: ImportPlan,
  uploadedByUserId: string,
): Promise<Record<string, string>> {
  const rewriteMap: Record<string, string> = {}
  for (const asset of plan.assets) {
    try {
      const name = asset.sourcePath.split('/').pop() || 'asset'
      // bytes come from the FileMap (plain ArrayBuffer-backed) — the cast satisfies
      // the BlobPart constraint, which excludes SharedArrayBuffer.
      const file = new File([asset.bytes.slice().buffer as ArrayBuffer], name, { type: asset.mimeType })
      const result = await acceptUploadedMedia(db, {
        file,
        maxBytes: MAX_IMPORT_ASSET_BYTES,
        allowedMimes: MEDIA_IMPORT_MIMES,
        role: 'original',
        uploadedByUserId,
        // Reuse a byte-identical asset already in the library instead of cloning
        // it — this is what makes re-pushing the same project idempotent for
        // media (no more N-copies-per-push accumulation).
        dedupeByContentHash: true,
        oversizedMessage: `Asset ${asset.sourcePath} exceeds the 50 MB limit`,
        unsupportedMessage: `Asset ${asset.sourcePath} has an unsupported type (${asset.mimeType})`,
      })
      if (result instanceof Response) continue // policy failure → leave the ref unrewritten
      rewriteMap[asset.sourcePath] = result.publicPath
    } catch {
      // network / storage blip — skip this asset, keep importing the rest
    }
  }
  return rewriteMap
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

  // Upload every referenced asset into the CMS media library, then rewrite the
  // plan's FileMap-key URLs to the returned /uploads/ paths — the same two-step
  // the browser "Import Site" wizard runs. Images/SVGs/fonts become first-class
  // library assets (no more data-URI inlining or `public/`-prefix corruption).
  const rewriteMap = await uploadImportedAssets(db, plan, user.id)
  const rewrittenPlan = applyAssetRewrites(plan, rewriteMap)

  // Self-host the design's Google fonts (under /uploads/fonts) so typography
  // matches the source — same as the browser wizard's `installGoogleFont` step.
  // The installer fails closed to its bundled snapshot; a family it doesn't ship
  // (or a download blip) is skipped and falls back — it never aborts the import.
  const installedGoogleFonts: FontEntry[] = []
  if (options.uploadsDir && rewrittenPlan.googleFonts.length > 0) {
    for (const font of rewrittenPlan.googleFonts) {
      try {
        installedGoogleFonts.push(await installGoogleFont(font, options.uploadsDir))
      } catch {
        // family not in the snapshot / download failed — skip; the CSS falls back
      }
    }
  }

  const tables = await listDataTables(db)
  const pagesTable = tables.find((t) => t.id === 'pages')
  if (!pagesTable) return jsonResponse({ error: 'pages system table missing' }, { status: 500 })

  // Rebuild each imported page into Instatic's native editable node tree — the
  // same result as the manual "Import Site" wizard: every heading/image/button
  // becomes a real, editable canvas node, and the page renders faithfully. Media
  // is already uploaded, fonts self-hosted, page scripts committed page-scoped.
  const bundle = applyPlanToBundle(rewrittenPlan, currentSite, pagesTable, installedGoogleFonts)

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
