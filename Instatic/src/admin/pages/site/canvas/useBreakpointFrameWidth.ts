/**
 * useBreakpointFrameWidth — the ONE place a breakpoint's stored width and the
 * session's preview override are reconciled.
 *
 * A Responsive Review row lets the author type a px value to try a size
 * (`canvasSlice.breakpointPreviewWidths`). That number is ephemeral: it moves
 * the glass, never the document. So there are two widths in play, and every
 * surface that DRAWS a frame at a breakpoint's width must read the effective
 * one from here. Nothing else may write `?? breakpoint.width` — a second
 * reconciliation is how the badge, the iframe and the fit-scale end up
 * disagreeing about how wide the frame is.
 *
 * Surfaces that describe the DOCUMENT keep reading `breakpoint.width` directly
 * and must not call this: the "Edit viewport" dialog (it saves what it shows),
 * the review column sort (frames must not reshuffle mid-keystroke), the agent
 * snapshot frame and CSS tools (agent evidence describes the document), the
 * publisher, and the media-query matchers. One deliberate exception on the
 * frame side: `CanvasFrameSkeleton` stays on the stored width — it renders only
 * while the page is still loading and is replaced by the real frame the moment
 * the tree is in memory, and keeping it dumb keeps `admin/shared` out of editor
 * store state.
 */
import { useEditorStore } from '@site/store/store'
import type { Breakpoint } from '@core/page-tree'

export function useBreakpointFrameWidth(
  breakpoint: Pick<Breakpoint, 'id' | 'width'>,
): number {
  // A SCALAR subscription, not the whole map: editing one context's preview
  // width must not re-render the frames of every other breakpoint.
  const previewWidth = useEditorStore((s) => s.breakpointPreviewWidths[breakpoint.id])
  return previewWidth ?? breakpoint.width
}
