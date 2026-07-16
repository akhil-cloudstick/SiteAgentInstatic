/**
 * PreviewOverlay — full-screen in-browser preview of the published page.
 *
 * Renders the active page via publishPage() into a sandboxed <iframe> so
 * the user can see exactly what visitors will see before exporting.
 *
 * Accessibility (Guideline #225 / WCAG 2.1 AA):
 * - role="dialog" + aria-modal="true"
 * - Focus trapped: close button receives focus on open, returned on close
 * - Esc closes the overlay
 * - Backdrop click closes the overlay
 *
 * Security:
 * - iframe uses sandbox="" — all sandboxing restrictions applied
 *
 * data-testid="preview-overlay" and data-testid="preview-iframe" for Playwright
 */

import { useEffect, useRef } from 'react'
import { useEditorStore, selectActivePage } from '@site/store/store'
import { publishPage } from '@core/publisher'
import { registry } from '@core/module-engine'
import { useTemplatePreviewContext } from '@site/hooks/useTemplatePreviewContext'
import { EyeSolidIcon } from 'pixel-art-icons/icons/eye-solid'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import { ExternalLinkSolidIcon } from 'pixel-art-icons/icons/external-link-solid'
import { Button } from '@ui/components/Button'
import { useAdminUi } from '@admin/state/adminUi'
import styles from './PreviewOverlay.module.css'

/**
 * Prepare the published HTML for the `srcDoc` preview iframe. The iframe is
 * `sandbox="allow-same-origin"` (see the iframe for why — asset requests are
 * gateway-routed by the `sa_hub` cookie, so they must be same-origin), which
 * fetches `/uploads/…` correctly. On top of that, two HTML fix-ups:
 *
 * 1. **Base href.** Inject `<base href="<admin origin>/">` as the first child of
 *    `<head>` so root-relative `/uploads/…` URLs resolve to the admin origin
 *    explicitly, independent of `about:srcdoc` base-URL inheritance. Skipped if
 *    a `<base>` already exists or there's no `<head>`.
 * 2. **Eager images.** Rewrite `loading="lazy"` → `eager`. The preview is a
 *    static, script-less snapshot, so native lazy-loading (which the user would
 *    have to scroll to trigger, if it fires at all inside the iframe) buys
 *    nothing — eager-load everything so the whole page renders at once.
 */
function preparePreviewHtml(html: string): string {
  if (typeof window === 'undefined') return html
  let out = html.replace(/\bloading\s*=\s*(["'])lazy\1/gi, 'loading="eager"')
  if (!/<base\b/i.test(out)) {
    const baseTag = `<base href="${window.location.origin}/">`
    out = out.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${baseTag}`)
  }
  return out
}

export function PreviewOverlay() {
  const open = useEditorStore((s) => s.previewOpen)
  const closePreview = useEditorStore((s) => s.closePreview)
  const site = useEditorStore((s) => s.site)
  const activePage = useEditorStore(selectActivePage)
  const templatePreviewContext = useTemplatePreviewContext(activePage)
  // Target for the "Open live" button — the active page's public path, kept in
  // the shared admin store by `useActiveLivePath` (same source the toolbar's
  // Open-live button uses). Falls back to the site root.
  const liveTarget = useAdminUi((s) => s.activeLivePath) ?? '/'

  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  // Focus management
  useEffect(() => {
    if (open) {
      if (document.activeElement instanceof HTMLElement) {
        triggerRef.current = document.activeElement
      }
      requestAnimationFrame(() => closeBtnRef.current?.focus())
    } else {
      triggerRef.current?.focus()
      triggerRef.current = null
    }
  }, [open])

  // Esc closes the overlay
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closePreview()
    }
  }

  if (!open || !site || !activePage) return null

  const { html } = publishPage(activePage, site, registry, {
    templateContext: templatePreviewContext,
  })
  // Fix the published HTML up for the sandboxed preview iframe: resolve
  // root-relative `/uploads/…` asset URLs against the admin origin, and force
  // eager image loading (native lazy-load never fires in this sandboxed srcDoc,
  // so below-the-fold images stay blank). See preparePreviewHtml.
  const previewHtml = preparePreviewHtml(html)

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={closePreview}
        className={styles.backdrop}
      />

      {/* Dialog wrapper */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Page preview"
        data-testid="preview-overlay"
        onKeyDown={handleKeyDown}
        className={styles.dialogWrapper}
      >
        {/* Inner card */}
        <div className={styles.card}>
          {/* ── Header bar ──────────────────────────────────────────────── */}
          <div className={styles.header}>
            <EyeSolidIcon size={14} color="var(--text-muted)" className={styles.headerIcon} />
            <span className={styles.headerTitle}>
              Preview — {activePage.title}
            </span>

            {/* Open the live (served) page in a new tab. This preview is an
                inert, script-less snapshot (see the iframe) — great for layout,
                fonts, and images, but JS interactions (bestseller swaps, menus)
                don't run here. In a real top-level tab the page is same-origin,
                so its scripts run natively and those interactions work. */}
            <Button
              variant="ghost"
              size="lg"
              onClick={() => window.open(liveTarget, '_blank', 'noopener,noreferrer')}
              aria-label="Open live page in a new tab"
              tooltip="Interactions (swaps, menus) run on the live page"
            >
              <ExternalLinkSolidIcon size={12} color="currentColor" aria-hidden="true" />
              Open live
            </Button>

            {/* Close button */}
            <Button
              ref={closeBtnRef}
              variant="ghost"
              size="lg"
              onClick={closePreview}
              aria-label="Close preview"
            >
              <CloseIcon size={12} color="currentColor" aria-hidden="true" />
              Close
            </Button>
          </div>

          {/* ── Sandboxed iframe ───────────────────────────────────────────
              `allow-same-origin` (but deliberately NOT `allow-scripts`) is
              required, not a relaxation: tenant assets (`/uploads/fonts`,
              `/uploads/*.svg`) are served through the funnel gateway, which
              routes each request to the right tenant by the `sa_hub` session
              cookie. An opaque-origin (`sandbox=""`) iframe is cross-site, so
              that cookie is never sent → the gateway can't resolve a tenant →
              every asset 404s (fonts + images). Same-origin makes the cookie
              ride along like the canvas, so assets load. Scripts stay disabled
              (no `allow-scripts`), so the preview is still an inert static
              snapshot — safe, since `allow-same-origin` grants nothing without
              script execution. */}
          <iframe
            srcDoc={previewHtml}
            sandbox="allow-same-origin"
            title={`Preview: ${activePage.title}`}
            data-testid="preview-iframe"
            className={styles.iframe}
          />
        </div>
      </div>
    </>
  )
}
