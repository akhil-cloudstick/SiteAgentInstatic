/**
 * What this bundle would actually publish, computed before anything is imported.
 *
 * A shape check validates a bundle against itself, which is why a bundle whose
 * CSS almost entirely fails the publisher's tree-shake passed every gate and
 * two imports: 8 of 617 style rules survived, and only a screenshot said so.
 * The publisher's own decisions are the missing oracle, so this runs the real
 * ones — `collectUsedStyleRuleIds`, `treeShakeStyleRules`, the same content and
 * script class collectors, and the real template chain resolver — over the
 * bundle's own content, with no CMS involved.
 *
 * It answers three questions a sender cannot otherwise ask without a deploy:
 * which style rules survive publishing and which classes lose theirs, which
 * public routes the rows resolve to, and whether each collection's entries have
 * a template to render into.
 */

import {
  collectContentClassNames,
  collectScriptClassNames,
  collectUsedStyleRuleIds,
  treeShakeStyleRules,
} from '@core/publisher'
import { resolveTemplateChain } from '@core/templates'
import { normalizeRouteBase } from '@core/templates/templateMatching'
import { pageFromRow } from '@core/data/pageFromRow'
import type { Page, SiteDocument, StyleRule } from '@core/page-tree'
import type { DataRow } from '@core/data/schemas'

/** The parts of a bundle this reads. Tolerant: a bundle missing any of it still projects. */
interface BundleLike {
  site?: {
    styleRules?: Record<string, StyleRule>
    files?: { type?: string; content?: string }[]
    settings?: { trailingSlash?: boolean }
    visualComponents?: unknown[]
  }
  tables?: { id?: unknown; slug?: unknown; kind?: unknown; routeBase?: unknown }[]
  rows?: { id?: unknown; tableId?: unknown; slug?: unknown; cells?: unknown }[]
}

export interface PublishProjection {
  styleRules: { inBundle: number; surviving: number; dropped: number }
  /** Class-rule names whose CSS the publish would drop — the classes that lose their styling. */
  droppedClasses: string[]
  /** Classes kept only because content HTML or a site script uses them. */
  keptForContentHtml: string[]
  keptForScripts: string[]
  routes: { path: string; table: string; rowId: string }[]
  entryTemplates: { tableSlug: string; rows: number; hasTemplate: boolean }[]
  scriptFiles: number
  /** Findings worth refusing over, in the sender's own terms. */
  warnings: string[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function pagesOf(bundle: BundleLike): Page[] {
  const pages: Page[] = []
  for (const row of bundle.rows ?? []) {
    if (str(row.tableId) !== 'pages') continue
    pages.push(pageFromRow({
      id: str(row.id),
      tableId: 'pages',
      slug: str(row.slug),
      cells: (row.cells ?? {}) as Record<string, unknown>,
      authorUserId: null,
    } as unknown as DataRow))
  }
  return pages
}

function routeFor(base: string, slug: string, trailingSlash: boolean): string {
  const path = base === '/' ? `/${slug}` : `${base}/${slug}`
  if (!trailingSlash) return path
  return path.endsWith('/') ? path : `${path}/`
}

export function projectPublish(bundleValue: unknown): PublishProjection {
  const bundle = (bundleValue ?? {}) as BundleLike
  const site = bundle.site ?? {}
  const styleRules = site.styleRules ?? {}
  const rows = bundle.rows ?? []
  const tables = bundle.tables ?? []
  const trailingSlash = site.settings?.trailingSlash === true

  const pages = pagesOf(bundle)
  const contentClassNames = collectContentClassNames(rows.map((row) => row.cells))
  const scriptClassNames = collectScriptClassNames(site.files ?? [])
  const usedIds = collectUsedStyleRuleIds({
    pages,
    visualComponents: (site.visualComponents ?? []) as SiteDocument['visualComponents'],
  })

  const surviving = treeShakeStyleRules(
    styleRules,
    usedIds,
    new Set([...contentClassNames, ...scriptClassNames]),
  )
  const survivingIds = new Set(Object.keys(surviving))
  const all = Object.values(styleRules)
  const droppedClasses = all
    .filter((rule) => rule.kind === 'class' && !survivingIds.has(rule.id))
    .map((rule) => rule.name)
    .sort()

  const nodeClassNames = new Set(
    all.filter((rule) => rule.kind === 'class' && usedIds.has(rule.id)).map((rule) => rule.name),
  )
  const keptOnly = (names: Set<string>) =>
    [...names].filter((name) => !nodeClassNames.has(name) && survivingIds.has(name)).sort()

  // Routes, as the publisher resolves them: pages at their slug, collection
  // entries under their table's route base.
  const routes: PublishProjection['routes'] = []
  for (const row of rows) {
    const tableId = str(row.tableId)
    const slug = str(row.slug)
    if (!slug) continue
    if (tableId === 'pages') {
      routes.push({ path: slug === 'index' ? '/' : routeFor('/', slug, trailingSlash), table: 'pages', rowId: str(row.id) })
      continue
    }
    const table = tables.find((t) => str(t.id) === tableId)
    const tableSlug = str(table?.slug) || tableId
    const base = normalizeRouteBase(str(table?.routeBase) || `/${tableSlug}`)
    routes.push({ path: routeFor(base, slug, trailingSlash), table: tableSlug, rowId: str(row.id) })
  }

  // Entry templates: a collection whose entries have no template renders no
  // page for any of its rows, however many rows arrived.
  const siteForTemplates = { ...site, pages } as unknown as SiteDocument
  const entryTemplates: PublishProjection['entryTemplates'] = []
  for (const table of tables) {
    const tableSlug = str(table.slug) || str(table.id)
    if (!tableSlug || tableSlug === 'pages') continue
    const count = rows.filter((row) => str(row.tableId) === str(table.id)).length
    if (count === 0 && str(table.kind) !== 'postType') continue
    let hasTemplate = false
    try {
      hasTemplate = resolveTemplateChain(siteForTemplates, { kind: 'entry', tableSlug }).length > 0
    } catch {
      hasTemplate = false
    }
    entryTemplates.push({ tableSlug, rows: count, hasTemplate })
  }

  const warnings: string[] = []
  const inBundle = all.length
  const survivingCount = survivingIds.size
  if (inBundle > 0 && survivingCount * 4 < inBundle) {
    warnings.push(
      `Only ${survivingCount} of ${inBundle} style rules survive the publish tree-shake. A published ` +
        'site would render with almost none of this bundle\'s CSS.',
    )
  }
  for (const entry of entryTemplates) {
    if (entry.rows > 0 && !entry.hasTemplate) {
      warnings.push(
        `"${entry.tableSlug}" has ${entry.rows} row(s) and no entry template in this bundle, so none of ` +
          'them publishes a page.',
      )
    }
  }
  if (pages.length === 0) warnings.push('This bundle carries no pages.')

  return {
    styleRules: { inBundle, surviving: survivingCount, dropped: inBundle - survivingCount },
    droppedClasses,
    keptForContentHtml: keptOnly(contentClassNames),
    keptForScripts: keptOnly(scriptClassNames),
    routes,
    entryTemplates,
    scriptFiles: (site.files ?? []).filter((file) => file?.type === 'script').length,
    warnings,
  }
}
