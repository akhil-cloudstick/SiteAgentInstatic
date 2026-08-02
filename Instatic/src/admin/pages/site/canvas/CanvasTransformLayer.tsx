/**
 * CanvasTransformLayer — the div that receives the CSS transform.
 *
 * This is the ONLY element whose style.transform is mutated during pan/zoom.
 * It contains all BreakpointFrames positioned side-by-side.
 *
 * Performance note: CSS transform (translate + scale) is composited on the GPU.
 * Mutating its `style.transform` via a ref (not React state) avoids React re-renders.
 * See useCanvas.ts for the RAF-batched write pattern.
 */

import type { Ref } from 'react'
import { DEFAULT_BREAKPOINTS, type Page, type Breakpoint } from '@core/page-tree'
import type { TemplateRenderDataContext } from '@core/templates/dynamicBindings'
import { BreakpointFrame } from './BreakpointFrame'
import { CanvasFrameSkeletonFrame } from '@admin/shared/CanvasFrameSkeleton'
import type { InjectableRuntimeScript } from './useRuntimeScriptBuild'
import styles from './CanvasTransformLayer.module.css'

interface CanvasTransformLayerProps {
  page: Page | null
  breakpoints: Breakpoint[]
  activeBreakpointId: string
  dimInactiveBreakpoints?: boolean
  activationHintEnabled?: boolean
  onBreakpointActivate: (id: string) => void
  templateContext?: TemplateRenderDataContext
  /** Opt-in runtime scripts injected into every frame; empty/undefined = none. */
  runtimeScripts?: InjectableRuntimeScript[]
  /** Lay the frames out as the approved Responsive Review grid (no panning). */
  reviewLayout?: boolean
  /** React 19: ref is a regular prop on function components. */
  ref?: Ref<HTMLDivElement>
}

export function CanvasTransformLayer({
  page,
  breakpoints,
  activeBreakpointId,
  dimInactiveBreakpoints = false,
  activationHintEnabled = false,
  onBreakpointActivate,
  templateContext,
  runtimeScripts,
  reviewLayout = false,
  ref,
}: CanvasTransformLayerProps) {
  const previewable: Breakpoint[] = []
  for (const breakpoint of breakpoints) {
    if (breakpoint.previewFrame !== false) previewable.push(breakpoint)
  }
  /**
   * Responsive Review reads widest-first — Desktop, Tablet, Mobile — as the
   * approved MMSBUILD screen does. The persisted order is narrowest-first
   * (`DEFAULT_BREAKPOINTS` starts at mobile/375), which put Mobile on the left
   * and read backwards against the reference.
   *
   * Presentation only: storage order is untouched, so Settings › Viewport
   * contexts still lists and reorders them exactly as authored.
   */
  const framedBreakpoints = [...previewable].sort((a, b) => b.width - a.width)

  const fallbackBreakpoints = framedBreakpoints.length > 0 ? framedBreakpoints : DEFAULT_BREAKPOINTS

  return (
    <div
      ref={ref}
      data-testid="canvas-transform-layer"
      // GPU promotion (will-change) is applied imperatively + transiently by
      // useCanvas during active gestures — not permanently — to avoid wrapping
      // the whole subtree into one oversized layer backing that leaves content
      // blank at scale/low zoom. See WILL_CHANGE_RELEASE_MS in useCanvas.ts.
      // Responsive Review is a FIXED grid, not a pannable plane: the approved
      // screen puts the three contexts in `3.34fr / 1.4fr / 1fr` columns that
      // stay put, each frame scrolling inside its own box. The transform-layer
      // flow (absolute, gap-separated, dragged by useCanvas) is only used when
      // that layout is off.
      className={reviewLayout ? styles.reviewGrid : styles.transformLayer}
      data-review-layout={reviewLayout ? 'true' : undefined}
    >
      {page ? (
        // Only breakpoints flagged for a preview frame render an iframe on the
        // canvas (`previewFrame !== false`; undefined = framed for back-compat).
        // Frame-less breakpoints are still selectable editing contexts in the
        // toolbar switcher and still publish their @media CSS — they just don't
        // spawn an editor iframe.
        //
        // All frames mount as soon as the page document is in the store: the
        // tree is already in memory, so there's no async load to stagger. The
        // skeletons above cover the only genuine wait — the document not being
        // loaded yet (`page === null`).
        framedBreakpoints.map((bp) => (
          <BreakpointFrame
            key={bp.id}
            page={page}
            breakpoint={bp}
            isActive={activeBreakpointId === bp.id}
            isDimmed={dimInactiveBreakpoints && activeBreakpointId !== bp.id}
            activationHintEnabled={activationHintEnabled}
            onActivate={onBreakpointActivate}
            templateContext={templateContext}
            runtimeScripts={runtimeScripts}
            reviewLayout={reviewLayout}
          />
        ))
      ) : (
        fallbackBreakpoints.map((breakpoint) => (
          <CanvasFrameSkeletonFrame
            key={breakpoint.id}
            breakpoint={breakpoint}
            dimmed={dimInactiveBreakpoints && activeBreakpointId !== breakpoint.id}
          />
        ))
      )}
    </div>
  )
}
