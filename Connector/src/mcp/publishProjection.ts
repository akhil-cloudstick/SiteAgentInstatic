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
  applyRoutePolicy,
  collectContentClassNames,
  collectScriptClassNames,
  collectUsedStyleRuleIds,
  publicRowPath,
  routeBaseForTable,
  treeShakeStyleRules,
} from '@core/publisher'
import { resolveTemplateChain } from '@core/templates'
import { isTemplatePage } from '@core/templates/templateMatching'
import { exportBundle } from '../http/client'
import type { InstaticSession } from '../http/session'
import { bundleFromArchive } from './bundleSource'
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
  rows?: { id?: unknown; tableId?: unknown; slug?: unknown; cells?: unknown; status?: unknown }[]
}

/**
 * How seriously a finding is taken.
 *
 * `block` means this bundle does not get imported. `warn` means it is worth
 * saying and not worth refusing over.
 *
 * The split is drawn from AC-C11.1, which names one case specifically: a bundle
 * whose surviving-rule count is low must be "blocked or marked not-importable".
 * Rows that resolve to no template are the same kind of fault — content that
 * arrives and renders nothing — so they block too. A bundle carrying no pages
 * only warns: a bundle of collection entries alone is a legitimate thing to
 * send, and refusing it would block a correct push to prevent a hypothetical.
 */
export type FindingSeverity = 'block' | 'warn'

export interface Finding {
  /** Stable across wordings, so a caller can gate on it without parsing prose. */
  code: 'STYLE_RULES_MOSTLY_DROPPED' | 'ENTRY_ROWS_WITHOUT_TEMPLATE' | 'NO_PAGES'
  severity: FindingSeverity
  /** The same sentence `warnings` has always carried. */
  message: string
  detail: Record<string, unknown>
}

export interface PublishProjection {
  /** False when any finding blocks. The one field a gate needs to read. */
  ok: boolean
  findings: Finding[]
  styleRules: { inBundle: number; surviving: number; dropped: number }
  /** Class-rule names whose CSS the publish would drop — the classes that lose their styling. */
  droppedClasses: string[]
  /** Classes kept only because content HTML or a site script uses them. */
  keptForContentHtml: string[]
  keptForScripts: string[]
  routes: { path: string; table: string; rowId: string }[]
  entryTemplates: { tableSlug: string; rows: number; hasTemplate: boolean }[]
  scriptFiles: number
  /**
   * The findings' messages, in order. Kept because it is what a person reads;
   * `findings` is what a gate reads. Both are derived from the same list, so
   * they cannot describe different bundles.
   */
  warnings: string[]
}

/**
 * The refusal a blocking projection earns, or null when nothing blocks.
 *
 * WHERE THIS IS SOUND, and where it is not. The projection is computed from the
 * bundle alone, so it describes the resulting site exactly when the bundle IS
 * the resulting site — a replace. On a merge or a draft import the bundle is
 * only part of what will be published: a rule this bundle's own pages do not use
 * may be used by a page already on the site, and rows with no template here may
 * render through a template already installed there. Blocking those on a
 * bundle-only projection would refuse correct pushes.
 *
 * So the import gate blocks replaces, every path reports, and the publish gate —
 * computed against the draft as actually held — is what catches a site that
 * would bake broken however its content got there.
 */
export function preflightRefusal(
  projection: PublishProjection,
  context: 'import' | 'publish' = 'import',
): { message: string; detail: Record<string, unknown> } | null {
  // A site with no pages bakes nothing. On the import path that only warns,
  // because a bundle carrying collection entries alone is a legitimate thing to
  // send into a site that already has pages. At publish time there is no "rest
  // of the site" to lean on — what is projected IS what goes live — so the same
  // finding is disqualifying.
  const blocking = projection.findings.filter(
    (f) => f.severity === 'block' || (context === 'publish' && f.code === 'NO_PAGES'),
  )
  if (blocking.length === 0) return null
  const stopped =
    context === 'publish'
      ? 'Pre-flight refused this publish. The site as it stands would bake broken.'
      : 'Pre-flight refused this bundle before importing it.'
  const consequence =
    context === 'publish'
      ? 'Nothing was published and the live site is untouched. The approval was NOT spent.'
      : 'Nothing was sent to the CMS.'
  return {
    message:
      `${stopped} ${blocking.map((f) => f.message).join(' ')} ${consequence} ` +
      'There is no override: a check that can be waived is the check that gets waived on the day ' +
      'it matters.',
    detail: {
      preflight: {
        ok: false,
        blocked: blocking.map((f) => f.code),
        findings: projection.findings,
        styleRules: projection.styleRules,
      },
    },
  }
}

