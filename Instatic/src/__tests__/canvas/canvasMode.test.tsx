/**
 * Canvas mode (Design / Live) + Run-scripts tests.
 *
 * Covers:
 * - canvasView default + setCanvasView store action ('design' | 'live')
 * - runScripts default + setRunScripts store action
 * - runScripts has no on-canvas control any more: the top-left CanvasModeToggle
 *   pill was removed, so the flag is driven by the store alone
 * - WorkspaceToolbar drives the three modes (Live edit / Focus section /
 *   Responsive review) and the viewport control
 * - useRuntimeScriptBuild signature contract: it builds only while enabled,
 *   does NOT rebuild on a node-tree edit (scripts don't depend on the tree),
 *   but DOES rebuild on a script-file edit, a packageJson change, or Refresh.
 *   That contract is what lets scripts run alongside live editing without
 *   re-executing on every keystroke.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WorkspaceToolbar } from '@site/toolbar/WorkspaceToolbar'
import { useRuntimeScriptBuild } from '@site/canvas/useRuntimeScriptBuild'
import { useEditorStore } from '@site/store/store'
import { normalizeSiteRuntimeConfig } from '@core/site-runtime'
import type { Page } from '@core/page-tree'
import { makeNode, makePage, makeSite } from '../fixtures'

afterEach(cleanup)

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

beforeEach(() => {
  useEditorStore.setState({
    canvasView: 'design',
    runScripts: false,
  } as Parameters<typeof useEditorStore.setState>[0])
})

afterEach(() => {
  // Belt-and-suspenders: reset after each test so canvas state never leaks
  // into subsequent test files (the Zustand store is a global singleton).
  useEditorStore.setState({
    canvasView: 'design',
    runScripts: false,
  } as Parameters<typeof useEditorStore.setState>[0])
})

// ---------------------------------------------------------------------------
// canvasView / runScripts store state
// ---------------------------------------------------------------------------

describe('canvas view + run-scripts store state', () => {
  it('canvasView defaults to "design"', () => {
    expect(useEditorStore.getState().canvasView).toBe('design')
  })

  it('setCanvasView swaps between "design" and "live"', () => {
    act(() => useEditorStore.getState().setCanvasView('live'))
    expect(useEditorStore.getState().canvasView).toBe('live')

    act(() => useEditorStore.getState().setCanvasView('design'))
    expect(useEditorStore.getState().canvasView).toBe('design')
  })

  it('runScripts defaults to false and setRunScripts toggles it', () => {
    expect(useEditorStore.getState().runScripts).toBe(false)
    act(() => useEditorStore.getState().setRunScripts(true))
    expect(useEditorStore.getState().runScripts).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// WorkspaceToolbar — the mode + viewport controls
//
// These used to live in CanvasModeToggle. The MMSBUILD re-skin moved them to
// the toolbar row above the canvas, where the approved screen puts them, and
// promoted the two canvas views into three named modes. The behaviour being
// gated is the same: the controls reflect and drive the store.
// ---------------------------------------------------------------------------

describe('WorkspaceToolbar mode + viewport controls', () => {
  it('renders the three modes with Live edit selected for the live canvas', () => {
    withRuntimeSite()
    act(() => useEditorStore.getState().setCanvasView('live'))
    render(<WorkspaceToolbar mode="live" />)

    expect(screen.getByTestId('site-mode-live').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('site-mode-focus').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('site-mode-review').getAttribute('aria-pressed')).toBe('false')
  })

  it('Responsive review switches the store to the design canvas', () => {
    withRuntimeSite()
    act(() => useEditorStore.getState().setCanvasView('live'))
    render(<WorkspaceToolbar mode="live" />)

    fireEvent.click(screen.getByTestId('site-mode-review'))
    expect(useEditorStore.getState().canvasView).toBe('design')
  })

  it('Live edit switches back to the live canvas and clears Section Focus', () => {
    withRuntimeSite()
    act(() => {
      useEditorStore.getState().setCanvasView('live')
      useEditorStore.getState().setSectionFocus('root')
    })
    render(<WorkspaceToolbar mode="focus" />)

    fireEvent.click(screen.getByTestId('site-mode-live'))
    expect(useEditorStore.getState().canvasView).toBe('live')
    expect(useEditorStore.getState().sectionFocusNodeId).toBeNull()
  })

  it('leaving the live canvas clears Section Focus even via the store action', () => {
    act(() => {
      useEditorStore.getState().setCanvasView('live')
      useEditorStore.getState().setSectionFocus('section-1')
    })
    act(() => useEditorStore.getState().setCanvasView('design'))
    expect(useEditorStore.getState().sectionFocusNodeId).toBeNull()
  })

  it('renders a viewport button per site breakpoint outside Responsive review', () => {
    const { breakpoints } = withRuntimeSite()
    render(<WorkspaceToolbar mode="live" />)
    for (const bp of breakpoints) {
      expect(screen.getByTestId(`site-viewport-${bp.id}`)).toBeDefined()
    }
  })

  it('clicking a viewport button drives setActiveBreakpoint', () => {
    const { breakpoints } = withRuntimeSite()
    render(<WorkspaceToolbar mode="live" />)

    const initial = useEditorStore.getState().activeBreakpointId
    const target = breakpoints.find((bp) => bp.id !== initial) ?? breakpoints[0]
    fireEvent.click(screen.getByTestId(`site-viewport-${target.id}`))
    expect(useEditorStore.getState().activeBreakpointId).toBe(target.id)
  })

  it('swaps the viewport control for the zoom group in Responsive review', () => {
    const { breakpoints } = withRuntimeSite()
    render(<WorkspaceToolbar mode="review" />)

    expect(screen.getByTestId('toolbar-zoom-controls')).toBeDefined()
    for (const bp of breakpoints) {
      expect(screen.queryByTestId(`site-viewport-${bp.id}`)).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// Test-site fixture
// ---------------------------------------------------------------------------

function withRuntimeSite() {
  const runtime = normalizeSiteRuntimeConfig({
    scripts: {
      entry: { enabled: true, runInCanvas: true, placement: 'body-end', timing: 'dom-ready', scope: { type: 'all-pages' }, priority: 100 },
    },
  })
  const page = makePage({
    id: 'page-1',
    nodes: { root: makeNode({ id: 'root', moduleId: 'base.body', children: [] }) },
  })
  const site = makeSite({
    pages: [page],
    files: [{
      id: 'entry',
      path: 'src/scripts/entry.ts',
      type: 'script',
      content: 'console.log("hi")',
      createdAt: 1,
      updatedAt: 1,
    }],
    packageJson: { dependencies: {}, devDependencies: {} },
    runtime,
  })

  useEditorStore.setState({
    site,
    packageJson: site.packageJson,
    siteRuntime: runtime,
    activePageId: 'page-1',
    activeBreakpointId: site.breakpoints[0]?.id ?? 'desktop',
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])

  return { page, breakpoints: site.breakpoints, breakpoint: site.breakpoints[0] }
}

// ---------------------------------------------------------------------------
// useRuntimeScriptBuild — bundle signature contract
// ---------------------------------------------------------------------------

/**
 * Minimal host for the hook: renders the build status and a Refresh button so
 * tests can drive the public surface without a full canvas mount.
 */
