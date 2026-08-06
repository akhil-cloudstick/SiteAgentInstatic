/**
 * PreviewOverlay — full-screen in-browser preview of the current draft page.
 *
 * Builds the active in-memory draft through the authenticated runtime-preview
 * endpoint, then renders the result into a sandboxed <iframe>. The server path
 * owns request-time concerns such as template composition (the page renders
 * inside its `everywhere` layout's nav / footer chrome, as on the canvas) and
 * loop / media prefetch, keeping Preview aligned with the public renderer
 * without publishing the draft.
 *
 * Accessibility (Guideline #225 / WCAG 2.1 AA):
 * - role="dialog" + aria-modal="true"
 * - Focus trapped: close button receives focus on open, returned on close
 * - Esc closes the overlay
 * - Backdrop click closes the overlay
 *
 * Security:
 * - iframe uses sandbox="allow-same-origin" and NEVER allow-scripts. Same-origin
 *   is required so the session cookie rides along and `/uploads/…` assets
 *   resolve (an opaque origin 404s them) — and so this component can reach
 *   `contentDocument` to install the navigation guard below. Without
 *   allow-scripts the document stays inert, so same-origin grants it nothing
 *   executable.
 *
 * data-testid="preview-overlay" and data-testid="preview-iframe" for Playwright
 */

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { Page, SiteDocument } from '@core/page-tree'
import { isAbortError } from '@core/http'
import { resolvePreviewLink } from './previewLinks'
import { buildCmsRuntimePreview, getCmsPublishStatus } from '@core/persistence'
import type { TemplateRenderDataContext } from '@core/templates/dynamicBindings'
import { useAsyncResource } from '@admin/lib/useAsyncResource'
import { useEditorStore, selectActivePage } from '@site/store/store'
import { useTemplatePreviewContext } from '@site/hooks/useTemplatePreviewContext'
import { EyeSolidIcon } from 'pixel-art-icons/icons/eye-solid'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import { ArrowLeftIcon } from 'pixel-art-icons/icons/arrow-left'
import { ExternalLinkSolidIcon } from 'pixel-art-icons/icons/external-link-solid'
import { Button } from '@ui/components/Button'
import { EmptyState } from '@ui/components/EmptyState'
import { pushToast } from '@ui/components/Toast'
import { useAdminUi } from '@admin/state/adminUi'
import styles from './PreviewOverlay.module.css'

/**
 * Elements whose default click/activation navigates the frame. Mirrors the
 * canvas's `NAVIGABLE_SELECTOR` — form submission is cancelled separately via a
 * `submit` listener, so a default-typed submit button is covered there.
 */
const NAVIGABLE_SELECTOR = 'a[href], area[href], button[type="submit"], input[type="submit"], input[type="image"]'

/** Duck-typed: iframe elements come from another realm, so `instanceof` is false. */
function isElementLike(value: EventTarget | null): value is Element {
  return value != null && typeof (value as { closest?: unknown }).closest === 'function'
}

/**
 * Jump to an in-document anchor. Empty hash means "top of page" — the state a
 * fresh navigation lands in. Unknown ids are ignored rather than scrolling
 * somewhere arbitrary.
 */
function scrollToAnchor(doc: Document, hash: string): void {
  if (!hash) {
    doc.documentElement.scrollTop = 0
    doc.body.scrollTop = 0
    return
  }
  const decoded = (() => {
    try {
      return decodeURIComponent(hash)
    } catch (_err) {
      return hash
    }
  })()
  const destination =
    doc.getElementById(decoded) ?? doc.querySelector(`[name="${CSS.escape(decoded)}"]`)
  destination?.scrollIntoView({ block: 'start' })
}

/**
 * Prepare the server-built HTML for the sandboxed srcDoc iframe.
 *
 * - `<base href>` — the document has no URL of its own, so root-relative asset
 *   paths (`/uploads/…`) would not resolve. Pinning the base to the admin's
 *   origin makes them load exactly as they do on the served page.
 * - lazy → eager — the preview runs no scripts and the iframe never scrolls the
 *   way a real viewport does, so below-the-fold `loading="lazy"` images would
 *   never fire. A static snapshot must load everything up front.
 */
function preparePreviewHtml(html: string): string {
  const baseTag = `<base href="${window.location.origin}/">`
  const withBase = html.includes('<head>')
    ? html.replace('<head>', `<head>${baseTag}`)
    : `${baseTag}${html}`
  return withBase.replace(/loading="lazy"/g, 'loading="eager"')
}

