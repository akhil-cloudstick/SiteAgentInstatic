import { describe, expect, it } from 'bun:test'

import type { ConditionDef, SiteDocument } from '@core/page-tree'
import type { FrameworkColorToken } from '@core/framework-schema'
import type { FontEntry } from '@core/fonts'

import {
  commitImportedColorTokens,
  commitImportedConditions,
  commitInstalledFonts,
  commitImportedScripts,
} from './applyPlan'

// Minimal settings object (only the fields the helper touches).
function settings(framework?: SiteDocument['settings']['framework']): SiteDocument['settings'] {
  return { shortcuts: {}, ...(framework ? { framework } : {}) } as SiteDocument['settings']
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

const cond = (id: string, query: string): ConditionDef => ({
  id,
  label: id,
  condition: { kind: 'media', query },
})

describe('commitImportedConditions', () => {
  it('commits reusable @media conditions so style-rule contextStyles keys resolve on publish', () => {
    const shell: { conditions?: ConditionDef[] } = {}
    commitImportedConditions(shell, [cond('c1', '(min-width: 1024px)'), cond('c2', '(max-width: 640px)')])
    expect(shell.conditions).toHaveLength(2)
    expect(shell.conditions!.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('dedupes by id (existing wins, no duplicates on re-push)', () => {
    const shell: { conditions?: ConditionDef[] } = { conditions: [cond('c1', '(min-width: 1024px)')] }
    commitImportedConditions(shell, [cond('c1', '(min-width: 9999px)'), cond('c3', '(min-width: 768px)')])
    expect(shell.conditions!.map((c) => c.id)).toEqual(['c1', 'c3'])
    // The existing c1 is kept unchanged — a re-push never clobbers a condition.
    expect(shell.conditions!.find((c) => c.id === 'c1')!.condition.query).toBe('(min-width: 1024px)')
  })

  it('is a no-op for undefined / empty conditions (does not create the array)', () => {
    const shell: { conditions?: ConditionDef[] } = {}
    commitImportedConditions(shell, undefined)
    commitImportedConditions(shell, [])
    expect(shell.conditions).toBeUndefined()
  })
})

const fontEntry = (id: string, family: string): FontEntry => ({
  id,
  source: 'google',
  family,
  variants: ['400'],
  subsets: ['latin'],
  files: [{ variant: '400', subset: 'latin', path: `/uploads/fonts/${id}/400.woff2`, format: 'woff2' }],
  createdAt: 0,
  updatedAt: 0,
})

describe('commitInstalledFonts', () => {
  it('adds installed Google font entries to settings.fonts.items so @font-face self-hosts them', () => {
    const s = settings()
    commitInstalledFonts(s, [fontEntry('f1', 'Inter'), fontEntry('f2', 'Bricolage Grotesque')])
    expect(s.fonts!.items.map((f) => f.family)).toEqual(['Inter', 'Bricolage Grotesque'])
    expect(s.fonts!.items[0]!.source).toBe('google')
    expect(s.fonts!.items[0]!.files[0]!.path).toContain('/uploads/fonts/')
  })

  it('dedupes by (family, source) and re-points font tokens bound to the replaced id', () => {
    const s = settings()
    s.fonts = {
      items: [fontEntry('old', 'Inter')],
      tokens: [
        {
          id: 't',
          name: 'body',
          variable: 'font-body',
          familyId: 'old',
          fallback: '',
          order: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    }
    commitInstalledFonts(s, [fontEntry('new', 'Inter')]) // same family+source → replaces 'old'
    expect(s.fonts!.items).toHaveLength(1)
    expect(s.fonts!.items[0]!.id).toBe('new')
    expect(s.fonts!.tokens![0]!.familyId).toBe('new') // token re-pointed to the new family id
  })

  it('is a no-op for an empty list (does not enable the fonts library)', () => {
    const s = settings()
    commitInstalledFonts(s, [])
    expect(s.fonts).toBeUndefined()
  })
})
