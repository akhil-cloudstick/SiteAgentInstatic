/**
 * getPublishedContentClassNames — the classes published row HTML uses, read
 * once per publish version — and the page-invariant CSS memo keyed on them.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { getPublishedContentClassNames } from '../../../server/publish/contentClassNames'
import { buildPublishedSiteCssBundle } from '../../../server/publish/siteCssBundle'
import { bumpPublishVersion, resetPublishStateForTests } from '../../../server/publish/publishState'
import type { DbClient } from '../../../server/db/client'
import { makeModule, makePage, makeRegistry, makeSite } from '../publisher/helpers'

function fakeDb(cells: unknown[]): { db: DbClient; queries: () => number } {
  let count = 0
  const db = (async () => {
    count++
    return { rows: cells.map((cells_json) => ({ cells_json })) }
  }) as unknown as DbClient
  return { db, queries: () => count }
}

describe('getPublishedContentClassNames', () => {
  beforeEach(() => resetPublishStateForTests())

  it('reads the classes out of every published row, including cells returned as JSON text', async () => {
    const { db } = fakeDb([
      { body: '<blockquote class="article-quote">q</blockquote>' },
      { body: { nodes: {}, rootNodeId: 'root' } },
      JSON.stringify({ body: '<figure class="article-figure">' }),
    ])
    const names = await getPublishedContentClassNames(db)
    expect([...names].sort()).toEqual(['article-figure', 'article-quote'])
  })

  it('queries once per publish version', async () => {
    const { db, queries } = fakeDb([{ body: '<p class="lede">x</p>' }])
    await getPublishedContentClassNames(db)
    await getPublishedContentClassNames(db)
    expect(queries()).toBe(1)
    bumpPublishVersion()
    await getPublishedContentClassNames(db)
    expect(queries()).toBe(2)
  })
})

describe('buildPublishedSiteCssBundle — content classes', () => {
  beforeEach(() => resetPublishStateForTests())

  it('does not serve a style file memoised without the content classes', () => {
    const registry = makeRegistry({
      'base.text': makeModule('base.text', { render: () => ({ html: '<p>x</p>' }) }),
    })
    const site = makeSite({
      styleRules: {
        'article-quote': {
          id: 'article-quote',
          name: 'article-quote',
          kind: 'class',
          selector: '.article-quote',
          order: 0,
          styles: { paddingTop: '28px' },
          contextStyles: {},
          createdAt: 0,
          updatedAt: 0,
        },
      },
    })
    site.pages = [makePage({ root: { moduleId: 'base.text', props: { text: 'Hi' } } })]

    const without = buildPublishedSiteCssBundle(site, registry, site.pages[0])
    const withNames = buildPublishedSiteCssBundle(site, registry, site.pages[0], undefined, {
      contentClassNames: new Set(['article-quote']),
    })
    expect(without.style.content).not.toContain('.article-quote')
    expect(withNames.style.content).toContain('.article-quote')
    expect(withNames.style.hash).not.toBe(without.style.hash)
  })
})