interface PreviewDocumentProps {
  site: SiteDocument
  page: Page
  templatePreviewContext: TemplateRenderDataContext | undefined
  /** Draft pages the preview can navigate between. */
  pages: readonly Page[]
  /** Switch the preview to another draft page. */
  onNavigate: (pageId: string) => void
}

interface LoadedPreviewDocument {
  site: SiteDocument
  pageId: string
  contextKey: string
  html: string
}

function PreviewDocument({
  site,
  page,
  templatePreviewContext,
  pages,
  onNavigate,
}: PreviewDocumentProps) {
  const contextKey = JSON.stringify(templatePreviewContext ?? null)
  const reportedErrorRef = useRef<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // A hash carried across a page switch — applied once the new document loads.
  const pendingHashRef = useRef<string>('')
  const { data, loading, error, refresh } = useAsyncResource<LoadedPreviewDocument>(
    async (signal) => {
      try {
        const preview = await buildCmsRuntimePreview(
          {
            site,
            pageId: page.id,
            templateContext: templatePreviewContext,
          },
          { signal },
        )
        return {
          site,
          pageId: page.id,
          contextKey,
          html: preview.html,
        }
      } catch (err) {
        if (!signal.aborted && !isAbortError(err)) {
          console.error('[PreviewOverlay] Failed to build preview:', err)
        }
        throw err
      }
    },
    [site, page.id, contextKey],
    { fallbackError: 'Preview build failed' },
  )

  useEffect(() => {
    if (!error) {
      reportedErrorRef.current = null
      return
    }
    if (reportedErrorRef.current === error) return
    reportedErrorRef.current = error
    pushToast({
      kind: 'error',
      title: "Couldn't build preview",
      body: error,
      location: 'preview-overlay',
    })
  }, [error])

  const currentHtml =
    data?.site === site && data.pageId === page.id && data.contextKey === contextKey
      ? data.html
      : null

  // ── Preview router ────────────────────────────────────────────────────────
  // The preview browses the DRAFT site. The frame itself must never navigate:
  // its document is a srcDoc snapshot with no URL of its own, and the paths in
  // the authored nav point at PUBLIC routes — which serve the last published
  // output, or `{"error":"Not found"}` for anything not yet published. Letting
  // the frame follow a link would therefore replace the draft the author asked
  // to see with something else entirely, and there is no back button to return.
  //
  // So every activation is cancelled in the capture phase (as the canvas does
  // in `IframeFrameSurface`) and re-interpreted against the in-memory draft:
  // a link to another draft page re-renders the preview for that page, an
  // in-page anchor scrolls, an external link opens a real tab, and an internal
  // path with no draft page does nothing. `stopPropagation` is deliberately not
  // called, so nothing else listening on the way down is silently broken.
  //
  // Installed from the parent rather than injected into the document: the
  // iframe is same-origin but script-less, so only this side can attach it.
  const handleActivate = useEffectEvent((event: Event, doc: Document) => {
    const target = event.target
    if (!isElementLike(target)) return
    const navigable = target.closest(NAVIGABLE_SELECTOR)
    if (!navigable) return
    // Cancel first, unconditionally — whatever we decide below, the frame
    // itself never navigates.
    event.preventDefault()

    const anchor = navigable.closest('a[href], area[href]')
    if (!anchor) return

    const link = resolvePreviewLink(
      anchor.getAttribute('href'),
      pages,
      anchor.getAttribute('target') === '_blank',
    )
    switch (link.kind) {
      case 'anchor':
        scrollToAnchor(doc, link.hash)
        return
      case 'external':
        window.open(link.url, '_blank', 'noopener,noreferrer')
        return
      case 'page':
        if (link.pageId === page.id) {
          // Same page — treat as an in-document jump rather than a reload.
          scrollToAnchor(doc, link.hash)
          return
        }
        pendingHashRef.current = link.hash
        onNavigate(link.pageId)
        return
      case 'dead':
        return
    }
  })

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !currentHtml) return
    let detach: (() => void) | null = null

    const attach = () => {
      const doc = iframe.contentDocument
      if (!doc) return
      detach?.()
      const onActivate = (event: Event) => handleActivate(event, doc)
      const blockSubmit = (event: Event) => {
        // A draft has no endpoint to post to; submitting would navigate away.
        event.preventDefault()
      }
      doc.addEventListener('click', onActivate, true)
      doc.addEventListener('auxclick', onActivate, true)
      doc.addEventListener('submit', blockSubmit, true)
      // A hash carried over from the link that brought us to this page.
      if (pendingHashRef.current) {
        scrollToAnchor(doc, pendingHashRef.current)
        pendingHashRef.current = ''
      }
      detach = () => {
        doc.removeEventListener('click', onActivate, true)
        doc.removeEventListener('auxclick', onActivate, true)
        doc.removeEventListener('submit', blockSubmit, true)
        detach = null
      }
    }

    // srcDoc often parses before the effect runs; `load` covers the case where
    // the browser deferred parsing, and re-arms the router on every re-parse.
    attach()
    iframe.addEventListener('load', attach)
    return () => {
      iframe.removeEventListener('load', attach)
      detach?.()
    }
  }, [currentHtml])

  if (error) {
    return (
      <EmptyState
        variant="centered"
        title="Preview unavailable"
        description={error}
        action={<Button variant="secondary" onClick={refresh}>Retry preview</Button>}
        role="alert"
        data-testid="preview-error"
      />
    )
  }

  if (loading || !currentHtml) {
    return (
      <EmptyState
        variant="centered"
        title="Building preview…"
        description="Resolving dynamic content and page assets."
        data-testid="preview-loading"
      />
    )
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={preparePreviewHtml(currentHtml)}
      sandbox="allow-same-origin"
      title={`Preview: ${page.title}`}
      data-testid="preview-iframe"
      className={styles.iframe}
    />
  )
}

