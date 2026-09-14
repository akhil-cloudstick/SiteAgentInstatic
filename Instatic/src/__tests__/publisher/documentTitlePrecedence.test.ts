import { describe, expect, it } from 'bun:test'
import '@modules/base'
import { publishPage } from '@core/publisher'
import { makeEmptySiteDocument } from '../siteImport/mockSite'
import { registry } from '@core/module-engine'
import type { Page } from '@core/page-tree'

/**
 * `<title>` precedence.
 *
 * `settings.metaTitle` is a site-wide DEFAULT. Ranking it above the page's own
 * title turned it into a site-wide override, so every page without an explicit
 * SEO title published under one identical title — on a large site, hundreds of
 * documents a crawler cannot tell apart.
 */

function pageWithTitle(title: string): Page {
  return {
    id: 'p1',
    slug: 'about',
    title,
    rootNodeId: 'root',
    nodes: {
      root: { id: 'root', moduleId: 'base.body', props: {}, children: [], classIds: [] },
    },
    ownerUserId: null,
    createdByUserId: null,
    updatedByUserId: null,
  } as Page
}

function titleOf(html: string): string | null {
  return html.match(/<title>([^<]*)<\/title>/)?.[1] ?? null
}

describe('published <title> precedence', () => {
  it('uses the page title over a site-wide metaTitle', () => {
    const site = makeEmptySiteDocument()
    site.settings.metaTitle = 'Site Wide Default'
    const { html } = publishPage(pageWithTitle('About Us'), site, registry, {})
    expect(titleOf(html)).toBe('About Us')
  })

  it('falls back to metaTitle only when the page has no title', () => {
    const site = makeEmptySiteDocument()
    site.settings.metaTitle = 'Site Wide Default'
    const { html } = publishPage(pageWithTitle(''), site, registry, {})
    expect(titleOf(html)).toBe('Site Wide Default')
  })

  it('lets an explicit SEO title beat both', () => {
    const site = makeEmptySiteDocument()
    site.settings.metaTitle = 'Site Wide Default'
    const { html } = publishPage(pageWithTitle('About Us'), site, registry, {
      seo: { title: 'About Us — Rooms, Rates & Directions' },
    })
    expect(titleOf(html)).toBe('About Us — Rooms, Rates &amp; Directions')
  })

  it('gives two different pages two different titles', () => {
    // The regression that matters: the whole point is that N pages do not all
    // publish under one title.
    const site = makeEmptySiteDocument()
    site.settings.metaTitle = 'Site Wide Default'
    const a = publishPage(pageWithTitle('Rooms'), site, registry, {}).html
    const b = publishPage(pageWithTitle('Dining'), site, registry, {}).html
    expect(titleOf(a)).toBe('Rooms')
    expect(titleOf(b)).toBe('Dining')
    expect(titleOf(a)).not.toBe(titleOf(b))
  })
})
