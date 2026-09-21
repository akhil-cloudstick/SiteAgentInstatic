/**
 * Share to CMS — stage a FileMap for the real "Import Site" wizard to run.
 *
 *   POST /cms/api/cms/import/site-html
 *     Body: { files: { "<path>": { base64: "<bytes>", mimeType?: "<type>" }, … } }
 *     Response: { token: "<opaque>" }
 *
 *   GET  /cms/api/cms/import/staged/:token
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
 * entire job. See `docs/integration/phase5-share-to-cms-design.md` for the original
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
import { getDesignOrigin, recordDesignOrigin, type DesignOrigin } from '../../repositories/designOrigin'
import { getDraftPublishStatus } from '../../repositories/publish'

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
  /**
   * Which design is being shared (MMSBUILD R2). Optional, because a share from
   * a studio that predates this field must still work — it is then treated as
   * an unidentified design, which is refused against a published website
   * rather than allowed through: an import that cannot say what it is cannot
   * be shown to be the same one.
   */
  design: Type.Optional(Type.Object({
    id: Type.String({ maxLength: 200 }),
    name: Type.Optional(Type.String({ maxLength: 200 })),
  })),
})

/**
 * May this design land here (R2, AC-A2.1)?
 *
 * The rule the platform owes: a second, DIFFERENT design shared into a project
 * that already has a published website is refused with a clear message, and
 * the first website still resolves with its own content afterwards. A silent
 * overwrite is a failure.
 *
 * It is decided here, before staging, for one reason above all: this runs
 * before the browser is redirected into the wizard, and the wizard is where
 * the destruction happens — it empties the site from the editor store before
 * it plans the import, which is exactly why no conflict was ever detected.
 * Refusing here means nothing has been touched at all.
 */
export type ShareVerdict =
  | { verdict: 'allow'; confirm?: { replacing: string; pages: number } }
  | { verdict: 'refuse'; message: string; existing: { design: string | null; pages: number } }

export function judgeShare(
  origin: DesignOrigin | null,
  status: { hasPublishedVersion: boolean; publishedPages: number; draftPages: number },
  incoming: { id: string; name?: string } | undefined,
): ShareVerdict {
  // The same design again: this is an update, and the studio is the source of
  // truth. Unchanged behaviour, deliberately — "no duplicates on re-share"
  // depends on it.
  if (origin && incoming?.id && origin.designId === incoming.id) return { verdict: 'allow' }

  // Nothing here yet, so nothing to lose.
  if (status.publishedPages === 0 && status.draftPages === 0) return { verdict: 'allow' }

  const was = origin?.designName || origin?.designId || null
  if (status.hasPublishedVersion) {
    const built = was ? ` It was built from \u201c${was}\u201d.` : ''
    return {
      verdict: 'refuse',
      existing: { design: was, pages: status.publishedPages },
      message:
        `This project already has a published website of ${status.publishedPages} `
        + `page${status.publishedPages === 1 ? '' : 's'}.${built} `
        + 'Sharing a different design would replace it, so it has been stopped. '
        + 'Share this design into a project of its own, or have the existing website removed first.',
    }
  }

  // Unpublished work is still somebody's work: it is not refused, because the
  // share-look-share-again loop before launch is normal, but it is not thrown
  // away without a word either.
  return {
    verdict: 'allow',
    confirm: { replacing: was || 'another design', pages: status.draftPages },
  }
}

/** POST /cms/api/cms/import/site-html — stage a FileMap, return its token. */
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

  // Judged BEFORE staging, so a refusal costs the existing website nothing.
  const judged = judgeShare(await getDesignOrigin(db), await getDraftPublishStatus(db), body.design)
  if (judged.verdict === 'refuse') {
    return jsonResponse(
      { error: judged.message, code: 'SITE_ALREADY_EXISTS', existing: judged.existing },
      { status: 409 },
    )
  }

  const files: FileMap['files'] = {}
  for (const [path, entry] of Object.entries(body.files)) {
    files[path] = { bytes: new Uint8Array(Buffer.from(entry.base64, 'base64')), mimeType: entry.mimeType }
  }
  const token = stageFileMap({ files }, user.id)
  if (body.design?.id) await recordDesignOrigin(db, body.design.id, body.design.name ?? null)
  return jsonResponse(
    judged.confirm ? { token, confirm: judged.confirm } : { token },
    { status: 201 },
  )
}

/** GET /cms/api/cms/import/staged/:token — single-use fetch for the browser wizard. */
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
