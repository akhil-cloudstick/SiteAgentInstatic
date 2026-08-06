/**
 * The promoted "Background image" field reads the element's real cascade.
 *
 * A media band on an imported page is a container whose picture lives in one of
 * its CLASSES. No class is "active" until the author clicks a pill in the
 * Advanced disclosure, so a field that only read the active class (or only the
 * inline bag) showed an empty picker over an element that plainly has an image
 * — and then wrote a stray inline override that the canvas ignored.
 *
 * The field must therefore read through the node's assigned classes, and write
 * back into whichever layer already declares the property.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PropertiesPanel } from '@site/panels/PropertiesPanel/PropertiesPanel'
import { useEditorStore } from '@site/store/store'
import { makeSite, makePage, makeNode } from '../fixtures'
import '@modules/base/index'

afterEach(cleanup)

const IMAGE_CSS = "url('/uploads/hero.jpg')"

/** A "Hero Media" container carrying its picture through a class. */
function loadMediaBand(): string {
  const nodeId = 'hero-media'
  const rootNode = makeNode({ id: 'root', moduleId: 'base.body', children: [nodeId] })
  const band = makeNode({
    id: nodeId,
    moduleId: 'base.container',
    classIds: ['cls-hero-media'],
  })
  const page = makePage({
    id: 'page-1',
    rootNodeId: 'root',
    nodes: { root: rootNode, [nodeId]: band },
  })

  useEditorStore.setState({
    site: makeSite({
      pages: [page],
      styleRules: {
        'cls-hero-media': {
          id: 'cls-hero-media',
          name: 'hero-media',
          styles: { backgroundImage: IMAGE_CSS },
          contextStyles: {},
        },
      },
    }),
    activePageId: 'page-1',
    selectedNodeId: nodeId,
    selectedNodeIds: [nodeId],
    activeClassId: null,
    activeBreakpointId: 'desktop',
    canvasView: 'live',
    sectionFocusNodeId: null,
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 280 },
  } as Parameters<typeof useEditorStore.setState>[0])

  return nodeId
}

beforeEach(() => {
  localStorage.clear()
})

describe('Background image field', () => {
  it('shows the image the element actually has, from its class', () => {
    loadMediaBand()
    render(<PropertiesPanel />)

    // The control resolves `url(...)` to its Image mode, so that segment is the
    // pressed one. An empty read would leave every segment unpressed.
    const imageSegment = screen.getByRole('button', {
      name: /background image from media library/i,
    })
    expect(imageSegment.getAttribute('aria-pressed')).toBe('true')
  })

  it('writes a replacement back into the class that declares it, not inline', () => {
    const nodeId = loadMediaBand()
    render(<PropertiesPanel />)

    // Switch to URL entry and type a new address — the same path the media
    // picker commits through.
    fireEvent.click(screen.getByRole('button', { name: /custom url/i }))
    const urlField = screen.getByPlaceholderText('https://example.com/image.png')
    fireEvent.change(urlField, { target: { value: '/uploads/replacement.jpg' } })

    const state = useEditorStore.getState()
    expect(state.site?.styleRules['cls-hero-media']?.styles.backgroundImage).toContain(
      'replacement.jpg',
    )
    // The element keeps a clean `style=""` — the design changed, not this one
    // element's override.
    const node = state.site?.pages[0]?.nodes[nodeId]
    expect(node?.inlineStyles?.backgroundImage).toBeUndefined()
  })
})
