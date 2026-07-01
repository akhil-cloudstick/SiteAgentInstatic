import { describe, it, expect } from 'bun:test'
import { PUBLISHER_RESET_CSS } from '@core/publisher'

describe('publisher reset — import-fidelity guards', () => {
  it('does NOT impose an opinionated body line-height', () => {
    // A fixed line-height (e.g. 1.5) inherits into buttons/cards that set no
    // line-height of their own, making imported sites taller than their source.
    expect(PUBLISHER_RESET_CSS).not.toContain('line-height: 1.5')
    expect(PUBLISHER_RESET_CSS).toContain('line-height: normal')
  })

  it('does NOT pin body to a fixed height (would break position: sticky)', () => {
    // `body { height: 100% }` confines the body box to one viewport, so a
    // sticky nav un-sticks after one screen of scroll. `min-height` lets the
    // body grow with content so sticky spans the whole page.
    expect(PUBLISHER_RESET_CSS).not.toContain(':where(html, body) { height: 100%')
    expect(PUBLISHER_RESET_CSS).toContain(':where(body) { min-height: 100%')
  })
})