function ScriptBuildHarness({ page, enabled }: { page: Page; enabled: boolean }) {
  const build = useRuntimeScriptBuild({ page, breakpointId: 'desktop', enabled, debounceMs: 0 })
  return (
    <button data-testid="script-status" data-status={build.status} onClick={build.refresh}>
      refresh
    </button>
  )
}

describe('useRuntimeScriptBuild', () => {
  let buildCalls = 0
  beforeEach(() => {
    buildCalls = 0
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/cms/api/cms/runtime/preview')) {
        buildCalls += 1
        return new Response(JSON.stringify({
          html: '<!DOCTYPE html><html><body></body></html>',
          assets: [],
          runtimeAssets: { scripts: [] },
          diagnostics: [],
        }), { status: 200 })
      }
      return new Response('', { status: 404 })
    }) as typeof fetch
  })

  async function flushBuildQueue(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      await Promise.resolve()
    })
  }

  it('does not build while disabled', async () => {
    const { page } = withRuntimeSite()
    render(<ScriptBuildHarness page={page} enabled={false} />)
    await flushBuildQueue()
    expect(buildCalls).toBe(0)
  })

  it('builds once when enabled', async () => {
    const { page } = withRuntimeSite()
    render(<ScriptBuildHarness page={page} enabled />)
    await flushBuildQueue()
    expect(buildCalls).toBe(1)
  })

  it('does NOT rebuild on a node-tree edit (scripts are tree-independent)', async () => {
    const { page } = withRuntimeSite()
    render(<ScriptBuildHarness page={page} enabled />)
    await flushBuildQueue()
    expect(buildCalls).toBe(1)

    act(() => {
      const current = useEditorStore.getState().site!
      const nextPages = current.pages.map((p) =>
        p.id !== 'page-1' ? p : {
          ...p,
          nodes: {
            ...p.nodes,
            root: { ...p.nodes.root, props: { ...p.nodes.root.props, padding: '16px' } },
          },
        },
      )
      useEditorStore.setState({
        site: { ...current, pages: nextPages, updatedAt: Date.now() },
      } as Parameters<typeof useEditorStore.setState>[0])
    })
    await flushBuildQueue()

    expect(buildCalls).toBe(1)
  })

  it('rebuilds when a script file changes', async () => {
    const { page } = withRuntimeSite()
    render(<ScriptBuildHarness page={page} enabled />)
    await flushBuildQueue()
    expect(buildCalls).toBe(1)

    act(() => {
      const current = useEditorStore.getState().site!
      const nextFiles = current.files.map((f) =>
        f.id !== 'entry' ? f : { ...f, content: 'console.log("changed")' },
      )
      useEditorStore.setState({
        site: { ...current, files: nextFiles, updatedAt: Date.now() },
      } as Parameters<typeof useEditorStore.setState>[0])
    })
    await flushBuildQueue()

    expect(buildCalls).toBe(2)
  })

  it('rebuilds when packageJson changes', async () => {
    const { page } = withRuntimeSite()
    render(<ScriptBuildHarness page={page} enabled />)
    await flushBuildQueue()
    expect(buildCalls).toBe(1)

    act(() => {
      const current = useEditorStore.getState().site!
      const nextPackageJson = {
        ...current.packageJson!,
        dependencies: { 'canvas-confetti': '*' },
      }
      useEditorStore.setState({
        site: { ...current, packageJson: nextPackageJson, updatedAt: Date.now() },
        packageJson: nextPackageJson,
      } as Parameters<typeof useEditorStore.setState>[0])
    })
    await flushBuildQueue()

    expect(buildCalls).toBe(2)
  })

  it('rebuilds on Refresh even when nothing else changed', async () => {
    const { page } = withRuntimeSite()
    render(<ScriptBuildHarness page={page} enabled />)
    await flushBuildQueue()
    expect(buildCalls).toBe(1)

    fireEvent.click(screen.getByTestId('script-status'))
    await flushBuildQueue()
    expect(buildCalls).toBe(2)
  })
})
