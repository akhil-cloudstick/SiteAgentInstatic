/**
 * CanvasDocumentModeDock — top-center host for the active document's mode
 * control (Visual Component canvas mode, Template edit mode).
 *
 * These pills used to ride under `CanvasNotch` as its `floatingControl`. The
 * notch itself is gone from the site canvas — the approved MMSBUILD canvas
 * draws no top-center insert chrome, and module insertion lives on the
 * selection toolbar's "Insert module" button, the Layers panel's "+", and the
 * canvas right-click menu. A mode control is not insert chrome, so it keeps
 * the slot, the chrome layer, and the live-mode peek behaviour.
 */
import type { ReactNode, SyntheticEvent } from 'react'
import { cn } from '@ui/cn'
import styles from './CanvasDocumentModeDock.module.css'

interface CanvasDocumentModeDockProps {
  children: ReactNode
  /**
   * Auto-hide the dock until hovered/focused, rolling it down from the top
   * edge. Used in live mode, where the frame is flush with the top of the
   * surface and a pinned dock would overlay the page's own header. A slim
   * handle stays visible as the hover affordance. Mirrors `CanvasModeToggle`.
   */
  peek?: boolean
}

export function CanvasDocumentModeDock({
  children,
  peek = false,
}: CanvasDocumentModeDockProps) {
  return (
    <div
      className={cn(styles.shell, peek && styles.shellPeek)}
      data-testid="canvas-document-mode-dock"
      onClick={stopCanvasInteraction}
    >
      {peek && <div aria-hidden="true" className={styles.peekHandle} />}
      <div className={styles.roller}>{children}</div>
    </div>
  )
}

// The dock sits inside the canvas surface, which has its own click handlers
// (deselect, shortcuts, …). Stop propagation so it feels like chrome, not a
// click on empty canvas.
function stopCanvasInteraction(event: SyntheticEvent) {
  event.stopPropagation()
}
