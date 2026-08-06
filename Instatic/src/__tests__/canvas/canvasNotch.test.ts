import { describe, it, expect } from 'bun:test'
import { existsSync, readFileSync } from 'fs'

const CANVAS_ROOT = new URL('../../admin/pages/site/canvas/CanvasRoot.tsx', import.meta.url)
const CANVAS_NOTCH = new URL('../../admin/pages/site/canvas/CanvasNotch.tsx', import.meta.url)
const CANVAS_NOTCH_CSS = new URL('../../admin/pages/site/canvas/CanvasNotch.module.css', import.meta.url)
const MODE_DOCK = new URL('../../admin/pages/site/canvas/CanvasDocumentModeDock.tsx', import.meta.url)
const MODE_DOCK_CSS = new URL(
  '../../admin/pages/site/canvas/CanvasDocumentModeDock.module.css',
  import.meta.url,
)
const SELECTION_OVERLAY_CSS = new URL(
  '../../admin/pages/site/canvas/BreakpointSelectionOverlay.module.css',
  import.meta.url,
)
const CONTENT_CANVAS = new URL(
  '../../admin/pages/content/components/ContentDocumentCanvas/ContentDocumentCanvas.tsx',
  import.meta.url,
)
const TOOLBAR = new URL('../../admin/pages/site/toolbar/Toolbar.tsx', import.meta.url)
const DOM_PANEL = new URL('../../admin/pages/site/panels/DomPanel/DomPanel.tsx', import.meta.url)

function cssRule(css: string, selector: string): string {
  return css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[\\s\\S]*?\\}`))?.[0] ?? ''
}

function zIndexForRule(rule: string): number {
  const value = rule.match(/z-index:\s*(\d+)/)?.[1]
  if (!value) throw new Error(`Expected z-index in CSS rule:\n${rule}`)
  return Number(value)
}

describe('site canvas — no insert notch', () => {
  it('CanvasRoot mounts no notch at all', () => {
    const src = readFileSync(CANVAS_ROOT, 'utf-8')

    // The top-center insert chrome is gone from the site canvas. Nothing may
    // re-introduce it here — insertion lives on the selection toolbar, the
    // Layers panel, and the canvas right-click menu.
    expect(src).not.toContain('CanvasNotch')
    expect(src).not.toContain('canvas-notch')
  })

  it('keeps the document mode control (VC / Template) in its own dock', () => {
    const src = readFileSync(CANVAS_ROOT, 'utf-8')

    // The VC / Template pills used to ride under the notch as `floatingControl`.
    // They are not insert chrome, so they survive in a dedicated dock that only
    // renders when the active document actually has a mode to switch.
    expect(src).toContain('<CanvasDocumentModeDock')
    expect(src).toContain('VisualComponentModeControl')
    expect(src).toContain('TemplateModeControl')
    expect(src).not.toContain('floatingControl=')

    const dock = readFileSync(MODE_DOCK, 'utf-8')
    expect(dock).toContain('peek')
    expect(dock).toContain('data-testid="canvas-document-mode-dock"')
  })

  it('leaves module insertion reachable from the Layers panel', () => {
    const src = readFileSync(DOM_PANEL, 'utf-8')

    // The durable inserter entry point the browser suite drives now that the
    // notch's "+ Add" trigger is gone.
    expect(src).toContain('data-testid="dom-tree-insert-module"')
    expect(src).toContain('ModuleInserterDialog')
  })

  it('deletes the notch-only module picker trigger', () => {
    // ModulePickerDropdown existed solely to sit in the notch and open
    // ModuleInserterDialog — CanvasInsertModuleButton already does exactly
    // that from the selection toolbar, so the duplicate is gone.
    expect(
      existsSync(
        new URL('../../admin/pages/site/toolbar/ModulePickerDropdown.tsx', import.meta.url),
      ),
    ).toBe(false)

    const toolbar = readFileSync(TOOLBAR, 'utf-8')
    expect(toolbar).not.toContain('ModulePickerDropdown')
    expect(toolbar).not.toContain('toolbar-add-module-btn')
  })

  it('carries no Undo/Redo buttons — history is keyboard-only', () => {
    const notch = readFileSync(CANVAS_NOTCH, 'utf-8')
    const toolbar = readFileSync(TOOLBAR, 'utf-8')

    // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z are the affordance now, owned by
    // useUndoRedoShortcuts.
    expect(notch).not.toContain('UndoRedoButtons')
    expect(notch).not.toContain('showHistoryControls')

    // The shared admin toolbar must NOT render undo/redo either — those
    // controls make no sense on Content / Plugins admin pages where there is
    // no editor page tree to mutate.
    expect(toolbar).not.toContain('UndoRedoButtons')
  })
})

describe('CanvasNotch — Content document canvas only', () => {
  it('is mounted by the content canvas and driven entirely by caller actions', () => {
    const content = readFileSync(CONTENT_CANVAS, 'utf-8')
    expect(content).toContain('<CanvasNotch actions={notchActions} />')

    const src = readFileSync(CANVAS_NOTCH, 'utf-8')
    // No site-editor machinery left: no favourites, no module registry lookup,
    // no "+ Add" trigger, no peek/floating-control plumbing.
    expect(src).not.toContain('useModuleInserterPreference')
    expect(src).not.toContain('DEFAULT_MODULE_INSERTER_FAVORITES')
    expect(src).not.toContain('ModuleIcon')
    expect(src).not.toContain('canvas-notch-add-btn')
    expect(src).not.toContain('peek')
    expect(src).not.toContain('floatingControl')
  })

  it('does not draw real side borders through the inverted-corner seam', () => {
    const css = readFileSync(CANVAS_NOTCH_CSS, 'utf-8')

    expect(css).toContain('border: 0')
    expect(css).not.toContain('border: 1px solid')
    expect(css).not.toContain('border-top: 0')
    expect(css).toContain('left: calc(2px - var(--notch-corner))')
    expect(css).toContain('right: calc(2px - var(--notch-corner))')
  })
})

describe('canvas chrome stacking', () => {
  it('stacks the mode dock above selection overlay chrome', () => {
    const dockCss = readFileSync(MODE_DOCK_CSS, 'utf-8')
    const overlayCss = readFileSync(SELECTION_OVERLAY_CSS, 'utf-8')

    const dockZIndex = zIndexForRule(cssRule(dockCss, '.shell'))
    const selectionToolbarZIndex = zIndexForRule(cssRule(overlayCss, '.selectionToolbar'))
    const treeLadderZIndex = zIndexForRule(cssRule(overlayCss, '.treeLadder'))

    expect(dockZIndex).toBeGreaterThan(selectionToolbarZIndex)
    expect(dockZIndex).toBeGreaterThan(treeLadderZIndex)
  })

  it('leaves the canvas top-left corner empty', () => {
    // The "Run scripts" / "Refresh scripts" pill was removed from that corner.
    expect(
      existsSync(
        new URL('../../admin/pages/site/canvas/CanvasModeToggle.tsx', import.meta.url),
      ),
    ).toBe(false)

    const root = readFileSync(CANVAS_ROOT, 'utf-8')
    expect(root).not.toContain('<CanvasModeToggle')
    expect(root).not.toContain('canvas-run-scripts-toggle')
  })
})
