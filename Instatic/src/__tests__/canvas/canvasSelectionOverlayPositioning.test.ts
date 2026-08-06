/**
 * Direct unit tests for `positionToolbar`.
 *
 * The selection toolbar used to sit at a flat `-30px` while rendering 50px
 * tall, so its bottom 20px covered the top of the element the author had just
 * selected. It now anchors fully outside the selection and flips below when
 * there is no room above.
 *
 * Driving the RAF/measure loop through `BreakpointFrame` (as
 * `selectionToolbar.test.tsx` does) can only observe the fixed-mode fallback,
 * where happy-dom reports every offset as 0. Calling the function directly
 * with a stub element is the only way to exercise the real flip + clamp math.
 */

import { describe, expect, it } from 'bun:test'
import {
  positionToolbar,
  TOOLBAR_GAP,
  TOOLBAR_HEIGHT_FALLBACK,
} from '@site/canvas/canvasSelectionOverlayPositioning'

const TOOLBAR_H = 32
const TOOLBAR_W = 200

/** A detached div with non-zero offsets, which happy-dom does not provide. */
function makeToolbar(): HTMLDivElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'offsetHeight', { value: TOOLBAR_H, configurable: true })
  Object.defineProperty(el, 'offsetWidth', { value: TOOLBAR_W, configurable: true })
  return el
}

/** Only the fields `positionToolbar` reads. */
function canvasRect(width: number, height: number): DOMRect {
  return { width, height } as DOMRect
}

const NO_SCROLL = { left: 0, top: 0 }

describe('positionToolbar', () => {
  it('places the toolbar fully above the selection, never overlapping it', () => {
    const toolbar = makeToolbar()
    positionToolbar(
      toolbar,
      { x: 100, y: 300, width: 160, height: 40 },
      canvasRect(1000, 800),
      NO_SCROLL,
    )

    expect(toolbar.dataset.placement).toBe('above')
    expect(toolbar.style.top).toBe(`${300 - TOOLBAR_H - TOOLBAR_GAP}px`)
    // The bar's bottom edge must clear the selection's top edge.
    const bottom = 300 - TOOLBAR_H - TOOLBAR_GAP + TOOLBAR_H
    expect(bottom).toBeLessThan(300)
  })

  it('flips below when the selection is against the top of the canvas', () => {
    const toolbar = makeToolbar()
    positionToolbar(
      toolbar,
      { x: 100, y: 2, width: 160, height: 40 },
      canvasRect(1000, 800),
      NO_SCROLL,
    )

    expect(toolbar.dataset.placement).toBe('below')
    expect(toolbar.style.top).toBe(`${2 + 40 + TOOLBAR_GAP}px`)
  })

  it('stays above when neither side fits (selection taller than the canvas)', () => {
    const toolbar = makeToolbar()
    positionToolbar(
      toolbar,
      { x: 100, y: 0, width: 160, height: 2000 },
      canvasRect(1000, 200),
      NO_SCROLL,
    )

    // No room above and none below → prefer above, clamped into view.
    expect(toolbar.dataset.placement).toBe('above')
    expect(Number.parseFloat(toolbar.style.top)).toBeGreaterThanOrEqual(0)
  })

  it('folds scroll offset into the vertical bounds', () => {
    const toolbar = makeToolbar()
    // Scrolled down 500px: a node at scroll-content y=520 is only 20px below
    // the visible top, so there is no room above and it must flip below.
    positionToolbar(
      toolbar,
      { x: 100, y: 520, width: 160, height: 40 },
      canvasRect(1000, 800),
      { left: 0, top: 500 },
    )

    expect(toolbar.dataset.placement).toBe('below')
    expect(toolbar.style.top).toBe(`${520 + 40 + TOOLBAR_GAP}px`)
  })

  it('clamps x into the canvas when the selection is panned off the left edge', () => {
    const toolbar = makeToolbar()
    positionToolbar(
      toolbar,
      { x: -50, y: 300, width: 900, height: 40 },
      canvasRect(1000, 800),
      NO_SCROLL,
    )

    expect(Number.parseFloat(toolbar.style.left)).toBeGreaterThanOrEqual(0)
  })

  it('hides the toolbar when the selection is entirely outside the canvas', () => {
    const toolbar = makeToolbar()
    positionToolbar(
      toolbar,
      { x: 100, y: 5000, width: 160, height: 40 },
      canvasRect(1000, 800),
      NO_SCROLL,
    )

    expect(toolbar.style.display).toBe('none')
  })

  it('measures after making the element visible, so a hidden toolbar is not sized 0', () => {
    const toolbar = makeToolbar()
    toolbar.style.display = 'none'

    positionToolbar(
      toolbar,
      { x: 100, y: 300, width: 160, height: 40 },
      canvasRect(1000, 800),
      NO_SCROLL,
    )

    expect(toolbar.style.display).not.toBe('none')
    // Real measured height used, not the fallback — they differ only if the
    // CSS and the constant drift apart, which is itself worth catching.
    expect(toolbar.style.top).toBe(`${300 - TOOLBAR_H - TOOLBAR_GAP}px`)
  })

  it('falls back to a known height and never flips in fixed mode (no canvasRect)', () => {
    const toolbar = document.createElement('div')
    // Unmeasurable, as in happy-dom.
    positionToolbar(toolbar, { x: 20, y: 10, width: 160, height: 40 }, null, NO_SCROLL)

    expect(toolbar.dataset.placement).toBe('above')
    expect(toolbar.style.top).toBe(`${10 - TOOLBAR_HEIGHT_FALLBACK - TOOLBAR_GAP}px`)
    expect(toolbar.style.left).toBe('20px')
  })
})
