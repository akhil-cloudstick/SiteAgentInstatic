/**
 * generateClassCSS must not emit two byte-identical rules for the same
 * selector. An imported class can survive as BOTH a `class` and an `ambient`
 * rule (deduped by different keys); the later copy would otherwise re-declare
 * the base at a higher order and beat legitimate overrides like `-active`.
 */
import { describe, it, expect } from 'bun:test'
import { generateClassCSS } from '@core/publisher'
import type { StyleRule } from '@core/page-tree'

function rule(partial: Partial<StyleRule> & { id: string; selector: string; order: number }): StyleRule {
  return {
    kind: 'class', name: partial.selector.replace(/^\./, ''), styles: {}, contextStyles: {},
    createdAt: 0, updatedAt: 0, ...partial,
  } as StyleRule
}

describe('generateClassCSS — duplicate rule collapse', () => {
  it('emits an identical selector rule once and lets .active win', () => {
    const navBase = { color: 'rgba(255,255,255,0.6)', display: 'inline-block' }
    const classes: Record<string, StyleRule> = {
      a: rule({ id: 'a', selector: '.nav-link', order: 1, kind: 'class', styles: navBase }),
      b: rule({ id: 'b', selector: '.nav-link-active', order: 2, kind: 'class', styles: { color: 'rgb(255,255,255)' } }),
      // Duplicate of `a` stored as ambient with a much higher order (the bug).
      c: rule({ id: 'c', selector: '.nav-link', order: 999, kind: 'ambient', name: '.nav-link', styles: navBase }),
    }
    const css = generateClassCSS(classes, [], [])

    // .nav-link base appears exactly once.
    const baseCount = (css.match(/(^|\n)\.nav-link \{/g) || []).length
    expect(baseCount).toBe(1)

    // …and it sits BEFORE .nav-link-active, so active wins on equal specificity.
    const iBase = css.search(/(^|\n)\.nav-link \{/)
    const iActive = css.indexOf('.nav-link-active {')
    expect(iActive).toBeGreaterThan(iBase)
  })

  it('keeps two same-selector rules when their declarations differ', () => {
    const classes: Record<string, StyleRule> = {
      a: rule({ id: 'a', selector: '.x', order: 1, styles: { color: 'red' } }),
      b: rule({ id: 'b', selector: '.x', order: 2, kind: 'ambient', name: '.x', styles: { color: 'blue' } }),
    }
    const css = generateClassCSS(classes, [], [])
    expect((css.match(/\.x \{/g) || []).length).toBe(2)
  })
})
