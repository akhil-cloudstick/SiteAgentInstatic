/**
 * ZoomControls — toolbar controls for canvas zoom.
 *
 *   [Zoom -] [%] [Zoom +]
 *
 * Zooming +/− only changes the zoom level — it never writes pan. The canvas is
 * a fixed grid with `transform-origin: 50% 50%`, so scaling alone keeps the
 * board concentric; rewriting pan is what used to fling it into a corner.
 *
 * Live mode: the single real-size frame always renders at 100%, so the
 * controls show 100% and are disabled with the reason in their tooltip —
 * never an interactive control that silently does nothing. (Wheel/keyboard
 * zoom is already gated off in live mode by useCanvas's `enabled` flag.)
 *
 * Performance: subscribes only to `zoom` + `canvasView` — no re-render when
 * other canvas state changes.
 *
 * Keyboard shortcuts (handled in useCanvas, documented here for screen readers):
 *   +/= → zoom in
 *   -   → zoom out
 *   Cmd/Ctrl+0 → reset to 100%
 *   Shift+1 → reset to 100% (legacy muscle-memory)
 */

import { useEditorStore } from '@site/store/store'
import { MinusIcon } from 'pixel-art-icons/icons/minus'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { Button } from '@ui/components/Button'
import { cn } from '@ui/cn'
import styles from './Toolbar.module.css'

const LIVE_ZOOM_REASON = 'Live mode always shows 100% zoom.'

interface ZoomControlsProps {
  /**
   * Extra class for the group shell. The Site workspace toolbar passes the
   * reference's bordered segmented shell; other callers keep the bare group.
   */
  className?: string
}

export function ZoomControls({ className }: ZoomControlsProps = {}) {
  // Subscribe only to zoom + view — no re-render when other canvas state changes
  const zoom = useEditorStore((s) => s.zoom)
  const isLive = useEditorStore((s) => s.canvasView === 'live')
  const zoomIn = useEditorStore((s) => s.zoomIn)
  const zoomOut = useEditorStore((s) => s.zoomOut)
  const resetView = useEditorStore((s) => s.resetView)

  // No origin argument: passing one makes the store rewrite pan with
  // "keep this screen point fixed" maths, which assumes a pannable plane
  // anchored at 0,0. The Responsive Review board is a fixed grid scaled about
  // its own centre (transform-origin: 50% 50%), so any pan write drags it into
  // a corner. Leaving pan alone keeps every step concentric.
  const handleZoomIn = () => zoomIn()
  const handleZoomOut = () => zoomOut()

  // The live frame renders real-size regardless of the stored design-canvas
  // zoom, which is preserved for the return to design view.
  const pct = isLive ? 100 : Math.round(zoom * 100)

  return (
    <div
      role="group"
      aria-label="Canvas navigation"
      data-testid="toolbar-zoom-controls"
      className={cn(styles.zoomGroup, className)}
    >
      {/* Zoom out */}
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label="Zoom out"
        aria-keyshortcuts="-"
        tooltip={isLive ? LIVE_ZOOM_REASON : 'Zoom out (−)'}
        disabled={isLive}
        onClick={handleZoomOut}
      >
        <MinusIcon size={14} />
      </Button>

      {/* Zoom % display — click to reset to 100% */}
      <Button
        variant="ghost"
        size="sm"
        aria-label={isLive ? LIVE_ZOOM_REASON : `Current zoom ${pct}%. Click to reset to 100%.`}
        tooltip={isLive ? LIVE_ZOOM_REASON : 'Reset to 100% (Cmd/Ctrl+0)'}
        disabled={isLive}
        onClick={resetView}
        numeric
        className={styles.zoomPct}
      >
        {pct}%
      </Button>

      {/* Zoom in */}
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label="Zoom in"
        aria-keyshortcuts="="
        tooltip={isLive ? LIVE_ZOOM_REASON : 'Zoom in (+)'}
        disabled={isLive}
        onClick={handleZoomIn}
      >
        <PlusIcon size={14} />
      </Button>
    </div>
  )
}
