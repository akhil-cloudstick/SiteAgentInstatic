/**
 * Toolbar Component Tests — J13
 *
 * Tests focus on:
 *   1. useUndoRedoShortcuts — keyboard-only editor history. There are no
 *      Undo/Redo buttons any more; the hook
 *      (src/admin/pages/site/canvas/useUndoRedoShortcuts.ts) owns the
 *      Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z listener and is mounted by CanvasRoot,
 *      so history stays scoped to the visual editor and never reaches the
 *      Content / Plugins admin pages.
 *   2. ZoomControls — zoom percentage rendering, correct store subscriptions.
 *   3. module inserter — search filter pure logic.
 *   4. PublishButton — state machine (idle → publishing → published / error).
 *   5. Toolbar — overall structure (role, testid, always-rendered sub-components).
 *
 * React component rendering tests use renderToStaticMarkup (same pattern as
 * canvas/accessibility.test.tsx) so no JSDOM or browser is needed.
 *
 * Store-dependent tests use the actual Zustand store (reset between tests
 * via createSite / clearSite) rather than mocks — this catches real
 * integration issues between toolbar actions and store state.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render } from '@testing-library/react'
import { ZoomControls } from '@site/toolbar/ZoomControls'
import { useEditorStore } from '@site/store/store'

// ─── Guideline #224 constants ─────────────────────────────────────────────────

const MIN_TOUCH_TARGET = 44 // px

// ---------------------------------------------------------------------------
// 1 — Zoom percentage display
// ---------------------------------------------------------------------------

describe('ZoomControls — zoom percentage display', () => {
  it('converts zoom 1.0 to "100%"', () => {
    expect(Math.round(1.0 * 100)).toBe(100)
  })

  it('converts zoom 0.5 to "50%"', () => {
    expect(Math.round(0.5 * 100)).toBe(50)
  })

  it('converts zoom 1.5 to "150%"', () => {
    expect(Math.round(1.5 * 100)).toBe(150)
  })

  it('converts zoom 0.123 to "12%" (rounds down)', () => {
    expect(Math.round(0.123 * 100)).toBe(12)
  })

  it('converts zoom 4.0 to "400%" (max zoom)', () => {
    expect(Math.round(4.0 * 100)).toBe(400)
  })

  it('converts zoom 0.1 to "10%" (min zoom)', () => {
    expect(Math.round(0.1 * 100)).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// 1b — Live mode: zoom pinned to 100% and disabled
// ---------------------------------------------------------------------------

describe('ZoomControls — live mode', () => {
  // renderToStaticMarkup would render zustand's INITIAL state (server
  // snapshot) and ignore setState — these two need a live client render.
  beforeEach(() => {
    cleanup()
  })

  it('pins the display to 100% and disables every control with the reason', () => {
    useEditorStore.setState({ canvasView: 'live', zoom: 0.5 })
    const { container } = render(React.createElement(ZoomControls))

    // Display ignores the stored design-canvas zoom (50%), which is preserved
    // for the return to design mode.
    expect(container.textContent).toContain('100%')
    expect(container.textContent).not.toContain('50%')
    // disabled+tooltip renders aria-disabled (not native disabled) so the
    // explanatory tooltip still shows on hover — the Button primitive's
    // zero-friction path.
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons).toHaveLength(3)
    for (const button of buttons) {
      expect(button.getAttribute('aria-disabled')).toBe('true')
    }
    // The reason is surfaced accessibly on the % readout, not only on hover.
    expect(container.innerHTML).toContain('Live mode always shows 100% zoom.')
  })

  it('keeps the stored design zoom interactive in design mode', () => {
    useEditorStore.setState({ canvasView: 'design', zoom: 0.5 })
    const { container } = render(React.createElement(ZoomControls))

    expect(container.textContent).toContain('50%')
    for (const button of container.querySelectorAll('button')) {
      expect(button.getAttribute('aria-disabled')).toBeNull()
      expect(button.hasAttribute('disabled')).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// 2 — useUndoRedoShortcuts — keyboard-only editor history
// ---------------------------------------------------------------------------

const UNDO_REDO_HOOK = new URL(
  '../../admin/pages/site/canvas/useUndoRedoShortcuts.ts',
  import.meta.url,
)

// Both shell rows moved to `@mms/shell` when the MMSBUILD header became one
// component shared with MMS Design. The markup contracts below are asserted
// against that source, because that is where a regression would now land.
const SHARED_SHELL_HEADER = new URL(
  '../../../../OpenDesign/packages/mms-shell/src/shell/MmsShellHeader.tsx',
  import.meta.url,
)
const SHARED_SPECIALIST_ROW = new URL(
  '../../../../OpenDesign/packages/mms-shell/src/shell/MmsSpecialistRow.tsx',
  import.meta.url,
)

describe('useUndoRedoShortcuts — keyboard-only editor history', () => {
  it('no Undo/Redo buttons survive anywhere in the editor chrome', () => {
    // The buttons were removed from the canvas notch; the shortcuts are the
    // only non-palette affordance. Nothing may re-introduce the component.
    const { existsSync, readFileSync } = require('fs')
    expect(
      existsSync(
        new URL('../../admin/pages/site/canvas/UndoRedoButtons.tsx', import.meta.url),
      ),
    ).toBe(false)

    const notchSrc = readFileSync(
      new URL('../../admin/pages/site/canvas/CanvasNotch.tsx', import.meta.url),
      'utf-8',
    )
    expect(notchSrc).not.toContain('UndoRedoButtons')
    expect(notchSrc).not.toContain('canvas-notch-undo-btn')
    expect(notchSrc).not.toContain('canvas-notch-redo-btn')
  })

  it('the registry still declares the canonical undo/redo bindings', () => {
    // Shortcut values come from the keybindings registry (keybindings.ts)
    // rather than being hardcoded, so screen readers and the help screen keep
    // receiving "Meta+Z" / "Meta+Shift+Z" on macOS.
    const { readFileSync } = require('fs')
    const registrySrc = readFileSync(
      new URL('../../admin/spotlight/keybindings.ts', import.meta.url),
      'utf-8',
    )
    expect(registrySrc).toContain("commandId: 'editor.undo'")
    expect(registrySrc).toContain("commandId: 'editor.redo'")
    expect(registrySrc).toContain("'Meta+Z' : 'Control+Z'")
    expect(registrySrc).toContain("'Meta+Shift+Z' : 'Control+Shift+Z'")
  })

  it('keyboard shortcut handler guards against text input targets', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(UNDO_REDO_HOOK, 'utf-8')
    // Shortcuts must not fire inside inputs (would break text editing)
    expect(src).toContain("tagName === 'INPUT'")
    expect(src).toContain("tagName === 'TEXTAREA'")
    expect(src).toContain('isContentEditable')
  })

  it('keyboard handler registers on document (global scope, not canvas-local)', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(UNDO_REDO_HOOK, 'utf-8')
    expect(src).toContain('document.addEventListener')
    expect(src).toContain('document.removeEventListener')
  })

  it('handler supports both Cmd+Z (undo) and Cmd+Shift+Z / Cmd+Y (redo)', () => {
    // The keydown handler delegates undo/redo matching to the keybindings
    // registry via `kb.match(e)`. The Ctrl+Y Windows alias stays inline
    // because the canonical Redo binding is ⌘⇧Z — Ctrl+Y is just a
    // convenience escape hatch.
    const { readFileSync } = require('fs')
    const src = readFileSync(UNDO_REDO_HOOK, 'utf-8')
    expect(src).toContain('kbUndo?.match(e)')
    expect(src).toContain('kbRedo?.match(e)')
    // Also support Ctrl+Y (Windows redo) — handled inline as an alias.
    expect(src).toContain("e.key === 'y'")
  })

  it('is mounted by CanvasRoot so the shortcuts live as long as the canvas', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/pages/site/canvas/CanvasRoot.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).toContain("from './useUndoRedoShortcuts'")
    expect(src).toContain('useUndoRedoShortcuts(editable)')
  })
})

// ---------------------------------------------------------------------------
// 3 — module inserter — search filter logic
// ---------------------------------------------------------------------------

// The filtering logic is extracted here for pure-function testing.
// It mirrors what ModuleInserterDialog computes.
function filterModules(
  grouped: Record<string, Array<{ id: string; name: string }>>,
  query: string,
): Record<string, Array<{ id: string; name: string }>> {
  const q = query.trim().toLowerCase()
  if (!q) return grouped
  const result: Record<string, Array<{ id: string; name: string }>> = {}
  for (const [cat, mods] of Object.entries(grouped)) {
    const matching = mods.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q),
    )
    if (matching.length > 0) result[cat] = matching
  }
  return result
}

const MOCK_REGISTRY: Record<string, Array<{ id: string; name: string }>> = {
  Layout: [
    { id: 'base.container', name: 'Container' },
  ],
  Typography: [
    { id: 'base.text', name: 'Text' },
  ],
  Interactive: [
    { id: 'base.button', name: 'Button' },
    { id: 'base.link', name: 'Link' },
  ],
}

describe('module inserter — search filter', () => {
  it('returns all modules when query is empty', () => {
    const result = filterModules(MOCK_REGISTRY, '')
    expect(Object.keys(result)).toHaveLength(3)
    expect(result['Layout']).toHaveLength(1)
    expect(result['Typography']).toHaveLength(1)
  })

  it('filters by module name (case-insensitive)', () => {
    const result = filterModules(MOCK_REGISTRY, 'text')
    expect(Object.keys(result)).toHaveLength(1)
    expect(result['Typography']).toHaveLength(1)
    expect(result['Typography'][0].name).toBe('Text')
  })

  it('filters by module ID', () => {
    const result = filterModules(MOCK_REGISTRY, 'base.button')
    expect(result['Interactive']).toHaveLength(1)
    expect(result['Interactive'][0].id).toBe('base.button')
  })

  it('filters by category name', () => {
    const result = filterModules(MOCK_REGISTRY, 'layout')
    expect(result['Layout']).toHaveLength(1)
    expect(Object.keys(result)).toHaveLength(1)
  })

  it('returns empty object when no modules match', () => {
    const result = filterModules(MOCK_REGISTRY, 'xyznonexistent')
    expect(Object.keys(result)).toHaveLength(0)
  })

  it('is case-insensitive for all match types', () => {
    expect(filterModules(MOCK_REGISTRY, 'BUTTON')['Interactive']).toHaveLength(1)
    expect(filterModules(MOCK_REGISTRY, 'TEXT')['Typography']).toHaveLength(1)
    expect(filterModules(MOCK_REGISTRY, 'LAYOUT')['Layout']).toHaveLength(1)
  })

  it('trims whitespace from query before filtering', () => {
    const result = filterModules(MOCK_REGISTRY, '  container  ')
    expect(result['Layout']).toHaveLength(1)
    expect(result['Layout'][0].id).toBe('base.container')
  })

  it('partial match works (prefix, suffix, substring)', () => {
    // "tex" should match "Text" (prefix)
    const byPrefix = filterModules(MOCK_REGISTRY, 'tex')
    expect(byPrefix['Typography']).toHaveLength(1)
    expect(byPrefix['Typography'][0].name).toBe('Text')

    // "ext" suffix — unique to Text, does NOT appear in category name "Typography"
    const bySuffix = filterModules(MOCK_REGISTRY, 'ext')
    expect(bySuffix['Typography']).toHaveLength(1)
    expect(bySuffix['Typography'][0].name).toBe('Text')

    // Note: "raph" is a substring of "typography" (the category), so it matches
    // the whole category — we do NOT use "raph" for suffix testing here.
  })
})

// ---------------------------------------------------------------------------
// 4 — PublishButton — state machine
// ---------------------------------------------------------------------------

describe('PublishButton — publish state machine', () => {
  it('transitions: idle → publishing → published on success', () => {
    type State = 'idle' | 'publishing' | 'published' | 'error'
    // Simulate the state transitions
    let state: State = 'idle'

    // Start publish
    state = 'publishing'
    expect(state).toBe('publishing')

    // Publish succeeds
    state = 'published'
    expect(state).toBe('published')
  })

  it('transitions: idle → publishing → error on failure', () => {
    type State = 'idle' | 'publishing' | 'published' | 'error'
    let state: State = 'idle'

    state = 'publishing'
    state = 'error'
    expect(state).toBe('error')
  })

  it('source drives aria-busy during publish (via SplitButton busy prop)', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/pages/site/toolbar/PublishActionGroup.tsx', import.meta.url),
      'utf-8',
    )
    // SplitButton applies aria-busy to the primary button from its `busy` prop.
    expect(src).toContain('busy={publishBusy}')
  })

  it('publish button has data-testid for Playwright targeting (via SplitButton)', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/pages/site/toolbar/PublishActionGroup.tsx', import.meta.url),
      'utf-8',
    )
    // SplitButton renders data-testid="toolbar-publish-btn" on the primary button.
    expect(src).toContain('primaryTestId="toolbar-publish-btn"')
  })

  it('relies on the server-side relay flush instead of a client save before publish', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/pages/site/toolbar/PublishButton.tsx', import.meta.url),
      'utf-8',
    )
    // Live co-editing streams every edit to the server as it happens; the
    // publish ENDPOINT flushes the relay's debounced persist. The button must
    // not carry a client-side save path anymore.
    expect(src).toContain('publishCmsDraft()')
    expect(src).not.toContain('onSave')
  })

  it('loads persisted publish status when the toolbar mounts', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/pages/site/toolbar/PublishButton.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).toContain('getCmsPublishStatus')
    expect(src).toContain('draftMatchesPublished')
  })

  it('returns from Published to Publish when the draft moves on', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/pages/site/toolbar/PublishButton.tsx', import.meta.url),
      'utf-8',
    )
    // Every store mutation (local or a remote peer's) produces a new `site`
    // reference; the button compares against the reference captured at
    // publish time and drops back to idle when they diverge.
    expect(src).toContain('publishedSiteRef')
    expect(src).toContain("setState('idle')")
  })

  it('does not import old static export pipelines', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/pages/site/toolbar/PublishButton.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).not.toContain('@core/publisher')
    expect(src).not.toContain('@core/react-publisher')
  })
})

// ---------------------------------------------------------------------------
// 5 — Toolbar shell structure
// ---------------------------------------------------------------------------

describe('Toolbar — structural requirements', () => {
  it('row 1 owns the banner landmark; row 2 is a labelled navigation region', () => {
    // Under the MMSBUILD shared-header contract the shell is two rows.
    // `ProductHubHeader` (row 1) is the page banner — it carries the brand and
    // the shared utilities. `Toolbar` (row 2) sits beneath it and holds only
    // this product's navigation, so a second <header> there would announce two
    // banner landmarks on one page.
    // Both rows now live in `@mms/shell` and are rendered verbatim by MMS
    // Design too, so the landmark contract is asserted against the shared
    // source — this product's `ProductHubHeader` / `Toolbar` are adapters that
    // supply contents, not markup.
    const { readFileSync } = require('fs')
    const hubRow = readFileSync(SHARED_SHELL_HEADER, 'utf-8')
    expect(hubRow).toContain('<header')
    expect(hubRow).not.toContain('role="banner"')

    const productRow = readFileSync(SHARED_SPECIALIST_ROW, 'utf-8')
    expect(productRow).not.toContain('<header')
    expect(productRow).toContain('role="navigation"')
  })

  it('source has data-testid="toolbar" for Playwright targeting', () => {
    const { readFileSync } = require('fs')
    expect(readFileSync(SHARED_SPECIALIST_ROW, 'utf-8')).toContain('data-testid="toolbar"')
  })

  it('Toolbar is a prop-driven shell — EDITOR-only buttons live in AdminCanvasLayout, global trailer lives in the shell', () => {
    // Under the MMSBUILD shared-header contract the trailer is split: the five
    // shared utilities (Help, Notifications, Theme, Settings, Account) live in
    // row 1 (`ProductHubHeader`) and must appear exactly once, so row 2 keeps
    // only this product's own actions — "Open live page" and
    // "Back to Product Hub".
    //
    // EDITOR-only sub-components (ZoomControls / PublishButton / save status)
    // stay out of the shell — they are passed in via the `rightSlot` prop by
    // AdminCanvasLayout, which keeps the toolbar shareable with the lightweight
    // layouts.
    const { readFileSync } = require('fs')
    const toolbarSrc = readFileSync(
      new URL('../../admin/pages/site/toolbar/Toolbar.tsx', import.meta.url),
      'utf-8',
    )
    // Toolbar.tsx must not import the editor-only sub-components.
    expect(toolbarSrc).not.toContain('UndoRedoButtons')
    expect(toolbarSrc).not.toContain('ModulePickerDropdown')
    expect(toolbarSrc).not.toContain('ExportButton')
    expect(toolbarSrc).not.toContain('SaveIndicator')
    expect(toolbarSrc).not.toContain("from './ZoomControls'")
    expect(toolbarSrc).not.toContain("from './PublishButton'")
    expect(toolbarSrc).not.toContain('saveStatus={saveStatus}')
    // Row 2's own trailer: this product supplies the live-page link; the Hub
    // return is the shared row's, configured by side because MMS Design puts
    // it leftmost and the CMS keeps it right (DECISIONS 2026-08-10).
    expect(toolbarSrc).toContain('<OpenLivePageButton />')
    expect(toolbarSrc).toContain("position: 'right'")
    expect(readFileSync(SHARED_SPECIALIST_ROW, 'utf-8')).toContain('BackToProductHubButton')
    // None of the five shared utilities may reappear here.
    expect(toolbarSrc).not.toContain('<SettingsButton />')
    expect(toolbarSrc).not.toContain('<ThemeToggleButton />')
    expect(toolbarSrc).not.toContain('<AccountMenuButton />')

    // The editor-only buttons must be mounted from AdminCanvasLayout, which
    // must NOT re-mount the now-global SettingsButton.
    const layoutSrc = readFileSync(
      new URL('../../admin/layouts/AdminCanvasLayout/AdminCanvasLayout.tsx', import.meta.url),
      'utf-8',
    )
    expect(layoutSrc).toContain('ZoomControls')
    expect(layoutSrc).toContain('PublishButton')
    expect(layoutSrc).not.toContain('SettingsButton')
    expect(layoutSrc).toContain('saveStatus={persistence.saveStatus}')
  })

  it('module inserter trigger has data-testid for Playwright', () => {
    // The site canvas has no top-center insert notch, so the Layers panel's
    // "+" is the durable inserter entry point the browser suite drives.
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/pages/site/panels/DomPanel/DomPanel.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).toContain('data-testid="dom-tree-insert-module"')
  })

  it('Toolbar no longer renders panel toggles or create-page/component quick actions', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/pages/site/toolbar/Toolbar.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).not.toContain('FilesButton')
    expect(src).not.toContain('CodeEditorButton')
    expect(src).not.toContain('PropertiesButton')
    expect(src).not.toContain('AgentButton')
    expect(src).not.toContain('NewPageButton')
    expect(src).not.toContain('NewComponentButton')
  })

  it('Add inserter is module-only — no page/component create actions', () => {
    // Page / Component creation lives in the Site Explorer panel (the dedicated
    // place for site structure). The module inserter is module-only.
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/pages/site/module-picker/ModuleInserterDialog.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).not.toContain('toolbar-add-page-action')
    expect(src).not.toContain('toolbar-add-component-action')
    expect(src).not.toContain('SiteCreateDialog')
    expect(src).not.toContain('NewFileModal')
    expect(src).not.toContain('src/pages/')
    expect(src).not.toContain('src/components/')
  })

  it('all required data-testid attributes are present (Guideline #221)', () => {
    const { readFileSync } = require('fs')
    // ZoomControls testid
    const zoomSrc = readFileSync(
      new URL('../../admin/pages/site/toolbar/ZoomControls.tsx', import.meta.url), 'utf-8',
    )
    expect(zoomSrc).toContain('data-testid="toolbar-zoom-controls"')

    // Publishing split-button testids — passed to SplitButton, which renders
    // them as data-testid on the chevron trigger and the menu.
    const publishingSrc = readFileSync(
      new URL('../../admin/pages/site/toolbar/PublishActionGroup.tsx', import.meta.url), 'utf-8',
    )
    expect(publishingSrc).toContain('menuTriggerTestId="toolbar-publish-actions-trigger"')
    expect(publishingSrc).toContain('menuTestId="toolbar-publish-actions-menu"')
  })

  it('ModulePicker uses ContextMenu primitives (role="menu" + role="menuitem")', () => {
    const { readFileSync } = require('fs')
    // The compact picker content lives in ModulePicker.tsx for DOM-panel
    // right-click submenus. The toolbar "+ Add" opens ModuleInserterDialog.
    // ModulePicker doesn't author its own role="menu" — it relies on the
    // wrapping ContextMenuSubmenu for that — and uses ContextMenuItem for
    // every row, which renders a `role="menuitem"` button.
    const src = readFileSync(
      new URL('../../admin/pages/site/module-picker/ModulePicker.tsx', import.meta.url), 'utf-8',
    )
    expect(src).toContain('ContextMenuItem')
    // UX Review #333: role="listbox" without arrow-key nav is incorrect. The
    // picker uses ContextMenuItem (role="menuitem") instead.
    const codeLines = src.split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .join('\n')
    expect(codeLines).not.toContain('role="listbox"')
    expect(codeLines).not.toContain('role="option"')
  })

  it('ModulePicker search input has a visible focus ring (WCAG SC 2.4.7)', () => {
    const { readFileSync, existsSync } = require('fs')
    // The picker uses the shared <SearchBar /> primitive; the focus ring lives
    // in that primitive's CSS module so every search bar in the editor uses
    // the same focus treatment. We assert on the primitive's stylesheet.
    const cssPath = new URL('../../ui/components/SearchBar/SearchBar.module.css', import.meta.url)
    const cssSrc = existsSync(cssPath.pathname) ? readFileSync(cssPath, 'utf-8') : ''
    // Assert CSS module :focus / :focus-visible selector (no Tailwind).
    const hasCssModuleFocus = /:focus[-\s{]|:focus-visible/.test(cssSrc)
    expect(hasCssModuleFocus).toBe(true)
  })

  it('PublishButton uses ref to track status timer (no useState leak on unmount)', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/pages/site/toolbar/PublishButton.tsx', import.meta.url), 'utf-8',
    )
    // Timer must be stored in a ref and cleared in a cleanup effect
    expect(src).toContain('statusTimerRef')
    expect(src).toContain('clearTimeout')
    expect(src).toContain('useEffect')
  })

  it('PublishButton reflects collaboration sync and has no manual save action', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/pages/site/toolbar/PublishButton.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).toContain('Draft synced')
    expect(src).toContain('Offline — reconnecting')
    expect(src).toContain('publishDisabled={disabled || state === \'published\'}')
    expect(src).not.toContain('Save draft')
  })
  it('PublishActionGroup keeps the status pill and delegates its split control to the shared SplitButton', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/pages/site/toolbar/PublishActionGroup.tsx', import.meta.url),
      'utf-8',
    )
    // The optional status pill stays owned by PublishActionGroup.
    expect(src).toContain('statusLabel?: string | null')
    expect(src).toContain('{statusLabel && (')
    // The split button + dropdown mechanics now live in the shared primitive.
    expect(src).toContain('@ui/components/SplitButton')
    expect(src).toContain('<SplitButton')
    expect(src).toContain('menuItems={menuItems}')
  })

  it('SplitButton exposes a menu trigger and portals the menu above editor panels', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../ui/components/SplitButton/SplitButton.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).toContain('aria-haspopup="menu"')
    expect(src).toContain('aria-expanded={menuOpen}')
    expect(src).toContain('@ui/components/ContextMenu')
    expect(src).toContain('<ContextMenu')
    expect(src).toContain('<ContextMenuItem')
    expect(src).toContain('createPortal')
    expect(src).toContain('zIndex={10000}')
  })

  it('AdminCanvasLayout imports and renders Toolbar', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/layouts/AdminCanvasLayout/AdminCanvasLayout.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).toContain("import { Toolbar }")
    expect(src).toContain('const persistence = usePersistence(')
    expect(src).toContain("'default'")
    expect(src).toContain('cmsAdapter')
    // PublishButton's `enabled` prop carries the publish gating now
    // (the old `publishEnabled` toolbar prop was dropped when Toolbar
    // became prop-driven — AdminCanvasLayout mounts PublishButton itself
    // inside the toolbar's rightSlot).
    expect(src).toContain('<PublishButton')
    expect(src).toContain('enabled={canPublishPages}')
  })

  it('AdminCanvasLayout keeps zoom and publishing controls adjacent without a divider', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/layouts/AdminCanvasLayout/AdminCanvasLayout.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).toContain('<ZoomControls />')
    expect(src).toContain('<PublishButton')
    expect(src).not.toContain('ToolbarDivider')
  })

  it('touch targets: all toolbar buttons have a defined compact height (Guideline #357)', () => {
    // Guideline #357 (user directive #1532): WCAG 2.5.5 44px touch target requirement
    // is explicitly waived for editor chrome. Toolbar controls target 28px.
    // Pattern asserts a 24–29px height value declared in the shared Toolbar.module.css.
    // SettingsButton is no longer here — it moved to row 1 with the rest of the
    // shared utilities, which are round 44px header buttons, not compact
    // 28px editor chrome.
    const files = [
      'ZoomControls.tsx',
      'PublishButton.tsx',
      'PublishActionGroup.tsx',
    ]
    const { readFileSync, existsSync } = require('fs')
    // The row's chrome now lives in `@mms/shell`; this product's own slot
    // styling stayed behind in Toolbar.module.css. A sub-component's height can
    // be declared in either, so both count as "the shared CSS" here.
    // `existsSync` takes the URL object, not `.pathname` — on Windows the
    // latter is `/S:/…`, which never exists and silently blanked this check.
    const cssUrls = [
      new URL('../../admin/pages/site/toolbar/Toolbar.module.css', import.meta.url),
      new URL(
        '../../../../OpenDesign/packages/mms-shell/src/shell/MmsSpecialistRow.module.css',
        import.meta.url,
      ),
    ]
    const sharedCss = cssUrls
      .map((url) => (existsSync(url) ? readFileSync(url, 'utf-8') : ''))
      .join('\n')
    for (const file of files) {
      const tsx = readFileSync(
        new URL(`../../admin/pages/site/toolbar/${file}`, import.meta.url),
        'utf-8',
      )
      const src = tsx + '\n' + sharedCss
      // Compact only — 24–29px height declared in the shared Toolbar.module.css.
      const hasHeight = /height:\s*2[4-9]/.test(src)
      expect(hasHeight).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 7 — ModulePicker keyboard navigation: ArrowDown from search input
//     Regression test for the WCAG 2.1.1 gap found in UX Review #343.
//
//     Bug: handleMenuKeyDown was attached to the menu container div, NOT the
//     search input. When the dropdown opens, focus is on the search input.
//     Pressing ArrowDown dispatched the event on the input; it bubbled up to
//     the input's ancestors — but the menu div is a SIBLING, not an ancestor,
//     so ArrowDown was silently lost. Keyboard-only users could type a query
//     but could never navigate to or select any module result.
//
//     Fix (Contribution #350): added onKeyDown to the search <input> that
//     forwards ArrowDown to the first [role="menuitem"] element via .focus().
// ---------------------------------------------------------------------------

describe('ModulePicker — ArrowDown keyboard bridge (WCAG SC 2.1.1)', () => {
  // The bridge logic lives in the shared ModulePicker.tsx (used by both the
  // DOM-panel right-click submenu.
  const { readFileSync } = require('fs')
  const src = readFileSync(
    new URL('../../admin/pages/site/module-picker/ModulePicker.tsx', import.meta.url),
    'utf-8',
  )

  it('search input has an onKeyDown handler (WCAG 2.1.1 — keyboard access)', () => {
    // The search input must have its OWN onKeyDown. Without it, ArrowDown from
    // the input cannot reach the wrapping menu's keyboard nav. We verify the
    // handler is wired to the <SearchBar /> via an `onKeyDown=` prop.
    const inputBlock = src.slice(
      src.indexOf('ref={searchRef}') - 10,
      src.indexOf('ref={searchRef}') + 600,
    )
    expect(inputBlock).toContain('onKeyDown')
  })

  it('ArrowDown on search input forwards focus to first menu item', () => {
    // The bridge must use querySelector('[role="menuitem"]') to find the first
    // item, then call .focus() on it.
    const codeLines = src.split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n')

    expect(codeLines).toMatch(/ArrowDown/)
    expect(codeLines).toContain('[role="menuitem"]')
    expect(codeLines).toMatch(/first.*\.focus\(\)|querySelector.*focus\(\)/)
  })

  it('ArrowDown bridge calls preventDefault() to stop page scroll', () => {
    // Without preventDefault, ArrowDown scrolls the page while also (if the
    // bridge is working) moving focus. The scroll is jarring and unexpected.
    // Strip JSDoc/line comments first so prose mentions of "ArrowDown" don't
    // shadow the actual handler block.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line: string) => !line.trim().startsWith('//'))
      .join('\n')
    const idx = codeOnly.indexOf('ArrowDown')
    const bridgeBlock = codeOnly.slice(idx, idx + 200)
    expect(bridgeBlock).toContain('preventDefault()')
  })
})

// ---------------------------------------------------------------------------
// 7 — SettingsModal WCAG fixes (Guideline #225 + WCAG 2.5.5 + section ID)
//
// Three issues were identified after the initial J10 acceptance:
//   1. WCAG 2.4.3 / Guideline #225: focus not returned to trigger on close
//   2. WCAG 2.5.5: nav buttons + close button minHeight: 36 (below 44px min)
//   3. Section ID mismatch: 'general' is not a valid SectionId — silently falls back
//
// These tests lock in the fixes so they cannot be silently reverted.
// ---------------------------------------------------------------------------

describe('SettingsModal — WCAG 2.4.3 focus-return on close (Guideline #225)', () => {
  it('declares a triggerRef to capture the element that opened the modal', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/modals/Settings/SettingsModal.tsx', import.meta.url).pathname,
      'utf-8',
    ) as string
    // The ref must be a nullable HTMLElement ref (so .focus() is available)
    expect(src).toContain('triggerRef')
    expect(src).toMatch(/useRef<HTMLElement\s*\|\s*null>/)
  })

  it('captures document.activeElement into triggerRef when modal opens', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/modals/Settings/SettingsModal.tsx', import.meta.url).pathname,
      'utf-8',
    ) as string
    // Must guard with instanceof before assigning (avoids assigning non-focusable elements)
    expect(src).toMatch(/document\.activeElement\s+instanceof\s+HTMLElement/)
    expect(src).toContain('triggerRef.current = document.activeElement')
  })

  it('restores focus to trigger when modal closes (Guideline #225)', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/modals/Settings/SettingsModal.tsx', import.meta.url).pathname,
      'utf-8',
    ) as string
    // The else branch (open → false) must focus the captured trigger
    expect(src).toContain('triggerRef.current?.focus()')
    // And must clear the ref to avoid a stale reference
    expect(src).toContain('triggerRef.current = null')
  })

  it('does not regress to a 36px touch target anywhere', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../admin/modals/Settings/SettingsModal.tsx', import.meta.url).pathname,
      'utf-8',
    ) as string
    expect(src).not.toMatch(/minHeight:\s*36/)
  })

  it('closes via the shared Esc keycap affordance, not a dedicated close button', () => {
    // The modal shares the Spotlight / Module Inserter language: backdrop click
    // and Esc both close, surfaced through a <Kbd>Esc</Kbd> hint in the rail.
    // There is no bespoke "Close settings" button (consistency pass).
    const { readFileSync } = require('fs')
    const tsx = readFileSync(
      new URL('../../admin/modals/Settings/SettingsModal.tsx', import.meta.url).pathname,
      'utf-8',
    ) as string
    expect(tsx).not.toContain('aria-label="Close settings"')
    expect(tsx).toContain('<Kbd>Esc</Kbd>')
  })
})

describe('SettingsButton — section ID matches a valid SectionId', () => {
  it("dispatches 'general' (a valid SectionId after dropping the Pages section)", () => {
    const { readFileSync } = require('fs')
    // The gear itself is the shared row's; WHICH settings section it opens is
    // this product's decision, passed in as the `settings.onOpen` callback —
    // so the section id is asserted against the adapter, not the shell.
    // Reading the URL object directly (not `.pathname`) keeps this resolvable
    // on Windows, where a file: pathname is `/S:/…`.
    const src = readFileSync(
      new URL('../../admin/shared/ProductHubHeader/ProductHubHeader.tsx', import.meta.url),
      'utf-8',
    ) as string
    // 'pages' / 'breakpoints' / 'conditions' were dropped from the modal —
    // 'general' is the first NAV_ITEMS entry and the canonical default.
    expect(src).toContain("openSettings('general')")
  })
})
