import { describe, expect, it } from 'bun:test'
import '@modules/base'
import { buildImportPlan, commitImportPlan } from '@core/siteImport'
import type {
  CollectionCommitPlan,
  CollectionCommitResult,
  FileMap,
  SiteImportAdapter,
} from '@core/siteImport'
import { makeEmptySiteDocument } from './mockSite'

/**
 * End-to-end cover for the folder-layout split: a build whose posts live under
 * `blog/<slug>/index.html` must import as a collection, not as a flat pile of
 * Pages. The whole point of the folder contract is that the CMS acts on it, so
 * the assertion is on what the adapter is ASKED to create, not on plan shape.
 */

function file(path: string, html: string) {
  return { path, bytes: new TextEncoder().encode(html) }
}

/** A converted post: site chrome around an <article> holding the content. */
function post(title: string, body: string, description: string): string {
  return `<!doctype html><html><head><title>${title} — Demo</title>
<meta name="description" content="${description}">
<link rel="stylesheet" href="styles.css"></head>
<body><header><nav><a href="/">Home</a></nav></header>
<article class="post"><h1>${title}</h1>${body}</article>
<footer><p>© Demo</p></footer></body></html>`
}

function buildFileMap(): FileMap {
  const files: Record<string, { path: string; bytes: Uint8Array }> = {}
  const add = (f: { path: string; bytes: Uint8Array }) => {
    files[f.path] = f
  }
  add(file('index.html', '<!doctype html><html><head><title>Home</title></head><body><h1>Home</h1></body></html>'))
  add(file('about/index.html', '<!doctype html><html><head><title>About</title></head><body><h1>About</h1></body></html>'))
  add(file('blog/index.html', '<!doctype html><html><head><title>Blog</title></head><body><h1>Blog</h1></body></html>'))
  add(file('blog/first-post/index.html', post('First Post', '<p>One</p><img src="images/a.png">', 'The first one')))
  add(file('blog/second-post/index.html', post('Second Post', '<p>Two</p>', 'The second one')))
  add(file('styles.css', '.post { max-width: 40rem; }'))
  // A real asset, so the rewrite map has an entry to rewrite the body against.
  files['images/a.png'] = { path: 'images/a.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }
  return { files } as FileMap
}

interface Recorded {
  collections: CollectionCommitPlan[]
  pages: { title: string; slug: string; hasTemplate: boolean; outlets: number }[]
}

function makeAdapter(): { adapter: SiteImportAdapter; recorded: Recorded } {
  const recorded: Recorded = { collections: [], pages: [] }

  const adapter: SiteImportAdapter = {
    async uploadAsset({ path }) {
      return `/uploads/${path.split('/').pop()}`
    },
    async installGoogleFont() {
      throw new Error('not used')
    },
    async createCollection(collection): Promise<CollectionCommitResult> {
      recorded.collections.push(collection)
      return {
        slug: collection.slug,
        name: collection.name,
        tableId: `tbl_${collection.slug}`,
        reusedExistingTable: false,
        createdEntries: collection.entries.map((e) => ({
          rowId: `row_${e.slug}`,
          slug: e.slug,
          title: e.title,
        })),
        failedEntries: [],
      }
    },
    async commit(recipe) {
      let n = 0
      recipe({
        addPage: (input) => {
          const outlets = Object.values(input.nodeFragment.nodes).filter(
            (node) => node.moduleId === 'base.outlet',
          ).length
          recorded.pages.push({
            title: input.title,
            slug: input.slug,
            hasTemplate: input.template !== undefined,
            outlets,
          })
          return `page_${n++}`
        },
        overwritePage: () => {},
        addStyleRule: () => `rule_${n++}`,
        overwriteStyleRule: () => {},
        addConditions: () => {},
        addFonts: () => [],
        addInstalledFonts: () => [],
        addFontTokens: () => [],
        overwriteFontTokens: () => [],
        addColorTokens: () => [],
        overwriteColorTokens: () => [],
        addScripts: () => [],
        addStylesheets: () => [],
        createVisualComponent: () => `vc_${n++}`,
        upsertEverywhereTemplate: () => `tpl_${n++}`,
      } as never)
    },
  }

  return { adapter, recorded }
}

describe('collection import — end to end', () => {
  it('creates the collection, its entries and its entry template', async () => {
    const plan = buildImportPlan({ fileMap: buildFileMap(), currentSite: makeEmptySiteDocument() })
    const { adapter, recorded } = makeAdapter()
    const result = await commitImportPlan(plan, adapter)

    // One collection, asked for by name, with both posts.
    expect(recorded.collections).toHaveLength(1)
    const blog = recorded.collections[0]
    expect(blog.slug).toBe('blog')
    expect(blog.name).toBe('Blog')
    expect(blog.entries.map((e) => e.slug).sort()).toEqual(['first-post', 'second-post'])

    // Entry content was lifted out of the chrome: the post's own text is
    // present, the site nav and footer are not.
    const first = blog.entries.find((e) => e.slug === 'first-post')!
    expect(first.title).toBe('First Post')
    expect(first.bodyHtml).toContain('One')
    expect(first.bodyHtml).not.toContain('<nav')
    expect(first.bodyHtml).not.toContain('© Demo')
    // The heading became the title, so it must not also sit in the body.
    expect(first.bodyHtml).not.toContain('<h1>')
    expect(first.seoDescription).toBe('The first one')

    // Exactly one entry template, carrying exactly one outlet.
    const templates = recorded.pages.filter((p) => p.hasTemplate)
    expect(templates).toHaveLength(1)
    expect(templates[0].outlets).toBe(1)

    // The posts are NOT pages. Home, About and the blog listing are.
    const pageSlugs = recorded.pages.filter((p) => !p.hasTemplate).map((p) => p.slug).sort()
    expect(pageSlugs).toEqual(['about', 'blog', 'index'])

    expect(result.collections[0].createdEntries).toHaveLength(2)
  })

  it('rewrites bundle-relative image paths in entry bodies to media URLs', async () => {
    const plan = buildImportPlan({ fileMap: buildFileMap(), currentSite: makeEmptySiteDocument() })
    const { adapter, recorded } = makeAdapter()
    await commitImportPlan(plan, adapter)

    const first = recorded.collections[0].entries.find((e) => e.slug === 'first-post')!
    // An untouched `images/a.png` would 404 on every published post.
    expect(first.bodyHtml).not.toContain('src="images/a.png"')
  })

  it('leaves a flat build entirely as Pages', async () => {
    const files: Record<string, { path: string; bytes: Uint8Array }> = {}
    for (const slug of ['index', 'about', 'first-post', 'second-post']) {
      const f = file(`${slug === 'index' ? '' : `${slug}/`}index.html`, post(slug, '<p>x</p>', 'd'))
      files[f.path] = f
    }
    const plan = buildImportPlan({ fileMap: { files } as FileMap, currentSite: makeEmptySiteDocument() })
    const { adapter, recorded } = makeAdapter()
    await commitImportPlan(plan, adapter)

    expect(recorded.collections).toHaveLength(0)
    expect(recorded.pages.filter((p) => p.hasTemplate)).toHaveLength(0)
    expect(recorded.pages.length).toBeGreaterThan(0)
  })

  it('reports a failed entry as a warning instead of losing the import', async () => {
    const plan = buildImportPlan({ fileMap: buildFileMap(), currentSite: makeEmptySiteDocument() })
    const { adapter, recorded } = makeAdapter()
    const failing: SiteImportAdapter = {
      ...adapter,
      async createCollection(collection) {
        recorded.collections.push(collection)
        return {
          slug: collection.slug,
          name: collection.name,
          tableId: 'tbl_blog',
          reusedExistingTable: false,
          createdEntries: [],
          failedEntries: [{ slug: 'first-post', message: 'slug already exists' }],
        }
      },
    }

    const result = await commitImportPlan(plan, failing)
    const warning = result.warnings.find((w) => w.kind === 'collection-layout')
    expect(warning?.message).toContain('blog/first-post')
    expect(warning?.message).toContain('slug already exists')
    // The pages still committed — one bad row does not cost the whole import.
    expect(recorded.pages.length).toBeGreaterThan(0)
  })
})
