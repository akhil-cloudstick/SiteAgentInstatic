import type { Page, SiteDocument } from '@core/page-tree'
import { treeHasOutlet } from './outlet'

export function normalizeRouteBase(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '/'

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/g, '')
  return withoutTrailingSlash || '/'
}

/** What an inbound public URL resolved to, for template matching. */
export type RouteResolutionContext =
  | { kind: 'page' }
  | { kind: 'entry'; tableSlug: string }

export function isTemplatePage(page: Page): boolean {
  return page.template?.enabled === true
}

/**
 * The primary post-type slug a template targets, or null for an `everywhere`
 * layout / non-template page. Used to scope `currentEntry` bindings and to
 * populate the `{page.templateTableSlug}` binding frame in the single-target
 * case (the overwhelmingly common one in v1).
 */
export function primaryTemplateTableSlug(page: Page): string | null {
  const target = page.template?.target
  if (target?.kind === 'postTypes') return target.tableSlugs[0] ?? null
  return null
}

/** Short human-readable label for a template's target (for list/explorer UI). */
export function templateTargetLabel(page: Page): string {
  const target = page.template?.target
  if (!target) return ''
  if (target.kind === 'everywhere') return 'Everywhere'
  if (target.kind === 'notFound') return 'Not found'
  return target.tableSlugs.join(', ')
}

/**
 * Breadth levels, OUTER → INNER. Adding a level here (e.g. a path-prefix
 * "section" layout between everywhere and postTypes) is the only change
 * needed to deepen nesting — the resolver loop is level-agnostic.
 */
function matchesLevel(
  page: Page,
  level: 'everywhere' | 'postTypes',
  ctx: RouteResolutionContext,
): boolean {
  const target = page.template?.target
  if (!target) return false
  if (level === 'everywhere') return target.kind === 'everywhere'
  if (level === 'postTypes') {
    return target.kind === 'postTypes'
      && ctx.kind === 'entry'
      && target.tableSlugs.includes(ctx.tableSlug)
  }
  return false
}

const LEVELS = ['everywhere', 'postTypes'] as const

/**
 * The page that renders public 404s, or null when the site doesn't define
 * one. A `notFound` template never participates in `resolveTemplateChain` —
 * it isn't a breadth level; route resolution never "matches" a 404. The
 * public router calls this directly when a GET falls through every route,
 * then composes the winner like a regular page (wrapped by the `everywhere`
 * layout chain). Highest priority wins, document order breaks ties.
 */
export function resolveNotFoundTemplate(site: SiteDocument): Page | null {
  return site.pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => isTemplatePage(page) && page.template?.target.kind === 'notFound')
    .sort((a, b) => ((b.page.template?.priority ?? 0) - (a.page.template?.priority ?? 0)) || a.index - b.index)[0]
    ?.page ?? null
}

/**
 * Collect every template matching the route, ordered outer → inner. At most
 * one template per breadth level (highest priority, document order breaks ties).
 */
export function resolveTemplateChain(
  site: SiteDocument,
  ctx: RouteResolutionContext,
): Page[] {
  const indexed = site.pages.map((page, index) => ({ page, index }))
  const chain: Page[] = []
  for (const level of LEVELS) {
    const winner = indexed
      .filter(({ page }) => isTemplatePage(page) && matchesLevel(page, level, ctx))
      .sort((a, b) => ((b.page.template?.priority ?? 0) - (a.page.template?.priority ?? 0)) || a.index - b.index)[0]
    if (winner) chain.push(winner.page)
  }
  return chain
}

/** Breadth rank: lower wraps higher. Non-template pages are the innermost. */
function levelRank(page: Page): number {
  const target = page.template?.target
  if (!target) return 2
  return target.kind === 'everywhere' ? 0 : 1
}

/**
 * The templates that WRAP `doc` at publish time, ordered outermost-first.
 *
 * `resolveTemplateChain` answers "what renders this *route*"; this answers
 * "what chrome surrounds this *document* when I look at it on its own" — the
 * question every editing/preview surface asks. Both the design canvas
 * (`CanvasComposedTree`) and the authenticated draft preview
 * (`buildRuntimePreviewDocument`) resolve wrappers through here, so a page
 * previews inside the same nav/footer chrome the canvas shows and the
 * published page carries.
 *
 * Breadth levels (outer → inner): `everywhere` (0) → `postTypes` / `notFound`
 * (1) → a non-template page (2, the innermost terminal). A document is wrapped
 * by every matching template strictly broader than its own level:
 *   - a page                → wrapped by the `everywhere` layout;
 *   - a `postTypes` template → wrapped by the `everywhere` layout;
 *   - a `notFound` template  → wrapped by the `everywhere` layout (matching how
 *     the public router composes the 404 render);
 *   - the `everywhere` layout → nothing wraps it (it is the broadest).
 *
 * Empty when nothing wraps `doc`, so `composeTemplateChain(wrappers, …)`
 * returns the document untouched.
 */
export function resolveWrapperTemplates(site: SiteDocument, doc: Page): Page[] {
  const myRank = levelRank(doc)
  // An `everywhere` template (rank 0) is the broadest — never wrapped.
  if (myRank <= 0) return []

  const target = doc.template?.target
  let ctx: RouteResolutionContext
  if (target?.kind === 'postTypes') {
    const tableSlug = target.tableSlugs[0]
    if (!tableSlug) return []
    ctx = { kind: 'entry', tableSlug }
  } else {
    ctx = { kind: 'page' }
  }

  // Keep only templates strictly broader than the document (so a sibling
  // postTypes winner for the same route never wraps another postTypes template)
  // that actually have an outlet to host the wrapped content.
  return resolveTemplateChain(site, ctx).filter(
    (page) => page.id !== doc.id && levelRank(page) < myRank && treeHasOutlet(page),
  )
}
