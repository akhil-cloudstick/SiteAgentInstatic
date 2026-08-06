/**
 * Viewport context rows — the editable preview width in Responsive review.
 *
 * The field is a live preview, so it commits as you type, which makes the
 * anti-thrash rule the important thing to pin: a partial number on the way to a
 * real one must NOT resize the frame (or worse, clamp itself to the minimum and
 * fight the next keystroke). Committing an out-of-range value is only allowed
 * on the way out, where the setter clamps it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import React from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { PageOutlinePanel } from '@site/sidebars/PageOutlinePanel'
import { useEditorStore } from '@site/store/store'
import { MIN_PREVIEW_FRAME_WIDTH } from '@site/canvas/math'
import { makeSite, makePage, makeNode } from '../fixtures'
import '@modules/base'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
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
    breakpointPreviewWidths: {},
    // Reset explicitly: the store is a module singleton shared across test
    // files, so a dirty flag left by a neighbouring suite would otherwise be
    // read as this feature having touched the document.
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
})

function storedWidth(id: string): number {
  return useEditorStore.getState().site!.breakpoints.find((bp) => bp.id === id)!.width
}

function previewWidths(): Record<string, number> {
  return useEditorStore.getState().breakpointPreviewWidths
}

function widthField(id: string): HTMLInputElement {
  return screen.getByTestId(`viewport-width-${id}`) as HTMLInputElement
}

/**
 * The block ships collapsed, so every width assertion opens it first. Only the
 * two disclosure tests below drive the toggle themselves.
 */
function renderExpanded(children?: React.ReactNode) {
  const result = children
    ? render(<PageOutlinePanel mode="review" hidden toolLabel="Layers">{children}</PageOutlinePanel>)
    : render(<PageOutlinePanel mode="review" />)
  fireEvent.click(screen.getByTestId('viewport-context-toggle'))
  return result
}

describe('viewport context preview width', () => {
  it('shows each context at its stored width', () => {
    renderExpanded()
    expect(widthField('desktop').value).toBe(String(storedWidth('desktop')))
    expect(widthField('mobile').value).toBe(String(storedWidth('mobile')))
  })

  /**
   * The block is the MODE's chrome, not part of the outline list. The last-open
   * panel is restored from localStorage, so if it lived inside the collapsing
   * body it would be invisible in every session after the author first opened
   * Layers — which is exactly how it shipped broken.
   */
  it('stays visible while a tool occupies the column', () => {
    renderExpanded(<div data-testid="hosted-tool" />)

    expect(screen.getByTestId('hosted-tool')).toBeDefined()
    expect(widthField('desktop').value).toBe(String(storedWidth('desktop')))
  })

  /**
   * The AI assistant is a transcript plus a pinned composer — it needs the
   * column's whole height, so the mode's controls step aside for it (and only
   * for it: Layers, Layouts, Code and Media keep them, see above).
   */
  it('steps aside for the AI assistant', () => {
    render(
      <PageOutlinePanel mode="review" hidden toolLabel="AI authoring" toolNeedsFullColumn>
        <div data-testid="hosted-tool" />
      </PageOutlinePanel>,
    )

    expect(screen.getByTestId('hosted-tool')).toBeDefined()
    expect(screen.queryByTestId('viewport-context-toggle')).toBeNull()
    expect(screen.queryByTestId('viewport-width-desktop')).toBeNull()
  })

  it('drops the heading action for the AI assistant but keeps it for other tools', () => {
    const { unmount } = render(
      <PageOutlinePanel mode="live" hidden toolLabel="AI authoring" toolNeedsFullColumn>
        <div />
      </PageOutlinePanel>,
    )
    expect(screen.queryByTestId('page-outline-add-section-top')).toBeNull()
    unmount()

    render(
      <PageOutlinePanel mode="live" hidden toolLabel="Layers">
        <div />
      </PageOutlinePanel>,
    )
    expect(screen.getByTestId('page-outline-add-section-top')).toBeDefined()
  })

  /**
   * Collapsed by default: with the outline (or Layers) above and the switcher
   * below, three always-open rows made the column feel packed.
   */
  it('ships collapsed to a single row and expands on demand', () => {
    render(<PageOutlinePanel mode="review" />)
    const toggle = screen.getByTestId('viewport-context-toggle')

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('viewport-width-desktop')).toBeNull()

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(widthField('desktop').value).toBe(String(storedWidth('desktop')))
  })

  it('keeps a preview width when the block is collapsed again', () => {
    renderExpanded()

    fireEvent.change(widthField('desktop'), { target: { value: '1220' } })
    fireEvent.click(screen.getByTestId('viewport-context-toggle'))

    // Collapsing hides the control, not the preview — the frame stays at 1220.
    expect(screen.queryByTestId('viewport-width-desktop')).toBeNull()
    expect(previewWidths()).toEqual({ desktop: 1220 })
  })

  it('does not commit a partial number typed on the way to a real one', () => {
    renderExpanded()
    const field = widthField('desktop')

    fireEvent.change(field, { target: { value: '1' } })
    fireEvent.change(field, { target: { value: '12' } })
    fireEvent.change(field, { target: { value: '122' } })

    // Nothing committed — and the field still shows what the author typed
    // rather than snapping to a clamped value under their cursor.
    expect(previewWidths()).toEqual({})
    expect(field.value).toBe('122')
  })

  it('commits as soon as the typed value is in range', () => {
    renderExpanded()

    fireEvent.change(widthField('desktop'), { target: { value: '1220' } })

    expect(previewWidths()).toEqual({ desktop: 1220 })
  })

  it('clamps an out-of-range value on blur instead of mid-keystroke', () => {
    renderExpanded()
    const field = widthField('desktop')

    fireEvent.change(field, { target: { value: '50' } })
    expect(previewWidths()).toEqual({})

    fireEvent.blur(field)
    expect(previewWidths()).toEqual({ desktop: MIN_PREVIEW_FRAME_WIDTH })
  })

  it('drops a cleared field on blur and falls back to the stored width', () => {
    renderExpanded()
    const field = widthField('desktop')

    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)

    expect(previewWidths()).toEqual({})
    expect(widthField('desktop').value).toBe(String(storedWidth('desktop')))
  })

  it('offers a reset only once a context is overridden', () => {
    renderExpanded()
    expect(screen.queryByTestId('viewport-width-reset-desktop')).toBeNull()

    fireEvent.change(widthField('desktop'), { target: { value: '1220' } })
    fireEvent.click(screen.getByTestId('viewport-width-reset-desktop'))

    expect(previewWidths()).toEqual({})
    expect(widthField('desktop').value).toBe(String(storedWidth('desktop')))
    expect(screen.queryByTestId('viewport-width-reset-desktop')).toBeNull()
  })

  it('never writes the preview width onto the document', () => {
    renderExpanded()
    const before = storedWidth('desktop')

    fireEvent.change(widthField('desktop'), { target: { value: '1220' } })

    expect(storedWidth('desktop')).toBe(before)
    expect(useEditorStore.getState().hasUnsavedChanges).toBe(false)
  })

  it('still selects the context from the row button', () => {
    renderExpanded()

    fireEvent.click(screen.getByRole('button', { name: /mobile/i }))

    expect(useEditorStore.getState().activeBreakpointId).toBe('mobile')
    expect(screen.getByTestId('viewport-context-mobile').dataset.selected).toBe('true')
    expect(screen.getByTestId('viewport-context-desktop').dataset.selected).toBeUndefined()
  })
})
