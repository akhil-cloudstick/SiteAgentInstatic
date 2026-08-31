import { describe, expect, it } from 'bun:test'
import { classifyCollections } from '@core/siteImport/collectionPlan'

/**
 * The folder layout is the whole contract between a build and the CMS, so
 * these cases are written as directory listings rather than as unit fixtures.
 * Each one is a shape a real delivery has actually taken.
 */

describe('classifyCollections', () => {
  it('routes <collection>/<slug>/index.html into a collection', () => {
    const result = classifyCollections([
      'index.html',
      'about-us/index.html',
      'blog/index.html',
      'blog/best-gpus-2026/index.html',
      'blog/10-reasons-to-rent/index.html',
    ])

    expect(result.collections).toHaveLength(1)
    const blog = result.collections[0]
    expect(blog.slug).toBe('blog')
    expect(blog.name).toBe('Blog')
    expect(blog.entries.map((e) => e.slug)).toEqual(['best-gpus-2026', '10-reasons-to-rent'])
    expect(result.warnings).toHaveLength(0)
  })

  it('keeps <collection>/index.html as a Page — it is the listing, not an entry', () => {
    const result = classifyCollections([
      'blog/index.html',
      'blog/a-post/index.html',
    ])

    expect(result.pagePaths).toContain('blog/index.html')
    expect(result.collections[0].listingSource).toBe('blog/index.html')
    expect(result.collections[0].entries.map((e) => e.source)).toEqual(['blog/a-post/index.html'])
  })

  it('preserves the public URL an entry would have had as a flat Page', () => {
    // Moving a post into a collection must not move where it serves, or every
    // indexed URL breaks on the next publish.
    const result = classifyCollections(['blog/two-days-in-kodaikanal/index.html'])
    expect(result.collections[0].entries[0].publicSlug).toBe('blog/two-days-in-kodaikanal')
  })

  it('creates no collection for a folder that holds only a listing page', () => {
    // The rev-6 shape: `blog/` exists but every post is a top-level sibling.
    // This must import exactly as it does today — all Pages, no surprises.
    const result = classifyCollections([
      'index.html',
      'blog/index.html',
      'best-gpus-2026/index.html',
      '10-reasons-to-rent/index.html',
    ])

    expect(result.collections).toHaveLength(0)
    expect(result.pagePaths).toHaveLength(4)
    expect(result.warnings).toHaveLength(0)
  })

  it('leaves a fully flat build entirely as Pages', () => {
    const flat = Array.from({ length: 50 }, (_, i) => `page-${i}/index.html`)
    const result = classifyCollections(flat)

    expect(result.collections).toHaveLength(0)
    expect(result.pagePaths).toHaveLength(50)
  })

  it('refuses reserved folder names and says which are free', () => {
    const result = classifyCollections(['posts/a-post/index.html'])

    expect(result.collections).toHaveLength(0)
    expect(result.pagePaths).toEqual(['posts/a-post/index.html'])
    expect(result.warnings[0].kind).toBe('collection-layout')
    expect(result.warnings[0].message).toContain('reserved')
  })

  it('imports over-nested files as Pages rather than dropping them', () => {
    const result = classifyCollections(['blog/2026/march/a-post/index.html'])

    expect(result.collections).toHaveLength(0)
    expect(result.pagePaths).toEqual(['blog/2026/march/a-post/index.html'])
    expect(result.warnings[0].kind).toBe('collection-layout')
  })

  it('treats the forbidden flat <collection>/<slug>.html shape as Pages', () => {
    const result = classifyCollections(['blog/index.html', 'blog/a-post.html'])

    expect(result.collections).toHaveLength(0)
    expect(result.pagePaths).toEqual(['blog/index.html', 'blog/a-post.html'])
  })

  it('separates two collections in one build', () => {
    const result = classifyCollections([
      'blog/index.html',
      'blog/a/index.html',
      'news/index.html',
      'news/b/index.html',
      'news/c/index.html',
    ])

    expect(result.collections.map((c) => c.slug)).toEqual(['blog', 'news'])
    expect(result.collections.map((c) => c.entries.length)).toEqual([1, 2])
  })

  it('creates a collection even when the build ships no listing page', () => {
    const result = classifyCollections(['guides/setting-up/index.html'])

    expect(result.collections).toHaveLength(1)
    expect(result.collections[0].listingSource).toBeNull()
    expect(result.collections[0].entries).toHaveLength(1)
  })

  it('titleizes multi-word folder names', () => {
    const result = classifyCollections(['case-studies/acme/index.html'])
    expect(result.collections[0].name).toBe('Case Studies')
  })
})
