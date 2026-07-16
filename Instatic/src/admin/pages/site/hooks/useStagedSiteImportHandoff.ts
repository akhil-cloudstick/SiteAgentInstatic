/**
 * useStagedSiteImportHandoff — one-shot pickup of a FileMap staged by an
 * external caller (Share to CMS from OpenDesign — see
 * `server/handlers/cms/siteImport/stagedImports.ts`) so the tenant's browser
 * can run it through the SAME "Import Site" wizard a manual drag-drop import
 * uses (`buildImportPlan` + `commitImportPlan` against the live editor
 * store), landing on "Review import" — not a separate server-side commit.
 *
 * URL contract: `/admin/site?importToken=<token>` — consumed once on mount
 * (mirrors the `?table=&row=` deep link in `useSiteEditorUrlSync`), then the
 * token is stripped from the address bar immediately so a reload never
 * re-fetches an already-burned (single-use) token.
 */
import { useEffect, useRef } from 'react'
import { Type } from '@core/utils/typeboxHelpers'
import { apiRequest, ApiError } from '@core/http'
import { pushToast } from '@ui/components/Toast'
import { useInitialQueryParams } from '@admin/lib/urlState'
import { useAdminUi } from '@admin/state/adminUi'

const StagedImportResponseSchema = Type.Object({
  files: Type.Record(
    Type.String(),
    Type.Object({ base64: Type.String(), mimeType: Type.Optional(Type.String()) }),
  ),
})

interface UseStagedSiteImportHandoffOptions {
  /** When false, the hook does nothing. Pass `workspace === 'site'`. */
  enabled: boolean
}

export function useStagedSiteImportHandoff({ enabled }: UseStagedSiteImportHandoffOptions): void {
  const appliedRef = useRef(false)
  const initialParams = useInitialQueryParams()
  const openSiteImport = useAdminUi((s) => s.openSiteImport)
  const setPendingSiteImportFileMap = useAdminUi((s) => s.setPendingSiteImportFileMap)

  useEffect(() => {
    if (!enabled) return
    if (appliedRef.current) return
    const token = initialParams.get('importToken')
    if (!token) return
    appliedRef.current = true

    // Strip the one-shot token from the address bar immediately (not via
    // useUrlQuerySync — this is a one-shot consume, not an ongoing mirror).
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.delete('importToken')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    }

    void (async () => {
      try {
        const result = await apiRequest(`/admin/api/cms/import/staged/${encodeURIComponent(token)}`, {
          schema: StagedImportResponseSchema,
        })
        setPendingSiteImportFileMap({ files: result.files })
        openSiteImport()
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Import link expired or already used'
        pushToast({ kind: 'error', title: 'Share to CMS failed', body: message })
      }
    })()
  }, [enabled, initialParams, openSiteImport, setPendingSiteImportFileMap])
}
