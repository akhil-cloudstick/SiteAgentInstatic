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

export function useReviewFrameScale(
  cellRef: RefObject<HTMLElement | null>,
  frameWidth: number,
  enabled: boolean,
): number {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const cell = cellRef.current
    if (!enabled || !cell || frameWidth <= 0) {
      setScale(1)
      return
    }

    const measure = () => {
      const available = cell.clientWidth
      if (available <= 0) return
      setScale(Math.min(MAX_SCALE, available / frameWidth))
    }

    measure()
    // The columns are `fr` units, so they change with the window, the sidebars
    // and the panel-track variables — all of which a ResizeObserver catches
    // without listening to each source separately.
    const observer = new ResizeObserver(measure)
    observer.observe(cell)
    return () => observer.disconnect()
  }, [cellRef, frameWidth, enabled])

  return scale
}
