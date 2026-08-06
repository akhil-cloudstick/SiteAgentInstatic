/**
 * useReviewFrameScale — fit a breakpoint frame's real width into the grid
 * column Responsive Review gives it.
 *
 * The approved MMSBUILD screen lays the three contexts out as a fixed grid
 * (3.34fr / 1.4fr / 1fr) with no panning: the frames sit where they sit, and
 * each one scrolls inside its own box. To show a real 1440px page inside a
 * ~700px column, the frame has to be scaled down — the mock sidestepped this by
 * drawing miniature markup, which a real editor cannot do because the frame IS
 * the page.
 *
 * A CSS `transform: scale()` is used rather than `zoom` because the selection
 * overlay measures elements with `getBoundingClientRect()`, which accounts for
 * transforms — so rings and toolbars stay pinned to the right pixels with no
 * extra maths. `transform-origin: 0 0` keeps the frame's top-left anchored to
 * its cell.
 *
 * Returns 1 until the column has been measured, so the first paint is never
 * scaled by a garbage ratio.
 */
import { useEffect, useState, type RefObject } from 'react'

/** Never blow a frame up past life size — only ever shrink to fit. */
const MAX_SCALE = 1

export interface ReviewFrameFit {
  /** Shrink factor applied to the frame so its real width fits the column. */
  scale: number
  /**
   * Layout height the frame box must declare, in its own (pre-`zoom`) CSS px,
   * so that it renders exactly as tall as the cell: `cellHeight / scale`.
   *
   * This CANNOT be expressed as a percentage. `zoom` scales the layout box, and
   * percentage heights inside a zoomed box resolve against a containing block
   * the browser has already divided by the zoom factor — so `height: 100%` (or
   * `calc(100% / scale)`, which was the bug) resolves to a box taller than the
   * cell. The frame then hands its iframe an internal viewport far taller than
   * anything visible: the document's end sits below the cell, the frame's own
   * scrollbar reports a nearly-full thumb, and scrolling never reaches the
   * bottom. Measuring the cell in px sidesteps the percentage resolution
   * entirely.
   */
  height: number
}

const UNSCALED: ReviewFrameFit = { scale: 1, height: 0 }

export function useReviewFrameScale(
  cellRef: RefObject<HTMLElement | null>,
  frameWidth: number,
  enabled: boolean,
): ReviewFrameFit {
  const [fit, setFit] = useState<ReviewFrameFit>(UNSCALED)

  useEffect(() => {
    const cell = cellRef.current
    if (!enabled || !cell || frameWidth <= 0) {
      setFit(UNSCALED)
      return
    }

    const measure = () => {
      const available = cell.clientWidth
      const availableHeight = cell.clientHeight
      if (available <= 0 || availableHeight <= 0) return
      const scale = Math.min(MAX_SCALE, available / frameWidth)
      setFit((current) => {
        const height = availableHeight / scale
        if (current.scale === scale && current.height === height) return current
        return { scale, height }
      })
    }

    measure()
    // The columns are `fr` units, so they change with the window, the sidebars
    // and the panel-track variables — all of which a ResizeObserver catches
    // without listening to each source separately. It also catches the height
    // changes that `height` depends on.
    const observer = new ResizeObserver(measure)
    observer.observe(cell)
    return () => observer.disconnect()
  }, [cellRef, frameWidth, enabled])

  return fit
}
