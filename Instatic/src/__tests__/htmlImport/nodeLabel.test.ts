/**
 * Imported nodes must carry a real name. Before this, every `<div>`/`<section>`
 * became a label-less base.container, so the Layers panel showed "Container"
 * for the whole page and the AI agent — which addresses nodes by name — had no
 * way to tell the hero from the footer.
 */
import { describe, it, expect } from 'bun:test'
import '@modules/base'
import { importHtml, deriveNodeLabel, parseHtml } from '@core/htmlImport'
import { registry } from '@core/module-engine'
import { getNodeDisplayName } from '@core/page-tree'

function firstElement(html: string): Element {
  return parseHtml(html).body.firstElementChild!
}

describe('deriveNodeLabel', () => {
  it('prefers an explicit data-layer name', () => {
    expect(deriveNodeLabel(firstElement('<div data-layer="Pricing table" class="grid"></div>')))
      .toBe('Pricing Table')
  })

  it('names a section from its semantic class', () => {
    expect(deriveNodeLabel(firstElement('<section class="hero"></section>'))).toBe('Hero')
    expect(deriveNodeLabel(firstElement('<div class="hero-title"></div>'))).toBe('Hero Title')
    expect(deriveNodeLabel(firstElement('<div class="hero__actions"></div>'))).toBe('Hero Actions')
    expect(deriveNodeLabel(firstElement('<div class="serviceCard"></div>'))).toBe('Service Card')
  })

  it('skips layout plumbing, state hooks, and utility classes', () => {
    // "container wrapper" says nothing — the block is the services list.
    expect(deriveNodeLabel(firstElement('<div class="container services"></div>')))
      .toBe('Services')
    expect(deriveNodeLabel(firstElement('<div class="is-open js-menu nav-drawer"></div>')))
      .toBe('Nav Drawer')
    expect(deriveNodeLabel(firstElement('<div class="mt-4 px-6 testimonials"></div>')))
      .toBe('Testimonials')
  })

  it('falls back to id, then aria-label, then the semantic tag', () => {
    expect(deriveNodeLabel(firstElement('<section id="products" class="row"></section>')))
      .toBe('Products')
    expect(deriveNodeLabel(firstElement('<nav aria-label="Primary navigation"></nav>')))
      .toBe('Primary navigation')
    expect(deriveNodeLabel(firstElement('<footer></footer>'))).toBe('Footer')
  })

  it('leaves an unnamed bare div alone rather than inventing a name', () => {
    expect(deriveNodeLabel(firstElement('<div></div>'))).toBeUndefined()
    expect(deriveNodeLabel(firstElement('<div class="wrapper"></div>'))).toBeUndefined()
  })
})

describe('import labels the whole tree', () => {
  it('names nested blocks, not just top-level sections', () => {
    const result = importHtml(
      `<section class="hero">` +
        `<div class="hero-inner">` +
          `<h1 class="hero-title">Welcome</h1>` +
        `</div>` +
      `</section>` +
      `<section class="services"><div class="service-card"></div></section>`,
    )

    const nameOf = (id: string) => {
      const node = result.nodes[id]!
      return getNodeDisplayName(node, registry.get(node.moduleId), undefined)
    }

    const [heroId, servicesId] = result.rootIds
    expect(nameOf(heroId!)).toBe('Hero')
    expect(nameOf(servicesId!)).toBe('Services')

    const heroInnerId = result.nodes[heroId!]!.children![0]!
    expect(nameOf(heroInnerId)).toBe('Hero Inner')
    expect(nameOf(result.nodes[heroInnerId]!.children![0]!)).toBe('Hero Title')
    expect(nameOf(result.nodes[servicesId!]!.children![0]!)).toBe('Service Card')
  })

  it('still shows the module name when the source element has no naming signal', () => {
    const result = importHtml('<div><div></div></div>')
    const node = result.nodes[result.rootIds[0]!]!
    expect(node.label).toBeUndefined()
    expect(getNodeDisplayName(node, registry.get(node.moduleId), undefined)).toBe('Container')
  })
})
