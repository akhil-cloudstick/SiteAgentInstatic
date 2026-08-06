import type { CSSProperties } from 'react'
import { cn } from '@ui/cn'
import type {
  CanvasOverlayMeasureSession,
  CanvasOverlayRect,
} from './canvasOverlayGeometry'
import type {
  CanvasDropAxis,
  CanvasDropTarget,
  CanvasRect,
} from './canvasDnd'
import styles from './BreakpointSelectionOverlay.module.css'

/**
 * Gap between the toolbar and the edge of the selection it belongs to. The
 * toolbar is anchored fully OUTSIDE the selection: it used to sit at a flat
 * `-30px` while rendering 50px tall, so its bottom 20px covered the top of the
 * very element the author had just selected.
 */
export const TOOLBAR_GAP = 6

/**
 * Height assumed when the element cannot be measured — `offsetHeight` is 0 in
 * happy-dom (tests) and during the first tick before layout. Must track
 * `.selectionToolbar`'s `min-height` in `BreakpointSelectionOverlay.module.css`.
 */
export const TOOLBAR_HEIGHT_FALLBACK = 32

/** Breathing room between the toolbar and the canvas viewport edges. */
const TOOLBAR_VIEWPORT_MARGIN = 4

/**
 * Last placement applied per overlay element ('hidden' or the exact rect).
 * Lets the WRITE phase no-op when nothing moved — same-value style writes
 * are not guaranteed free across engines, and skipping them keeps the
 * steady-state tick read-only.
 */
const appliedOverlayPlacements = new WeakMap<HTMLElement, CanvasOverlayRect | 'hidden'>()

/**
 * Move/resize an overlay div (selection ring, hover ring, affinity ring) to
 * `rect`, in canvas-root scroll-content coordinates (or viewport coordinates
 * in the fixed/body fallback). `rect === null` hides the element — the
 * tracked node is unmounted (page swap, hidden subtree) or the ring is
 * inactive.
 */
export function positionOverlayElement(
  element: HTMLElement | null,
  rect: CanvasOverlayRect | null,
): void {
  if (!element) return
  if (!rect) {
    hideOverlayElement(element)
    return
  }
  const prev = appliedOverlayPlacements.get(element)
  if (
    prev !== undefined &&
    prev !== 'hidden' &&
    prev.x === rect.x &&
    prev.y === rect.y &&
    prev.width === rect.width &&
    prev.height === rect.height
  ) {
    return
  }
  Object.assign(element.style, {
    display: '',
    transform: `translate(${rect.x}px, ${rect.y}px)`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  })
  appliedOverlayPlacements.set(element, rect)
}

export function hideOverlayElement(element: HTMLElement | null): void {
  if (!element) return
  if (appliedOverlayPlacements.get(element) === 'hidden') return
  element.style.display = 'none'
  appliedOverlayPlacements.set(element, 'hidden')
}

/**
 * Hard ceiling on how many affinity rings we draw for one selector. A utility
 * class (e.g. `text-muted`) can match hundreds of elements; measuring every one
 * via `getBoundingClientRect()` on each animation frame would jank the canvas.
 * The match count is already surfaced as the selector's usage badge in the
 * panel, so capping the *rings* (a transient hover affordance) is purely a
 * perf guard, not silent data truncation.
 */
const SELECTOR_HIGHLIGHT_RING_CAP = 300

/**
 * READ-phase half of the selector-affinity highlight: measure every element
 * matching `selector` inside the breakpoint iframe (capped). Returns null
 * when the highlight is inactive (clears the pool in the write phase).
 */
