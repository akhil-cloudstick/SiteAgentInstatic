/**
 * What a bundle would publish, decided before anything is imported.
 *
 * The case this exists for: a bundle that passes every shape check and then
 * publishes a site with almost no CSS, because the publisher's tree-shake drops
 * rules nothing claims. That took a screenshot to catch. Here it is a number.
 */

import { expect, test } from 'bun:test'
import { projectPublish } from '../src/mcp/publishProjection'

/**
 * A style rule whose id is NOT its name.
 *
 * This fixture used to set `name = id` for class rules. Real bundles never do —
 * ids are opaque, names are what an author typed — and the projection had a bug
 * that only a bundle like this one can see: it tested rule names against a set
 * of rule ids, so both "kept for" lists came back empty for every real bundle
 * while the suite agreed with itself.
 */
const ruleId = (name: string) => `sr_${name.replace(/[^a-z0-9]/gi, '')}_7f3a`

const rule = (name: string, kind: 'class' | 'ambient', selector: string) => ({
  id: ruleId(name),
  name: kind === 'class' ? name : selector,
  kind,
  selector,
  order: 0,
  styles: { color: 'red' },
  contextStyles: {},
  createdAt: 0,
  updatedAt: 0,
})

/** styleRules is keyed by id, exactly as a real bundle is. */
const rulesByName = (...rules: ReturnType<typeof rule>[]) =>
  Object.fromEntries(rules.map((r) => [r.id, r]))

const page = (id: string, slug: string, classIds: string[] = []) => ({
  id,
  tableId: 'pages',
  slug,
  cells: {
    title: slug,
    body: {
      rootNodeId: `${id}-root`,
      nodes: { [`${id}-root`]: { id: `${id}-root`, moduleId: 'base.container', props: {}, children: [], classIds } },
    },
  },
})

const entryTemplate = (id: string, tableSlug: string) => ({
  id,
  tableId: 'pages',
  slug: `${tableSlug}-template`,
  cells: {
    title: 'Entry template',
    templateEnabled: true,
    templateTarget: { kind: 'postTypes', tableSlugs: [tableSlug] },
    templatePriority: 100,
    body: {
      rootNodeId: `${id}-root`,
      nodes: {
        [`${id}-root`]: { id: `${id}-root`, moduleId: 'base.container', props: {}, children: [`${id}-out`], classIds: [] },
        [`${id}-out`]: { id: `${id}-out`, moduleId: 'base.outlet', props: {}, children: [], classIds: [] },
      },
    },
  },
})

test('reports how much CSS survives publishing, and blocks when nearly none does', () => {
  const rules = [rule('hero', 'class', '.hero')]
  for (let i = 0; i < 40; i++) rules.push(rule(`orphan-${i}`, 'class', `.orphan-${i}`))

  const projection = projectPublish({
    site: { styleRules: rulesByName(...rules) },
    tables: [{ id: 'pages', slug: 'pages' }],
    rows: [page('p1', 'index', [ruleId('hero')])],
  })

  expect(projection.styleRules).toEqual({ inBundle: 41, surviving: 1, dropped: 40 })
  expect(projection.droppedClasses).toContain('orphan-0')
  expect(projection.droppedClasses).not.toContain('hero')
  expect(projection.warnings[0]).toContain('Only 1 of 41 style rules survive')

  // AC-C11.1: it is not enough to report it.
  expect(projection.ok).toBe(false)
  expect(projection.findings.map((f) => [f.code, f.severity])).toEqual([['STYLE_RULES_MOSTLY_DROPPED', 'block']])
})

/**
 * The two builds from the incident, pinned as numbers (PRD 5.5).
 *
 * v4 is the bundle that went live nearly unstyled: 8 of 617 rules survived. v7
 * is the RECOVERY at 600 of 666. The PRD warns specifically against calibrating
 * this threshold against v7 — doing so "would set the threshold against a bundle
 * that was fine". Both directions are asserted here so a future tightening has
 * to break a test that names the reason.
 */
