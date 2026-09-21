/**
 * The public URL a page or a collection entry bakes to.
 *
 * These two functions are the whole of a site's URL shape, and they live in
 * core rather than beside the bake because two different callers have to agree
 * on them exactly:
 *
 *   - the bake itself (`server/publish/publishSite.ts`, `bakeDataRows.ts`),
 *     which writes the files; and
 *   - the pre-flight projection (`Connector/src/mcp/publishProjection.ts`),
 *     which predicts them before anything is imported.
 *
 * AC-C11.3 asks that the routes the pre-flight predicts are the routes that
 * exist after import. A prediction computed by a second implementation can
 * satisfy that on the day it is written and drift the week after, and the drift
 * is invisible: both sides keep agreeing with themselves. So there is one
 * implementation, and the projection imports it from here.
 */

import { normalizeRouteBase } from '../templates/templateMatching'

/**
 * Apply a site's trailing-slash policy to a route it is about to bake.
 *
 * The disk mapping understands both forms — `/foo/` becomes `foo/index.html`
 * and `/foo` becomes `foo.html`. This is the single place that decides which,
 * so the bake, the sitemap and the artefact reader cannot drift into
 * disagreeing about a site's URL shape.
 *
 * `/` is already the site root and is returned untouched in both modes.
 */
export function applyRoutePolicy(urlPath: string, trailingSlash?: boolean): string {
  if (urlPath === '/' || urlPath === '') return '/'
  const bare = urlPath.replace(/\/+$/, '')
  return trailingSlash ? `${bare}/` : bare
}

/** Where one collection entry sits, under its table's route base. */
export function publicRowPath(routeBase: string, slug: string): string {
  const normalizedBase = normalizeRouteBase(routeBase)
  return `${normalizedBase === '/' ? '' : normalizedBase}/${slug}`
}

/**
 * A table's stored route base, from what a bundle declares.
 *
 * This mirrors `routeBaseForCreate` in `server/repositories/data/tables.ts`,
 * and the distinction it draws is easy to lose: an OMITTED route base gets the
 * conventional slug-derived one, while an explicitly EMPTY route base is the
 * persisted sentinel for a table that is deliberately not publicly routed.
 * Treating the two alike predicts public URLs for a table that has opted out.
 */
export function routeBaseForTable(routeBase: string | undefined, slug: string): string {
  if (routeBase === undefined) return normalizeRouteBase(slug)
  const trimmed = routeBase.trim()
  return trimmed === '' ? '' : normalizeRouteBase(trimmed)
}