/**
 * "Open live" — the escape hatch to the interactive served page. This preview
 * is an inert, script-less snapshot (see the iframe), so JS interactions
 * (bestseller swaps, menus) don't run here; in a real top-level tab the page is
 * same-origin and its scripts run natively.
 *
 * Rendered ONLY once the site has a published version. Until the first publish
 * there is nothing at the public URL, so the button would send the author to a
 * 404 — an offer the product can't keep. Mounted from the open overlay, so the
 * status request fires when Preview opens rather than on every editor load.
 */
function OpenLiveAction() {
  // Target = the active page's public path, kept in the shared admin store by
  // `useActiveLivePath` (same source the toolbar's Open-live button uses).
  // Falls back to the site root.
  const liveTarget = useAdminUi((s) => s.activeLivePath) ?? '/'
  // A failed status check leaves `data` null → button hidden. Not being able to
  // confirm the site is live is exactly the case where we shouldn't offer it.
  const { data } = useAsyncResource(
    () => getCmsPublishStatus(),
    [],
    { swallowErrors: true },
  )

  if (!data?.hasPublishedVersion) return null

  return (
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
  )
}

const NO_PAGES: Page[] = []

export function PreviewOverlay() {
  const open = useEditorStore((s) => s.previewOpen)
  const closePreview = useEditorStore((s) => s.closePreview)
  const site = useEditorStore((s) => s.site)
  const activePage = useEditorStore(selectActivePage)
  const pages = useEditorStore((s) => s.site?.pages ?? NO_PAGES)

  // Preview-internal navigation. `visited` is the trail of page ids the author
  // clicked through, so Back walks it in reverse; empty means we are still on
  // the page the editor opened Preview from. Session-only — browsing the
  // preview must never move the editor's own selection or dirty the document.
  const [visited, setVisited] = useState<string[]>([])
  // Reopening Preview always starts from the editor's active page — a trail
  // left over from the last session would be a confusing place to land. Reset
  // during render (React's documented adjust-state-on-prop-change pattern, the
  // same shape `useAsyncResource` uses for its dependency tracker) rather than
  // in an effect, which would cost an extra render of the stale trail.
  const [openTracker, setOpenTracker] = useState(open)
  if (openTracker !== open) {
    setOpenTracker(open)
    if (visited.length > 0) setVisited([])
  }
  const previewPageId = visited[visited.length - 1] ?? null
  const previewPage = previewPageId
    ? pages.find((candidate) => candidate.id === previewPageId) ?? activePage
    : activePage
  const { context: templatePreviewContext } = useTemplatePreviewContext(previewPage)

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

  if (!open || !site || !activePage || !previewPage) return null

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
              Preview — {previewPage.title}
            </span>

            {/* Back appears only once the author has followed a link — on the
                opening page there is nowhere to go back to. */}
            {visited.length > 0 && (
              <Button
                variant="ghost"
                size="lg"
                onClick={() => setVisited((trail) => trail.slice(0, -1))}
                aria-label="Back to the previous preview page"
              >
                <ArrowLeftIcon size={12} color="currentColor" aria-hidden="true" />
                Back
              </Button>
            )}

            <OpenLiveAction />

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

          {/* ── Sandboxed server-built preview ─────────────────────────── */}
          <div className={styles.previewContent}>
            <PreviewDocument
              site={site}
              page={previewPage}
              templatePreviewContext={templatePreviewContext}
              pages={pages}
              onNavigate={(pageId) => setVisited((trail) => [...trail, pageId])}
            />
          </div>
        </div>
      </div>
    </>
  )
}
