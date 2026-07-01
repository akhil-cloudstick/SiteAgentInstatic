import { describe, it, expect } from 'bun:test'
import { createStyleRuleCssEmitter } from '@core/publisher'
import type { ConditionDef } from '@core/page-tree'

describe('custom-condition cascade order', () => {
  it('emits min-width media overrides narrowest-first regardless of registry order', () => {
    // A mobile-first imported sheet whose 1024px override was discovered in the
    // source BEFORE its 640px override. Registry order must NOT decide the
    // cascade — width does, so the wider breakpoint still wins on large screens.
    const conditions: ConditionDef[] = [
      { id: 'media:(min-width: 1024px)', label: '≥1024', condition: { kind: 'media', query: '(min-width: 1024px)' } },
      { id: 'media:(min-width: 640px)', label: '≥640', condition: { kind: 'media', query: '(min-width: 640px)' } },
    ]
    const emit = createStyleRuleCssEmitter([], conditions)
    const blocks = emit(
      '.box',
      { fontSize: '3rem' },
      {
        'media:(min-width: 1024px)': { fontSize: '4.5rem' },
        'media:(min-width: 640px)': { fontSize: '3.75rem' },
      },
    )
    const css = blocks.join('\n')
    const idx640 = css.indexOf('(min-width: 640px)')
    const idx1024 = css.indexOf('(min-width: 1024px)')
    // 640px must be emitted BEFORE 1024px so 1024px wins on wide screens.
    expect(idx640).toBeGreaterThan(-1)
    expect(idx1024).toBeGreaterThan(idx640)
  })

  it('emits max-width media overrides widest-first (desktop-first cascade)', () => {
    const conditions: ConditionDef[] = [
      { id: 'media:(max-width: 640px)', label: '≤640', condition: { kind: 'media', query: '(max-width: 640px)' } },
      { id: 'media:(max-width: 1024px)', label: '≤1024', condition: { kind: 'media', query: '(max-width: 1024px)' } },
    ]
    const emit = createStyleRuleCssEmitter([], conditions)
    const blocks = emit(
      '.box',
      { padding: '2rem' },
      {
        'media:(max-width: 640px)': { padding: '0.5rem' },
        'media:(max-width: 1024px)': { padding: '1rem' },
      },
    )
    const css = blocks.join('\n')
    const idx640 = css.indexOf('(max-width: 640px)')
    const idx1024 = css.indexOf('(max-width: 1024px)')
    // 1024px must be emitted BEFORE 640px so 640px wins on small screens.
    expect(idx1024).toBeGreaterThan(-1)
    expect(idx640).toBeGreaterThan(idx1024)
  })
})
