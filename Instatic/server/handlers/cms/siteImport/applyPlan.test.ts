import { describe, expect, it } from 'bun:test'

import type { SiteDocument } from '@core/page-tree'
import type { FrameworkColorToken } from '@core/framework-schema'

import { commitImportedColorTokens, commitImportedScripts } from './applyPlan'

// Minimal settings object (only the fields the helper touches).
function settings(framework?: SiteDocument['settings']['framework']): SiteDocument['settings'] {
  return { shortcuts: [], ...(framework ? { framework } : {}) } as SiteDocument['settings']
}

function baseToken(slug: string, lightValue: string, order: number): FrameworkColorToken {
  return {
    id: `existing-${slug}`,
    category: '',
    slug,
    lightValue,
    darkValue: '',
    darkModeEnabled: false,
    generateUtilities: { text: false, background: false, border: false, fill: false },
    generateTransparent: false,
    generateShades: { enabled: false, count: 0 },
    generateTints: { enabled: false, count: 0 },
    order,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('commitImportedColorTokens', () => {
  it('writes colour tokens into framework settings so var(--slug) can resolve', () => {
    const s = settings()
    commitImportedColorTokens(s, [
      { slug: 'bg', value: '#0a0a0a' },
      { slug: 'ink', value: '#f5f5f5' },
    ])
    const tokens = s.framework!.colors.tokens
    expect(tokens).toHaveLength(2)
    expect(tokens.map((t) => t.slug)).toEqual(['bg', 'ink'])
    expect(tokens[0]!.lightValue).toBe('#0a0a0a')
    // Plain base token — no generated utilities/variants.
    expect(tokens[0]!.generateUtilities).toEqual({ text: false, background: false, border: false, fill: false })
    expect(tokens[0]!.order).toBe(0)
    expect(tokens[1]!.order).toBe(1)
  })

  it('normalises slugs (strips --, lowercases) so they match the emitted variable', () => {
    const s = settings()
    commitImportedColorTokens(s, [{ slug: '--Brand-Color', value: '#e11' }])
    expect(s.framework!.colors.tokens[0]!.slug).toBe('brand-color')
  })

  it('skips a slug that already exists (first-wins) and keeps ordering monotonic', () => {
    const s = settings({ colors: { tokens: [baseToken('bg', '#111', 0)] } })
    commitImportedColorTokens(s, [
      { slug: 'bg', value: '#999' }, // duplicate -> skipped, existing value kept
      { slug: 'accent', value: '#e11' }, // new
    ])
    const tokens = s.framework!.colors.tokens
    expect(tokens).toHaveLength(2)
    expect(tokens.find((t) => t.slug === 'bg')!.lightValue).toBe('#111')
    const accent = tokens.find((t) => t.slug === 'accent')!
    expect(accent.lightValue).toBe('#e11')
    expect(accent.order).toBe(1) // maxOrder(0) + 1
  })

  it('is a no-op for an empty colour list (does not enable the framework)', () => {
    const s = settings()
    commitImportedColorTokens(s, [])
    expect(s.framework).toBeUndefined()
  })
})

function shell(): Pick<SiteDocument, 'files' | 'runtime'> {
  return {
    files: [],
    runtime: { dependencyLock: { version: 1, packages: {}, updatedAt: 0 }, scripts: {}, styles: {} },
  } as unknown as Pick<SiteDocument, 'files' | 'runtime'>
}

describe('commitImportedScripts', () => {
  it('commits a script as a SiteFile + page-scoped runtime entry', () => {
    const s = shell()
    commitImportedScripts(s, [
      { path: 'menu.js', content: 'toggle()', format: 'module', priority: 100, pageSources: [], pageIds: ['p1'] },
    ])
    expect(s.files).toHaveLength(1)
    expect(s.files[0]!.type).toBe('script')
    expect(s.files[0]!.content).toBe('toggle()')
    const id = s.files[0]!.id
    expect(s.runtime.scripts[id]!.scope).toEqual({ type: 'pages', pageIds: ['p1'] })
    expect(s.runtime.scripts[id]!.priority).toBe(100)
  })

  it('falls back to all-pages scope when the script has no page ids', () => {
    const s = shell()
    commitImportedScripts(s, [
      { path: 'g.js', content: 'x', format: 'module', priority: 50, pageSources: [], pageIds: [] },
    ])
    const id = s.files[0]!.id
    expect(s.runtime.scripts[id]!.scope).toEqual({ type: 'all-pages' })
  })

  it('deduplicates file paths across multiple scripts', () => {
    const s = shell()
    commitImportedScripts(s, [
      { path: 'app.js', content: 'a', format: 'module', priority: 1, pageSources: [], pageIds: [] },
      { path: 'app.js', content: 'b', format: 'module', priority: 1, pageSources: [], pageIds: [] },
    ])
    const paths = s.files.map((f) => f.path)
    expect(new Set(paths).size).toBe(2)
  })
})
