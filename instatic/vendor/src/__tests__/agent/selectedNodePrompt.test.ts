/**
 * The site system prompt must surface the SELECTED node's current content (not
 * just its id) so the agent can act on "change this text" without a document
 * round-trip.
 */
import { describe, expect, it } from 'bun:test'
import { buildSiteAgentSnapshot } from '@site/agent/siteAgentSnapshot'
import { buildSiteSystemPrompt } from '../../../server/ai/tools/site/systemPrompt'
import type { SiteDocument, Page } from '@core/page-tree'

function fixture(): { site: SiteDocument; active: Page } {
  const active = {
    id: 'p1',
    title: 'Home',
    slug: 'index',
    rootNodeId: 'root',
    nodes: {
      root: { id: 'root', moduleId: 'base.body', children: ['addr'], props: {} },
      addr: {
        id: 'addr',
        moduleId: 'base.text',
        children: [],
        props: { tag: 'p', text: 'Bengaluru · Mumbai · Hyderabad · Delhi NCR' },
      },
    },
  } as unknown as Page
  const site = {
    pages: [active],
    breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1280, icon: 'i' }],
    styleRules: {},
    settings: { framework: {}, fonts: {} },
    visualComponents: [],
  } as unknown as SiteDocument
  return { site, active }
}

describe('selected-node system prompt', () => {
  it('includes the selected node id, module, and text content', () => {
    const { site, active } = fixture()
    const snap = buildSiteAgentSnapshot(active, site, {
      selectedNodeId: 'addr',
      activeBreakpointId: 'desktop',
      currentDocument: { type: 'page', id: active.id },
    })
    const suffix = buildSiteSystemPrompt(snap).join('\n')
    expect(suffix).toContain('selected: addr (base.text)')
    expect(suffix).toContain('Bengaluru · Mumbai · Hyderabad · Delhi NCR')
  })

  it('says "none" when nothing is selected', () => {
    const { site, active } = fixture()
    const snap = buildSiteAgentSnapshot(active, site, {
      selectedNodeId: null,
      activeBreakpointId: 'desktop',
      currentDocument: { type: 'page', id: active.id },
    })
    expect(buildSiteSystemPrompt(snap).join('\n')).toContain('selected: none')
  })
})
