/**
 * Icon buttons (`<button><svg>…</svg></button>`) must keep their glyph on
 * import. The button rule now recurses into element children and base.button
 * renders them, so a hamburger/menu button no longer imports as an empty box.
 */
import { describe, it, expect } from 'bun:test'
import '@modules/base'
import { importHtml } from '@core/htmlImport'

describe('icon button import', () => {
  it('preserves an SVG child inside a plain button', () => {
    const result = importHtml(
      `<button class="nav-toggle-btn" aria-label="Toggle menu">` +
        `<svg viewBox="0 0 24 24"><line x1="4" x2="20" y1="6" y2="6"></line></svg>` +
      `</button>`,
    )
    const rootId = result.rootIds[0]!
    const button = result.nodes[rootId]!
    expect(button.moduleId).toBe('base.button')
    // The button recursed → it has a child node…
    expect(button.children?.length ?? 0).toBeGreaterThan(0)
    const child = result.nodes[button.children![0]!]!
    // …and that child is the inline SVG (captured as base.svg), not dropped.
    expect(child.moduleId).toBe('base.svg')
    expect(String(child.props.svg)).toContain('<line')
  })

  it('leaves a text-only button as a leaf using its label', () => {
    const result = importHtml(`<button>Contact Us</button>`)
    const button = result.nodes[result.rootIds[0]!]!
    expect(button.moduleId).toBe('base.button')
    expect(button.children?.length ?? 0).toBe(0)
    expect(button.props.label).toBe('Contact Us')
  })
})