test('the incident blocks and the recovery passes (PRD 5.5)', () => {
  const bundleWith = (total: number, surviving: number) => {
    const used = Array.from({ length: surviving }, (_, i) => rule(`used-${i}`, 'class', `.used-${i}`))
    const orphaned = Array.from({ length: total - surviving }, (_, i) => rule(`dead-${i}`, 'class', `.dead-${i}`))
    return {
      site: { styleRules: rulesByName(...used, ...orphaned) },
      tables: [{ id: 'pages', slug: 'pages' }],
      rows: [page('p1', 'index', used.map((r) => r.id))],
    }
  }

  const v4 = projectPublish(bundleWith(617, 8))
  expect(v4.styleRules).toEqual({ inBundle: 617, surviving: 8, dropped: 609 })
  expect(v4.ok).toBe(false)
  expect(v4.findings[0]!.message).toContain('Only 8 of 617 style rules survive')

  const v7 = projectPublish(bundleWith(666, 600))
  expect(v7.styleRules).toEqual({ inBundle: 666, surviving: 600, dropped: 66 })
  expect(v7.ok).toBe(true)
  expect(v7.findings).toEqual([])
})

test('classes used only by content HTML or by a site script are kept, and named', () => {
  const projection = projectPublish({
    site: {
      styleRules: rulesByName(
        rule('hero', 'class', '.hero'),
        rule('article-quote', 'class', '.article-quote'),
        rule('visible', 'class', '.visible'),
        rule('gone', 'class', '.gone'),
      ),
      files: [{ type: 'script', content: "el.classList.add('visible')" }],
    },
    tables: [{ id: 'pages', slug: 'pages' }, { id: 'news', slug: 'news', kind: 'postType', routeBase: '/news' }],
    rows: [
      page('p1', 'index', [ruleId('hero')]),
      entryTemplate('t1', 'news'),
      { id: 'n1', tableId: 'news', slug: 'hello', cells: { body: '<blockquote class="article-quote">q</blockquote>' } },
    ],
  })

  expect(projection.keptForContentHtml).toEqual(['article-quote'])
  expect(projection.keptForScripts).toEqual(['visible'])
  expect(projection.droppedClasses).toEqual(['gone'])
  expect(projection.scriptFiles).toBe(1)
})

test('resolves the public routes rows would publish at, honouring trailingSlash', () => {
  const bundle = {
    site: { styleRules: {} },
    tables: [{ id: 'pages', slug: 'pages' }, { id: 'news', slug: 'news', kind: 'postType', routeBase: '/news' }],
    rows: [
      page('p1', 'index'),
      page('p2', 'about-us'),
      entryTemplate('t1', 'news'),
      { id: 'n1', tableId: 'news', slug: 'hello', cells: {}, status: 'published' },
    ],
  }

  const flat = projectPublish(bundle)
  expect(flat.routes.map((r) => r.path)).toEqual(['/', '/about-us', '/news/hello'])

  const trailing = projectPublish({ ...bundle, site: { styleRules: {}, settings: { trailingSlash: true } } })
  expect(trailing.routes.map((r) => r.path)).toEqual(['/', '/about-us/', '/news/hello/'])
})

/**
 * AC-C11.3: "the routes it predicted exist after import".
 *
 * These are the two cases where the prediction used to name a URL the bake
 * provably never writes. Both were asserted the wrong way round by the previous
 * version of this file — `/news-template` was in its expected list.
 */
test('never predicts a route the bake would skip: template pages and unpublished rows', () => {
  const projection = projectPublish({
    site: { styleRules: {} },
    tables: [{ id: 'pages', slug: 'pages' }, { id: 'news', slug: 'news', kind: 'postType', routeBase: '/news' }],
    rows: [
      page('p1', 'index'),
      // A template page only ever wraps another page. It is never baked at its
      // own slug (`isTemplatePage`, publishSite.ts:314).
      entryTemplate('t1', 'news'),
      { id: 'n1', tableId: 'news', slug: 'live', cells: {}, status: 'published' },
      // Baking filters rows on `status = 'published'`, so this one lands as
      // content and publishes no page.
      { id: 'n2', tableId: 'news', slug: 'still-a-draft', cells: {}, status: 'draft' },
    ],
  })

  expect(projection.routes.map((r) => r.path)).toEqual(['/', '/news/live'])
  expect(projection.routes.map((r) => r.path)).not.toContain('/news-template')
  expect(projection.routes.map((r) => r.path)).not.toContain('/news/still-a-draft')
})

