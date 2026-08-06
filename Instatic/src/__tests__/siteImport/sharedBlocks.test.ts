/**
 * Author-marked shared blocks — `data-shared="name"`.
 *
 * `detectGlobalSections` only ever promotes a top-level nav/header/footer, so any
 * other block repeated across pages imported as an independent copy per page and
 * editing one did not update the others. A marked block now becomes ONE Visual
 * Component referenced in place, wherever it sits in the tree.
 */
import { describe, it, expect } from 'bun:test'
import { detectSharedBlocks } from '@core/siteImport'
import type { PagePlan } from '@core/siteImport'
import type { PageNode } from '@core/page-tree'

function node(id: string, moduleId: string, extra: Partial<PageNode> = {}): PageNode {
  return {
    id,
    moduleId,
    props: {},
    children: [],
    classIds: [],
    parentId: null,
    breakpointOverrides: {},
    ...extra,
  } as unknown as PageNode
}

/** A page whose body holds one `<section data-shared=…>` wrapping one text node. */
function pageWith(source: string, sharedName: string | null, text = 'Book a trip'): PagePlan {
  const props: Record<string, unknown> = { tag: 'section' }
  if (sharedName) props.htmlAttributes = { 'data-shared': sharedName }
  return {
    source,
    title: source,
    slug: source,
    linkedCssPaths: [],
    scripts: [],
    nodeFragment: {
      rootIds: ['band'],
      nodes: {
        band: node('band', 'base.container', { props, children: ['copy'], classIds: ['cta-band'] }),
        copy: node('copy', 'base.text', { props: { text, tag: 'p' }, parentId: 'band' }),
      },
    },
  } as unknown as PagePlan
}

describe('detectSharedBlocks', () => {
  it('groups an identical marked block across two pages into one candidate', () => {
    const found = detectSharedBlocks([pageWith('a.html', 'cta-band'), pageWith('b.html', 'cta-band')])
    expect(found).toHaveLength(1)
    expect(found[0]!.name).toBe('cta-band')
    expect(found[0]!.occurrences.map((o) => o.pageSource).sort()).toEqual(['a.html', 'b.html'])
  })

  it('shares a block repeated twice on the SAME page', () => {
    const page = pageWith('a.html', 'cta-band')
    // Duplicate the marked subtree under a second root.
    page.nodeFragment.nodes.band2 = {
      ...page.nodeFragment.nodes.band!,
      id: 'band2',
      children: ['copy2'],
    } as PageNode
    page.nodeFragment.nodes.copy2 = {
      ...page.nodeFragment.nodes.copy!,
      id: 'copy2',
      parentId: 'band2',
    } as PageNode
    page.nodeFragment.rootIds.push('band2')

    const found = detectSharedBlocks([page])
    expect(found).toHaveLength(1)
    expect(found[0]!.occurrences).toHaveLength(2)
  })

  it('ignores an unmarked block, however often it repeats', () => {
    expect(detectSharedBlocks([pageWith('a.html', null), pageWith('b.html', null)])).toHaveLength(0)
  })

  it('does not merge marked blocks whose content differs', () => {
    // Same marker, different text → different structural hash → two groups, and
    // neither reaches the 2-occurrence threshold, so nothing is shared.
    const found = detectSharedBlocks([
      pageWith('a.html', 'cta-band', 'Book a trip'),
      pageWith('b.html', 'cta-band', 'Plan your trip'),
    ])
    expect(found).toHaveLength(0)
  })

  it('does not share a block that appears only once', () => {
    expect(detectSharedBlocks([pageWith('a.html', 'cta-band')])).toHaveLength(0)
  })

  it('keeps differently-named blocks apart even when structurally identical', () => {
    const a = pageWith('a.html', 'cta-band')
    const b = pageWith('b.html', 'footer-strip')
    expect(detectSharedBlocks([a, b])).toHaveLength(0)
  })
})
