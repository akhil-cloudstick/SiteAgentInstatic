/**
 * The published `<head>` must carry a document's own SEO.
 *
 * Two failures live here, and they are different from each other:
 *
 *  1. The head builder used to read site settings only, so a stored `seoTitle`
 *     or `canonicalUrl` rendered nowhere at all.
 *  2. Once it read the entry stack, collection entries worked and PAGES still
 *     did not — a page has no entry stack, and `SiteDocument.pages[]` is a page
 *     tree that never carried the row's cells. Pages therefore published with
 *     no canonical and no JSON-LD while entries published with both.
 *
 * The second is the one that blocks moving a real domain onto the CMS, so the
 * explicit-override path is pinned here alongside the entry path.
 */
import { describe, expect, it } from 'bun:test'
import { documentSeoFromCells, publishPage } from '@core/publisher'
import { makeModule, makePage, makeRegistry, makeSite } from './helpers'

const registry = makeRegistry({
  'base.body': makeModule('base.body', {
    canHaveChildren: true,
    render: (_p, children) => ({ html: `<main>${children.join('')}</main>` }),
  }),
})

describe('documentSeoFromCells', () => {
  it('maps the row cells the head builder emits', () => {
    expect(
      documentSeoFromCells({
        seoTitle: 'Rooms',
        seoDescription: 'Every room',
        canonicalUrl: 'https://thelovedale.com/rooms',
        jsonLd: '{"@type":"Hotel"}',
      }),
    ).toEqual({
      title: 'Rooms',
      description: 'Every room',
      canonicalUrl: 'https://thelovedale.com/rooms',
      ogTitle: undefined,
      ogDescription: undefined,
      ogImage: undefined,
      jsonLd: '{"@type":"Hotel"}',
    })
  })

  it('falls back to the featured image for the social card', () => {
    const seo = documentSeoFromCells({ featuredMediaUrl: 'https://cdn.test/a.jpg' })
    expect(seo.ogImage).toBe('https://cdn.test/a.jpg')
  })

  it('ignores blank and non-string cells rather than emitting empty tags', () => {
    expect(documentSeoFromCells({ seoTitle: '   ', canonicalUrl: 42, jsonLd: null })).toEqual({
      title: undefined,
      description: undefined,
      canonicalUrl: undefined,
      ogTitle: undefined,
      ogDescription: undefined,
      ogImage: undefined,
      jsonLd: undefined,
    })
  })
})

describe('publishPage document head — page path', () => {
  const page = makePage({ root: { moduleId: 'base.body' } })
  const site = makeSite({ pages: [page] })

  it('emits canonical, Open Graph and JSON-LD from an explicit page override', () => {
    const { html } = publishPage(page, site, registry, {
      seo: documentSeoFromCells({
        seoTitle: 'Kodaikanal stays',
        seoDescription: 'Two days in the hills',
        canonicalUrl: 'https://thelovedale.com/blog/two-days-in-kodaikanal',
        jsonLd: '{"@context":"https://schema.org","@type":"BlogPosting"}',
      }),
    })

    expect(html).toContain('<title>Kodaikanal stays</title>')
    expect(html).toContain('<meta name="description" content="Two days in the hills">')
    expect(html).toContain(
      '<link rel="canonical" href="https://thelovedale.com/blog/two-days-in-kodaikanal">',
    )
    expect(html).toContain('<meta property="og:title" content="Kodaikanal stays">')
    expect(html).toContain(
      '<meta property="og:url" content="https://thelovedale.com/blog/two-days-in-kodaikanal">',
    )
    expect(html).toContain('<script type="application/ld+json">')
    expect(html).toContain('"@type":"BlogPosting"')
  })

  it('emits no canonical and no og block for a page that carries no SEO', () => {
    const { html } = publishPage(page, site, registry)
    expect(html).not.toContain('rel="canonical"')
    expect(html).not.toContain('property="og:')
    expect(html).not.toContain('application/ld+json')
  })

  it('escapes `<` inside JSON-LD so stored data cannot close the script tag', () => {
    const { html } = publishPage(page, site, registry, {
      seo: documentSeoFromCells({ jsonLd: '{"x":"</script><img src=x onerror=alert(1)>"}' }),
    })
    expect(html).not.toContain('</script><img')
    expect(html).toContain('\\u003c/script')
  })

  it('drops a canonical that is not a safe URL rather than emitting it', () => {
    const { html } = publishPage(page, site, registry, {
      seo: documentSeoFromCells({ canonicalUrl: 'javascript:alert(1)' }),
    })
    expect(html).not.toContain('rel="canonical"')
  })
})

describe('publishPage document head — entry path', () => {
  it('reads the current entry cells off the entry stack', () => {
    const page = makePage({ root: { moduleId: 'base.body' } })
    const site = makeSite({ pages: [page] })

    const { html } = publishPage(page, site, registry, {
      templateContext: {
        entryStack: [
          {
            id: 'row-1',
            fields: {
              seoTitle: 'A single post',
              canonicalUrl: 'https://globalnettech.com/blog/a-single-post',
            },
          },
        ],
      },
    })

    expect(html).toContain('<title>A single post</title>')
    expect(html).toContain(
      '<link rel="canonical" href="https://globalnettech.com/blog/a-single-post">',
    )
  })

  it('lets an explicit override win over the entry stack', () => {
    const page = makePage({ root: { moduleId: 'base.body' } })
    const site = makeSite({ pages: [page] })

    const { html } = publishPage(page, site, registry, {
      seo: { title: 'Override wins' },
      templateContext: {
        entryStack: [{ id: 'row-1', fields: { seoTitle: 'From the row' } }],
      },
    })

    expect(html).toContain('<title>Override wins</title>')
  })
})