test('a table with no entry template publishes no row routes, and says so', () => {
  const projection = projectPublish({
    site: { styleRules: {} },
    tables: [{ id: 'pages', slug: 'pages' }, { id: 'news', slug: 'news', kind: 'postType', routeBase: '/news' }],
    rows: [page('p1', 'index'), { id: 'n1', tableId: 'news', slug: 'hello', cells: {}, status: 'published' }],
  })

  // The bake skips the rows of a table with no entry-template chain
  // (bakeDataRows.ts:88), so predicting `/news/hello` would be predicting a 404.
  expect(projection.routes.map((r) => r.path)).toEqual(['/'])
  expect(projection.ok).toBe(false)
  expect(projection.findings[0]!.code).toBe('ENTRY_ROWS_WITHOUT_TEMPLATE')
})

test('a table that opted out of public routing gets no routes predicted for it', () => {
  // An omitted routeBase takes the conventional slug-derived one; an explicitly
  // EMPTY routeBase is the stored sentinel for "not publicly routed"
  // (`routeBaseForCreate`, repositories/data/tables.ts). Treating the two alike
  // predicts public URLs for a table that asked for none.
  const rows = [
    page('p1', 'index'),
    entryTemplate('t1', 'news'),
    { id: 'n1', tableId: 'news', slug: 'hello', cells: {}, status: 'published' },
  ]
  const omitted = projectPublish({
    site: { styleRules: {} },
    tables: [{ id: 'pages', slug: 'pages' }, { id: 'news', slug: 'news', kind: 'postType' }],
    rows,
  })
  expect(omitted.routes.map((r) => r.path)).toEqual(['/', '/news/hello'])

  const optedOut = projectPublish({
    site: { styleRules: {} },
    tables: [{ id: 'pages', slug: 'pages' }, { id: 'news', slug: 'news', kind: 'postType', routeBase: '' }],
    rows,
  })
  expect(optedOut.routes.map((r) => r.path)).toEqual(['/', '/hello'])
})

test('a collection with rows and no entry template is reported, and warned about', () => {
  const withTemplate = projectPublish({
    site: { styleRules: {} },
    tables: [{ id: 'pages', slug: 'pages' }, { id: 'news', slug: 'news', kind: 'postType', routeBase: '/news' }],
    rows: [page('p1', 'index'), entryTemplate('t1', 'news'), { id: 'n1', tableId: 'news', slug: 'hello', cells: {} }],
  })
  expect(withTemplate.entryTemplates).toEqual([{ tableSlug: 'news', rows: 1, hasTemplate: true }])
  expect(withTemplate.warnings).toEqual([])

  const without = projectPublish({
    site: { styleRules: {} },
    tables: [{ id: 'pages', slug: 'pages' }, { id: 'news', slug: 'news', kind: 'postType', routeBase: '/news' }],
    rows: [page('p1', 'index'), { id: 'n1', tableId: 'news', slug: 'hello', cells: {} }],
  })
  expect(without.entryTemplates).toEqual([{ tableSlug: 'news', rows: 1, hasTemplate: false }])
  expect(without.warnings[0]).toContain('"news" has 1 row(s) and no entry template')
})

test('an empty or malformed bundle projects rather than throwing', () => {
  expect(projectPublish({}).warnings).toContain('This bundle carries no pages.')
  expect(projectPublish(null).styleRules).toEqual({ inBundle: 0, surviving: 0, dropped: 0 })
  expect(projectPublish({ rows: [{ tableId: 'pages' }] }).routes).toEqual([])
})