export function measureSelectorHighlightRects(
  selector: string | null,
  iframeDoc: Document,
  session: CanvasOverlayMeasureSession,
): CanvasOverlayRect[] | null {
  if (!selector) return null

  // Ambient selectors are arbitrary author/CSS-importer strings; a malformed
  // one makes querySelectorAll throw. Treat that as "matches nothing" rather
  // than letting it bubble out of the RAF loop.
  let matches: NodeListOf<HTMLElement>
  try {
    matches = iframeDoc.querySelectorAll<HTMLElement>(selector)
  } catch {
    return []
  }

  const count = Math.min(matches.length, SELECTOR_HIGHLIGHT_RING_CAP)
  const rects: CanvasOverlayRect[] = []
  for (let i = 0; i < count; i++) {
    const rect = session.measure(matches[i])
    if (rect) rects.push(rect)
  }
  return rects
}

/**
 * WRITE-phase half: sync the orange affinity ring pool under `container` to
 * the measured `rects` — grows the pool as needed, positions each ring, and
 * hides any surplus from a previous, larger match set (rings are reused, not
 * removed). `rects === null` clears the pool.
 */
export function syncSelectorHighlightRings(
  container: HTMLDivElement | null,
  rects: CanvasOverlayRect[] | null,
): void {
  if (!container) return
  if (!rects) {
    hideSurplusRings(container, 0)
    return
  }

  for (let i = 0; i < rects.length; i++) {
    let ring = container.children[i] as HTMLDivElement | undefined
    if (!ring) {
      ring = container.ownerDocument.createElement('div')
      ring.className = cn(styles.ring, styles.selectorHighlight)
      ring.setAttribute('data-canvas-selector-highlight-ring', 'true')
      container.appendChild(ring)
    }
    positionOverlayElement(ring, rects[i])
  }
  hideSurplusRings(container, rects.length)
}

/** Hide every pooled ring from index `keep` onward (they're reused, not removed). */
export function hideSurplusRings(container: HTMLDivElement, keep: number): void {
  for (let i = keep; i < container.children.length; i++) {
    hideOverlayElement(container.children[i] as HTMLElement)
  }
}

/**
 * Anchor the selection toolbar to `union` — the union of the selection-ring
 * rects already measured this tick (no second query/measure pass). Hides the
 * toolbar when there is no measurable selection or when the selection sits
 * entirely outside the canvas root's visible area — otherwise the toolbar
 * would "hang on screen" detached from the element it belongs to. For
 * partial overlap, the canvas root's overflow:hidden clips it.
 *
 * Scoped path: toolbar lives inside the canvas root (position: absolute), so
 * `left`/`top` are in canvas-root scroll-content coordinates — exactly the
 * coordinate space `union` is measured in. Fixed path (fallback,
 * `canvasRect === null`): toolbar lives in document.body (position: fixed)
 * and the same values are viewport (client) coordinates.
 */