/**
 * The site as the CMS holds it now, in the shape the projection reads.
 *
 * This is how the publish side gets an oracle. `projectPublish` needs content,
 * and by publish time there is no bundle — the draft may have arrived by a
 * bundle import, a draft import, or a person editing in the admin, and only the
 * last of those has ever been checked by anything. Exporting the site is what
 * turns "the draft as held" back into a bundle, so one implementation of the
 * projection answers for all three routes in.
 *
 * Content only: media bytes cost a great deal to move and the projection reads
 * none of them.
 */
export async function currentDraftBundle(session: InstaticSession): Promise<unknown> {
  const archive = await exportBundle(session, { includeMedia: false })
  const resolved = bundleFromArchive(archive)
  if (!resolved.ok) {
    // The check could not run. That is not a pass — it is reported as its own
    // failure so a publish never proceeds on "we could not tell".
    throw new Error(
      `The pre-flight could not read the site's own export, so this publish cannot be checked: ${resolved.reason}`,
    )
  }
  return resolved.value.bundle
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

// There is no local route builder any more. It was a second implementation of
// the bake's URL shaping, free to drift from it without either side noticing —
// and it had drifted: it predicted routes for template pages and for unpublished
// rows, neither of which the bake ever writes. `applyRoutePolicy`,
// `publicRowPath` and `routeBaseForTable` are now imported from the publisher
// itself (AC-C11.3).

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
  // Rule NAMES that survive — not ids. `survivingIds` is keyed by id, and this
  // used to test a name against it, so both "kept for" lists silently came back
  // empty for every real bundle. The fixture set name === id, which is the only
  // reason the suite agreed.
  const survivingClassNames = new Set(
    all.filter((rule) => rule.kind === 'class' && survivingIds.has(rule.id)).map((rule) => rule.name),
  )
  const keptOnly = (names: Set<string>) =>
    [...names].filter((name) => !nodeClassNames.has(name) && survivingClassNames.has(name)).sort()

  // Entry templates: a collection whose entries have no template renders no
  // page for any of its rows, however many rows arrived. Computed BEFORE the
  // routes now, because the bake skips such a table's rows entirely and so must
  // the prediction.
  const siteForTemplates = { ...site, pages } as unknown as SiteDocument
  const entryTemplates: PublishProjection['entryTemplates'] = []
  const tableHasTemplate = new Map<string, boolean>()
  for (const table of tables) {
    const tableSlug = str(table.slug) || str(table.id)
    if (!tableSlug || tableSlug === 'pages') continue
    const count = rows.filter((row) => str(row.tableId) === str(table.id)).length
    let hasTemplate = false
    try {
      hasTemplate = resolveTemplateChain(siteForTemplates, { kind: 'entry', tableSlug }).length > 0
    } catch {
      hasTemplate = false
    }
    tableHasTemplate.set(str(table.id), hasTemplate)
    if (count === 0 && str(table.kind) !== 'postType') continue
    entryTemplates.push({ tableSlug, rows: count, hasTemplate })
  }

  // Routes, exactly as the bake enumerates them. Three rules here are not
  // cosmetic — each one was predicting a URL that never appears on the site:
  //
  //   1. a template page is never baked at its own slug; it only ever wraps
  //      something else (`isTemplatePage`, publishSite.ts:314);
  //   2. a collection row is baked only when its status is `published`
  //      (the `status = 'published'` clause in listPublishedRowRoutes);
  //   3. a collection row is baked only when its table HAS an entry-template
  //      chain (bakeDataRows.ts:88) — the rows of a table without one publish
  //      nothing, which is already reported as a blocking finding.
  //
  // Pages are deliberately NOT status-filtered: the page bake reads every
  // non-deleted row regardless of status, so filtering them here would under-
  // predict. That asymmetry is real, and copying the bake is the point.
  const routes: PublishProjection['routes'] = []
  const isPublished = (row: { cells?: unknown; status?: unknown }): boolean => {
    const cells = (row.cells ?? {}) as Record<string, unknown>
    const status = row.status ?? cells.status
    return status === 'published'
  }
  for (const row of rows) {
    const tableId = str(row.tableId)
    const slug = str(row.slug)
    if (!slug) continue
    if (tableId === 'pages') {
      const page = pages.find((p) => p.id === str(row.id))
      if (page && isTemplatePage(page)) continue
      routes.push({
        path: applyRoutePolicy(slug === 'index' ? '/' : `/${slug}`, trailingSlash),
        table: 'pages',
        rowId: str(row.id),
      })
      continue
    }
    if (!isPublished(row)) continue
    if (tableHasTemplate.get(tableId) !== true) continue
    const table = tables.find((t) => str(t.id) === tableId)
    const tableSlug = str(table?.slug) || tableId
    const base = routeBaseForTable(
      typeof table?.routeBase === 'string' ? table.routeBase : undefined,
      tableSlug,
    )
    routes.push({
      path: applyRoutePolicy(publicRowPath(base, slug), trailingSlash),
      table: tableSlug,
      rowId: str(row.id),
    })
  }

  const findings: Finding[] = []
  const inBundle = all.length
  const survivingCount = survivingIds.size

  // The threshold that caught the incident, kept at a quarter deliberately.
  //
  // PRD 5.5 is a warning against calibrating this against the wrong build: the
  // incident was v4, at 8 of 617 rules (1.3%), while v7 — 600 of 666 (90%) —
  // was the RECOVERY. Tightening the bar toward v7's numbers "would set the
  // threshold against a bundle that was fine". A quarter blocks the first and
  // passes the second with room to spare, and both are pinned as fixtures.
  if (inBundle > 0 && survivingCount * 4 < inBundle) {
    findings.push({
      code: 'STYLE_RULES_MOSTLY_DROPPED',
      severity: 'block',
      message:
        `Only ${survivingCount} of ${inBundle} style rules survive the publish tree-shake. A published ` +
        "site would render with almost none of this bundle's CSS.",
      detail: { surviving: survivingCount, inBundle, droppedClasses: droppedClasses.slice(0, 50) },
    })
  }
  for (const entry of entryTemplates) {
    if (entry.rows > 0 && !entry.hasTemplate) {
      findings.push({
        code: 'ENTRY_ROWS_WITHOUT_TEMPLATE',
        severity: 'block',
        message:
          `"${entry.tableSlug}" has ${entry.rows} row(s) and no entry template in this bundle, so none of ` +
          'them publishes a page.',
        detail: { tableSlug: entry.tableSlug, rows: entry.rows },
      })
    }
  }
  if (pages.length === 0) {
    findings.push({
      code: 'NO_PAGES',
      severity: 'warn',
      message: 'This bundle carries no pages.',
      detail: {},
    })
  }

  return {
    ok: !findings.some((f) => f.severity === 'block'),
    findings,
    styleRules: { inBundle, surviving: survivingCount, dropped: inBundle - survivingCount },
    droppedClasses,
    keptForContentHtml: keptOnly(contentClassNames),
    keptForScripts: keptOnly(scriptClassNames),
    routes,
    entryTemplates,
    scriptFiles: (site.files ?? []).filter((file) => file?.type === 'script').length,
    warnings: findings.map((f) => f.message),
  }
}
