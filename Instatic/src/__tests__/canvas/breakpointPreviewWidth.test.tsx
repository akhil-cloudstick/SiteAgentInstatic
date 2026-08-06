/**
 * Preview frame widths — the Responsive Review frame must redraw at the
 * session's preview width, live, without remounting the iframe.
 *
 * The point of the feature is that an author can type a size and see the real
 * layout at it: the iframe's own width is what makes the site's `@media` rules
 * fire, so this asserts on the iframe element rather than on a wrapper class.
 * The other frames must not move — each frame subscribes to its own id.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { CanvasTransformLayer } from '@site/canvas/CanvasTransformLayer'
import { DEFAULT_BREAKPOINTS } from '@core/page-tree'
import { useEditorStore } from '@site/store/store'
import { makeNode, makePage, makeSite } from '../fixtures'
import '@modules/base'

const DESKTOP_WIDTH = DEFAULT_BREAKPOINTS.find((bp) => bp.id === 'desktop')!.width
const MOBILE_WIDTH = DEFAULT_BREAKPOINTS.find((bp) => bp.id === 'mobile')!.width

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  useEditorStore.setState({ breakpointPreviewWidths: {} })
})

beforeEach(() => {
  cleanup()
  document.body.replaceChildren()

  const rootId = 'root'
  const page = makePage({
    id: 'page-1',
    rootNodeId: rootId,
    nodes: { [rootId]: makeNode({ id: rootId, moduleId: 'base.body', children: [] }) },
  })
  useEditorStore.setState({
    site: makeSite({ pages: [page] }),
    activePageId: 'page-1',
    activeDocument: null,
    activeBreakpointId: 'desktop',
    canvasView: 'design',
    breakpointPreviewWidths: {},
  } as Parameters<typeof useEditorStore.setState>[0])
})

function renderCanvas() {
  const page = useEditorStore.getState().site!.pages[0]!
  return render(
    <CanvasTransformLayer
      page={page}
      breakpoints={DEFAULT_BREAKPOINTS}
      activeBreakpointId="desktop"
      onBreakpointActivate={() => {}}
    />,
  )
}

function frame(breakpointId: string): HTMLElement {
  return document.querySelector<HTMLElement>(
    `[data-testid="canvas-frame-${breakpointId}"]`,
  )!
}

function frameIframe(breakpointId: string): HTMLIFrameElement {
  return frame(breakpointId).querySelector('iframe')!
}

describe('breakpoint preview width', () => {
  it('resizes the frame and its iframe when a preview width is set', () => {
    renderCanvas()
    expect(frameIframe('desktop').style.width).toBe(`${DESKTOP_WIDTH}px`)

    act(() => {
      useEditorStore.getState().setBreakpointPreviewWidth('desktop', 1220)
    })

    expect(frameIframe('desktop').style.width).toBe('1220px')
    expect(frame('desktop').style.getPropertyValue('--bp-width')).toBe('1220px')
  })

  it('leaves every other breakpoint at its stored width', () => {
    renderCanvas()

    act(() => {
      useEditorStore.getState().setBreakpointPreviewWidth('desktop', 1220)
    })

    expect(frameIframe('mobile').style.width).toBe(`${MOBILE_WIDTH}px`)
  })

  it('restores the stored width when the override is cleared', () => {
    renderCanvas()

    act(() => {
      useEditorStore.getState().setBreakpointPreviewWidth('desktop', 1220)
    })
    act(() => {
      useEditorStore.getState().clearBreakpointPreviewWidth('desktop')
    })

    expect(frameIframe('desktop').style.width).toBe(`${DESKTOP_WIDTH}px`)
  })

  it('restyles the existing iframe rather than remounting it', () => {
    renderCanvas()
    const before = frameIframe('desktop')

    act(() => {
      useEditorStore.getState().setBreakpointPreviewWidth('desktop', 1220)
    })

    // Same element instance: a remount would drop scroll position, re-run the
    // page's runtime scripts and flash the frame white on every keystroke.
    expect(frameIframe('desktop')).toBe(before)
  })

  it('shows the effective width on the frame badge', () => {
    renderCanvas()

    act(() => {
      useEditorStore.getState().setBreakpointPreviewWidth('desktop', 1220)
    })

    expect(frame('desktop').textContent).toContain('1220px')
    expect(frame('desktop').textContent).not.toContain(`${DESKTOP_WIDTH}px`)
  })
})
