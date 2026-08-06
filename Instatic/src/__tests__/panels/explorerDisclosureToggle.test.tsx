/**
 * The Explorer disclosure is the Site column's only switcher, and inside that
 * column the hosted panels' own close buttons are hidden (the column owns the
 * chrome). So picking the tool that is already showing has to put the column
 * back on the Page outline — otherwise opening Layers once strands the author
 * there, with the mode's own controls (Review's Viewport context, the outline
 * list, "Add section") unreachable until a reload.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import React from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ExplorerDisclosure } from '@site/sidebars/PageOutlinePanel/ExplorerDisclosure'
import { useEditorStore } from '@site/store/store'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

beforeEach(() => {
  cleanup()
  document.body.replaceChildren()
  useEditorStore.setState({
    explorerPanelOpen: false,
    explorerPanelTab: 'layers',
    selectorsPanelOpen: false,
    frameworkPanelOpen: false,
    dependenciesPanelOpen: false,
    activePluginPanelId: null,
  } as Parameters<typeof useEditorStore.setState>[0])
})

describe('Explorer disclosure switcher', () => {
  it('opens a tool into the column', () => {
    render(<ExplorerDisclosure />)

    fireEvent.click(screen.getByTestId('explorer-shortcut-layers'))

    expect(useEditorStore.getState().explorerPanelOpen).toBe(true)
    expect(useEditorStore.getState().explorerPanelTab).toBe('layers')
  })

  it('returns the column to the outline when the showing tool is picked again', () => {
    render(<ExplorerDisclosure />)
    const layers = screen.getByTestId('explorer-shortcut-layers')

    fireEvent.click(layers)
    fireEvent.click(layers)

    expect(useEditorStore.getState().explorerPanelOpen).toBe(false)
  })

  it('switches between tools without closing the column', () => {
    render(<ExplorerDisclosure />)

    fireEvent.click(screen.getByTestId('explorer-shortcut-layers'))
    fireEvent.click(screen.getByTestId('explorer-shortcut-site'))

    expect(useEditorStore.getState().explorerPanelOpen).toBe(true)
    expect(useEditorStore.getState().explorerPanelTab).toBe('site')
  })
})
