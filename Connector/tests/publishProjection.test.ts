/**
 * What a bundle would publish, decided before anything is imported.
 *
 * The case this exists for: a bundle that passes every shape check and then
 * publishes a site with almost no CSS, because the publisher's tree-shake drops
 * rules nothing claims. That took a screenshot to catch. Here it is a number.
 */

import { expect, test } from 'bun:test'
import { projectPublish } from '../src/mcp/publishProjection'

const rule = (id: string, kind: 'class' | 'ambient', selector: string) => ({
  id,
  name: kind === 'class' ? id : selector,
  kind,
  selector,
  order: 0,
  styles: { color: 'red' },
  contextStyles: {},
  createdAt: 0,
  updatedAt: 0,
})

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

test('reports how much CSS survives publishing, and warns when nearly none does', () => {
  const styleRules: Record<string, ReturnType<typeof rule>> = { hero: rule('hero', 'class', '.hero') }
  for (let i = 0; i < 40; i++) styleRules[`orphan-${i}`] = rule(`orphan-${i}`, 'class', `.orphan-${i}`)

  const projection = projectPublish({
    site: { styleRules },
    tables: [{ id: 'pages', slug: 'pages' }],
    rows: [page('p1', 'index', ['hero'])],
  })

  expect(projection.styleRules).toEqual({ inBundle: 41, surviving: 1, dropped: 40 })
  expect(projection.droppedClasses).toContain('orphan-0')
  expect(projection.droppedClasses).not.toContain('hero')
  expect(projection.warnings[0]).toContain('Only 1 of 41 style rules survive')
})

test('classes used only by content HTML or by a site script are kept, and named', () => {
  const projection = projectPublish({
    site: {
      styleRules: {
        hero: rule('hero', 'class', '.hero'),
        'article-quote': rule('article-quote', 'class', '.article-quote'),
        visible: rule('visible', 'class', '.visible'),
        gone: rule('gone', 'class', '.gone'),
      },
      files: [{ type: 'script', content: "el.classList.add('visible')" }],
    },
    tables: [{ id: 'pages', slug: 'pages' }, { id: 'news', slug: 'news', kind: 'postType', routeBase: '/news' }],
    rows: [
      page('p1', 'index', ['hero']),
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
      { id: 'n1', tableId: 'news', slug: 'hello', cells: {} },
    ],
  }

  const flat = projectPublish(bundle)
  expect(flat.routes.map((r) => r.path)).toEqual(['/', '/about-us', '/news-template', '/news/hello'])

  const trailing = projectPublish({ ...bundle, site: { styleRules: {}, settings: { trailingSlash: true } } })
  expect(trailing.routes.map((r) => r.path)).toEqual(['/', '/about-us/', '/news-template/', '/news/hello/'])
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