export function positionToolbar(
  toolbar: HTMLDivElement | null,
  union: CanvasOverlayRect | null,
  canvasRect: DOMRect | null,
  scroll: { left: number; top: number },
): void {
  if (!toolbar) return
  if (!union) {
    hideOverlayElement(toolbar)
    return
  }

  if (canvasRect) {
    const visibleLeft = scroll.left
    const visibleRight = scroll.left + canvasRect.width
    const visibleTop = scroll.top
    const visibleBottom = scroll.top + canvasRect.height
    const elementFullyOutOfBounds =
      union.x + union.width <= visibleLeft ||
      union.x >= visibleRight ||
      union.y + union.height <= visibleTop ||
      union.y >= visibleBottom
    if (elementFullyOutOfBounds) {
      hideOverlayElement(toolbar)
      return
    }
  }

  // Make the element visible BEFORE measuring it: a `display: none` element
  // reports offsetWidth/offsetHeight as 0, which would collapse both the X
  // clamp and the vertical flip. Unconditional (the old code only reset it in
  // scoped mode, so fixed mode measured a hidden element).
  if (toolbar.style.display === 'none') toolbar.style.display = ''
  const toolbarWidth = toolbar.offsetWidth
  const toolbarHeight = toolbar.offsetHeight || TOOLBAR_HEIGHT_FALLBACK

  // Keep toolbar actions reachable when a wide selected element overlaps the
  // canvas but its left edge is panned under surrounding editor chrome. Fully
  // out-of-bounds selections are hidden above; clamping here only affects
  // partially visible selections.
  let x = union.x
  let y = union.y - toolbarHeight - TOOLBAR_GAP
  let side: 'above' | 'below' = 'above'

  if (canvasRect) {
    const minX = scroll.left + TOOLBAR_VIEWPORT_MARGIN
    const maxX = Math.max(
      minX,
      scroll.left + canvasRect.width - toolbarWidth - TOOLBAR_VIEWPORT_MARGIN,
    )
    x = Math.min(Math.max(union.x, minX), maxX)

    // Prefer above; drop below only when above doesn't fit and below does.
    // Same shape as `computeCanvasTreeLadderPosition`, but computed here in
    // canvas-root SCROLL-CONTENT coordinates (that helper mixes bounds- and
    // scroll-relative values, which is a latent bug of its own — don't
    // inherit it by calling into it).
    const aboveY = union.y - toolbarHeight - TOOLBAR_GAP
    const belowY = union.y + union.height + TOOLBAR_GAP
    const minY = scroll.top + TOOLBAR_VIEWPORT_MARGIN
    const visibleBottom = scroll.top + canvasRect.height
    const maxY = Math.max(minY, visibleBottom - toolbarHeight - TOOLBAR_VIEWPORT_MARGIN)
    const hasRoomAbove = aboveY >= minY
    const hasRoomBelow = belowY + toolbarHeight <= visibleBottom - TOOLBAR_VIEWPORT_MARGIN
    side = hasRoomAbove || !hasRoomBelow ? 'above' : 'below'
    y = Math.min(Math.max(side === 'above' ? aboveY : belowY, minY), maxY)
  }
  // Fixed-mode fallback (`canvasRect === null`, i.e. tests or a transient
  // mount race): stay above with no clamp and no flip. There are no known
  // bounds to flip against, and `window.innerHeight` is the wrong bound for a
  // body-portaled overlay inside a scrolled page. X already behaves this way.

  const placement: CanvasOverlayRect = { x, y, width: union.width, height: union.height }
  const prev = appliedOverlayPlacements.get(toolbar)
  if (
    prev !== undefined &&
    prev !== 'hidden' &&
    prev.x === placement.x &&
    prev.y === placement.y &&
    // `CanvasOverlayRect` is shared with `positionOverlayElement`, so the
    // placement rides on the element instead of widening that type. An
    // attribute read costs no layout.
    toolbar.dataset.placement === side
  ) {
    return
  }

  toolbar.style.left = `${placement.x}px`
  toolbar.style.top = `${placement.y}px`
  toolbar.dataset.placement = side
  appliedOverlayPlacements.set(toolbar, placement)
}

export function dropIndicatorStyle(target: CanvasDropTarget): CSSProperties {
  if (target.position === 'inside') return rectStyle(target.rect)
  return lineStyle(target.rect, target.position, target.axis)
}

function lineStyle(
  rect: CanvasRect,
  position: 'before' | 'after',
  axis: CanvasDropAxis,
): CSSProperties {
  if (axis === 'horizontal') {
    const x = position === 'before' ? rect.left : rect.right
    return indicatorVars(x, rect.top, 2, rect.height)
  }

  const y = position === 'before' ? rect.top : rect.bottom
  return indicatorVars(rect.left, y, rect.width, 2)
}

export function rectStyle(rect: CanvasRect): CSSProperties {
  return indicatorVars(rect.left, rect.top, rect.width, rect.height)
}

function indicatorVars(x: number, y: number, width: number, height: number): CSSProperties {
  return {
    '--canvas-drop-x': `${x}px`,
    '--canvas-drop-y': `${y}px`,
    '--canvas-drop-w': `${width}px`,
    '--canvas-drop-h': `${height}px`,
  } as CSSProperties
}
