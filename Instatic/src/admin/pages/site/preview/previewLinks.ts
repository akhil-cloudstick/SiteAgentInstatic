/**
 * Preview link routing — how a click inside the preview iframe is interpreted.
 *
 * The preview browses the DRAFT site, so the frame itself must never navigate:
 * its document is a srcDoc snapshot with no URL of its own, and the paths in the
 * authored nav point at PUBLIC routes, which serve the last published output (or
 * a 404 for anything not yet published). `PreviewOverlay` cancels every
 * activation and asks this module what the click actually meant.
 *
 * Split out of `PreviewOverlay.tsx` so the resolver can be exported and unit
 * tested without breaking fast refresh (a component file may only export
 * components).
 */
import type { Page } from '@core/page-tree'
import { pagePublicPath } from '@core/page-tree'
import { isTemplatePage } from '@core/templates'

/**
 * Where a clicked link in the preview should go.
 *
 * `page` keeps the visitor inside the draft — the whole point of preview
 * navigation is that it browses the UNPUBLISHED site. `anchor` is a same-page
 * jump. `external` leaves the site entirely. `dead` is an internal path with no
 * matching draft page (a link to a page not built yet, or a published-only
 * route); it does nothing rather than destroying the preview with a 404.
 */
export type PreviewLinkTarget =
  | { kind: 'page'; pageId: string; hash: string }
  | { kind: 'anchor'; hash: string }
  | { kind: 'external'; url: string }
  | { kind: 'dead' }

/**
 * Resolve a clicked anchor to a preview action.
 *
 * `rawHref` is the ATTRIBUTE, not the resolved `.href` — a bare `#section` must
 * be recognised as an in-page anchor before URL resolution turns it into
 * `<origin>/#section`, which would otherwise look like a link to the home page.
 *
 * Only non-template pages are routable: a template's own slug has no public
 * route (see `useActiveLivePath`), so it must never be a navigation target.
 */
export function resolvePreviewLink(
  rawHref: string | null,
  pages: readonly Page[],
  openInNewTab: boolean,
): PreviewLinkTarget {
  const href = rawHref?.trim() ?? ''
  if (!href || href === '#') return { kind: 'dead' }
  // Non-navigational schemes (mailto:, tel:, …) belong to the OS, not to us.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href)) {
    return { kind: 'external', url: href }
  }
  if (href.startsWith('#')) return { kind: 'anchor', hash: href.slice(1) }

  let url: URL
  try {
    url = new URL(href, window.location.origin)
  } catch (_err) {
    return { kind: 'dead' }
  }
  if (url.origin !== window.location.origin || openInNewTab) {
    return { kind: 'external', url: url.href }
  }

  const path = url.pathname.replace(/\/+$/, '') || '/'
  const match = pages.find(
    (candidate) => !isTemplatePage(candidate) && pagePublicPath(candidate.slug) === path,
  )
  if (!match) return { kind: 'dead' }
  return { kind: 'page', pageId: match.id, hash: url.hash.slice(1) }
}
