/**
 * Preview Overlay — Integration & Source-Scan Tests (Phase 7 / J15)
 *
 * ─── Test groups ────────────────────────────────────────────────────────────
 *   1. uiSlice preview actions — openPreview / closePreview store contract
 *   2. PreviewOverlay DOM — renders dialog, iframe, close behaviours
 *   3. PreviewOverlay source — sandbox attr, WCAG focus-return pattern
 *   4. Happy-path golden: 2-node tree → expected HTML (Phase 7 requirement)
 *
 * Group 3 uses readFileSync source scanning (same pattern as toolbar.test.ts).
 * Groups 1–2 use @testing-library/react DOM integration (same as settingsModal.test.tsx).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import React from 'react'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { readFileSync } from 'fs'
import { PreviewOverlay } from '@site/preview/PreviewOverlay'
import { resolvePreviewLink } from '@site/preview/previewLinks'
import type { Page } from '@core/page-tree'
import { useEditorStore } from '@site/store/store'
import { publishPage } from '@core/publisher'
import { makeModule, makeRegistry, makePage, makeSite } from './helpers'

// ---------------------------------------------------------------------------
// Store reset
// ---------------------------------------------------------------------------

function resetStore() {
  useEditorStore.setState({
    site: null,
    activePageId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    isSettingsOpen: false,
    activeSection: 'pages',
    previewOpen: false,
    hasUnsavedChanges: false,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

/** Open the preview with a simple one-page site loaded in the store. */
function openPreviewWithSite() {
  const page = {
    id: 'page-1',
    slug: 'index',
    title: 'Home',
    rootNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        moduleId: 'base.body',
        props: {},
        children: ['h1'],
        breakpointOverrides: {},
        locked: false,
        hidden: false,
      },
      h1: {
        id: 'h1',
        moduleId: 'base.text',
        props: { text: 'Welcome', level: 1 },
        children: [],
        breakpointOverrides: {},
        locked: false,
        hidden: false,
      },
    },
  }
  const site = makeSite({ name: 'Test Site', pages: [page] })
  useEditorStore.setState({
    site,
    activePageId: 'page-1',
    previewOpen: true,
  } as Parameters<typeof useEditorStore.setState>[0])
}

const originalFetch = globalThis.fetch
const runtimePreviewCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
let runtimePreviewHtml = '<!DOCTYPE html><html><head><title>Test Site</title></head><body><h1>Welcome</h1></body></html>'
/** Drives the "Open live" affordance — the overlay only offers it once live. */
let hasPublishedVersion = true

beforeEach(() => {
  resetStore()
  runtimePreviewCalls.length = 0
  runtimePreviewHtml = '<!DOCTYPE html><html><head><title>Test Site</title></head><body><h1>Welcome</h1></body></html>'
  hasPublishedVersion = true
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/publish/status')) {
      return new Response(JSON.stringify({
        hasPublishedVersion,
        draftMatchesPublished: hasPublishedVersion,
        draftPages: 1,
        publishedPages: hasPublishedVersion ? 1 : 0,
      }), { status: 200 })
    }
    runtimePreviewCalls.push({ input, init })
    return new Response(JSON.stringify({
      html: runtimePreviewHtml,
      assets: [],
      runtimeAssets: { scripts: [] },
      diagnostics: [],
    }), { status: 200 })
  }
})

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

// ---------------------------------------------------------------------------
// 0 — resolvePreviewLink: clicking the site's own nav browses the DRAFT
// ---------------------------------------------------------------------------

describe('resolvePreviewLink — preview-internal routing', () => {
  const pageStub = (id: string, slug: string, template?: Page['template']): Page => ({
    id,
    slug,
    title: id,
    rootNodeId: 'root',
    nodes: {},
    ...(template ? { template } : {}),
  })

  const pages: Page[] = [
    pageStub('p_home', 'index'),
    pageStub('p_about', 'about'),
    pageStub('t_layout', 'site-layout', {
      enabled: true,
      target: { kind: 'everywhere' },
      priority: 0,
    }),
  ]

  it('routes an internal path to the matching draft page', () => {
    expect(resolvePreviewLink('/about', pages, false)).toEqual({
      kind: 'page', pageId: 'p_about', hash: '',
    })
  })

  it('routes "/" to the home page (slug index)', () => {
    expect(resolvePreviewLink('/', pages, false)).toEqual({
      kind: 'page', pageId: 'p_home', hash: '',
    })
  })

  it('ignores a trailing slash so /about/ still resolves', () => {
    expect(resolvePreviewLink('/about/', pages, false)).toMatchObject({ pageId: 'p_about' })
  })

  it('carries a cross-page hash so /about#team lands on the section', () => {
    expect(resolvePreviewLink('/about#team', pages, false)).toEqual({
      kind: 'page', pageId: 'p_about', hash: 'team',
    })
  })

  it('treats a bare #hash as an in-page anchor, NOT a link to the home page', () => {
    // The <base href> would resolve "#team" to "<origin>/#team", whose pathname
    // is "/" — indistinguishable from the home page unless the raw attribute is
    // inspected first. Getting this wrong makes every on-page jump navigate.
    expect(resolvePreviewLink('#team', pages, false)).toEqual({ kind: 'anchor', hash: 'team' })
  })

  it('never routes to a template — its slug has no public route', () => {
    expect(resolvePreviewLink('/site-layout', pages, false)).toEqual({ kind: 'dead' })
  })

  it('marks an internal path with no draft page as dead rather than navigating', () => {
    expect(resolvePreviewLink('/pricing', pages, false)).toEqual({ kind: 'dead' })
  })

  it('sends a cross-origin link to a real new tab', () => {
    expect(resolvePreviewLink('https://example.com/x', pages, false)).toEqual({
      kind: 'external', url: 'https://example.com/x',
    })
  })

  it('hands mailto:/tel: to the OS untouched', () => {
    expect(resolvePreviewLink('mailto:a@b.com', pages, false)).toEqual({
      kind: 'external', url: 'mailto:a@b.com',
    })
  })

  it('respects target="_blank" on an internal link', () => {
    expect(resolvePreviewLink('/about', pages, true).kind).toBe('external')
  })

  it('treats empty and placeholder hrefs as dead', () => {
    expect(resolvePreviewLink('', pages, false)).toEqual({ kind: 'dead' })
    expect(resolvePreviewLink('#', pages, false)).toEqual({ kind: 'dead' })
    expect(resolvePreviewLink(null, pages, false)).toEqual({ kind: 'dead' })
  })
})

// ---------------------------------------------------------------------------
// 1 — uiSlice preview actions
// ---------------------------------------------------------------------------

describe('uiSlice — preview state', () => {
  it('previewOpen defaults to false', () => {
    expect(useEditorStore.getState().previewOpen).toBe(false)
  })

  it('openPreview() sets previewOpen to true', () => {
    useEditorStore.getState().openPreview()
    expect(useEditorStore.getState().previewOpen).toBe(true)
  })

  it('closePreview() sets previewOpen to false', () => {
    useEditorStore.getState().openPreview()
    useEditorStore.getState().closePreview()
    expect(useEditorStore.getState().previewOpen).toBe(false)
  })

  it('openPreview and closePreview are defined as functions', () => {
    const state = useEditorStore.getState()
    expect(typeof state.openPreview).toBe('function')
    expect(typeof state.closePreview).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// 2 — PreviewOverlay DOM integration
// ---------------------------------------------------------------------------

describe('PreviewOverlay — DOM rendering', () => {
  it('renders nothing when previewOpen is false', async () => {
    render(<PreviewOverlay />)
    expect(document.querySelector('[data-testid="preview-overlay"]')).toBeNull()
    expect(document.querySelector('[data-testid="preview-iframe"]')).toBeNull()
    await act(async () => {})
  })

  it('renders nothing when previewOpen=true but no site is loaded', async () => {
    useEditorStore.setState({ previewOpen: true } as Parameters<typeof useEditorStore.setState>[0])
    render(<PreviewOverlay />)
    expect(document.querySelector('[data-testid="preview-overlay"]')).toBeNull()
    await act(async () => {})
  })

  it('renders the dialog overlay when previewOpen=true with a site', async () => {
    openPreviewWithSite()
    render(<PreviewOverlay />)
    expect(document.querySelector('[data-testid="preview-overlay"]')).not.toBeNull()
    await screen.findByTestId('preview-iframe')
  })

  it('overlay has role="dialog" and aria-modal="true"', async () => {
    openPreviewWithSite()
    render(<PreviewOverlay />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeDefined()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    await screen.findByTestId('preview-iframe')
  })

  it('renders the preview iframe inside the dialog', async () => {
    openPreviewWithSite()
    render(<PreviewOverlay />)
    const iframe = await screen.findByTestId('preview-iframe')
    expect(iframe).not.toBeNull()
  })

  it('iframe has a non-empty srcdoc attribute', async () => {
    openPreviewWithSite()
    render(<PreviewOverlay />)
    const iframe = await screen.findByTestId('preview-iframe')
    const srcdoc = iframe.getAttribute('srcdoc') ?? ''
    expect(srcdoc.length).toBeGreaterThan(0)
    expect(srcdoc).toContain('<!DOCTYPE html>')
  })

  it('iframe srcdoc contains the page title', async () => {
    openPreviewWithSite()
    render(<PreviewOverlay />)
    const iframe = await screen.findByTestId('preview-iframe')
    const srcdoc = iframe.getAttribute('srcdoc') ?? ''
    // The site name "Test Site" should appear as the page title
    expect(srcdoc).toMatch(/<title>[^<]*<\/title>/)
  })

  it('renders server-resolved loop content from the current draft (ISS-234)', async () => {
    runtimePreviewHtml = '<!DOCTYPE html><html><body><p>ISS-234 LOOP ROW</p></body></html>'
    openPreviewWithSite()
    const currentSite = useEditorStore.getState().site
    render(<PreviewOverlay />)

    const iframe = await screen.findByTestId('preview-iframe')
    expect(iframe.getAttribute('srcdoc')).toContain('ISS-234 LOOP ROW')
    expect(runtimePreviewCalls).toHaveLength(1)
    expect(runtimePreviewCalls[0]?.input).toBe('/cms/api/cms/runtime/preview')
    expect(JSON.parse(String(runtimePreviewCalls[0]?.init?.body))).toMatchObject({
      site: currentSite,
      pageId: 'page-1',
    })
  })

  it('close button has aria-label="Close preview"', async () => {
    openPreviewWithSite()
    render(<PreviewOverlay />)
    const closeBtn = screen.getByLabelText('Close preview')
    expect(closeBtn).toBeDefined()
    await screen.findByTestId('preview-iframe')
  })

  it('renders an "Open live" button once the site has a published version', async () => {
    openPreviewWithSite()
    render(<PreviewOverlay />)
    expect(await screen.findByLabelText('Open live page in a new tab')).toBeDefined()
  })

  it('hides the "Open live" button until the site has been published', async () => {
    hasPublishedVersion = false
    openPreviewWithSite()
    render(<PreviewOverlay />)
    // The iframe settling proves the overlay finished its async work, so the
    // absent button is a decision — not a not-yet-resolved fetch.
    await screen.findByTestId('preview-iframe')
    expect(screen.queryByLabelText('Open live page in a new tab')).toBeNull()
  })

  it('clicking the close button closes the overlay (sets previewOpen=false)', async () => {
    openPreviewWithSite()
    render(<PreviewOverlay />)
    await screen.findByTestId('preview-iframe')
    const closeBtn = screen.getByLabelText('Close preview')
    fireEvent.click(closeBtn)
    expect(useEditorStore.getState().previewOpen).toBe(false)
  })

  it('pressing Escape closes the overlay', async () => {
    openPreviewWithSite()
    render(<PreviewOverlay />)
    await screen.findByTestId('preview-iframe')
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
    expect(useEditorStore.getState().previewOpen).toBe(false)
  })

  it('clicking the backdrop closes the overlay', async () => {
    openPreviewWithSite()
    render(<PreviewOverlay />)
    await screen.findByTestId('preview-iframe')
    // Backdrop is the first aria-hidden element
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement | null
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop!)
    expect(useEditorStore.getState().previewOpen).toBe(false)
  })

  it('overlay header shows page title', async () => {
    openPreviewWithSite()
    render(<PreviewOverlay />)
    // Header reads "Preview — {page.title}"
    expect(document.body.textContent).toContain('Preview — Home')
    await screen.findByTestId('preview-iframe')
  })
})

// ---------------------------------------------------------------------------
// 3 — PreviewOverlay source-scan assertions
// ---------------------------------------------------------------------------

describe('PreviewOverlay — source enforcement', () => {
  const overlaySrc = readFileSync(
    new URL('../../admin/pages/site/preview/PreviewOverlay.tsx', import.meta.url),
    'utf-8',
  )

  it('has data-testid="preview-overlay" on the dialog', () => {
    expect(overlaySrc).toContain('data-testid="preview-overlay"')
  })

  it('has data-testid="preview-iframe" on the iframe', () => {
    expect(overlaySrc).toContain('data-testid="preview-iframe"')
  })

  it('iframe uses sandbox="allow-same-origin" without allow-scripts (assets load, scripts stay disabled)', () => {
    // Same-origin is required so the `sa_hub` session cookie is sent and the
    // gateway can route `/uploads/…` assets to the tenant (opaque origin 404s).
    // Crucially NO `allow-scripts`: content stays inert, so same-origin grants
    // it nothing executable.
    expect(overlaySrc).toContain('sandbox="allow-same-origin"')
    // No sandbox attribute may grant scripts (allow-scripts + allow-same-origin
    // would let content escape the sandbox). Scoped to the attribute so prose
    // mentioning "allow-scripts" in comments doesn't trip it.
    expect(overlaySrc).not.toMatch(/sandbox="[^"]*allow-scripts/)
  })

  it('handles Escape key to close (Guideline #225)', () => {
    expect(overlaySrc).toContain("e.key === 'Escape'")
    expect(overlaySrc).toContain('closePreview()')
  })

  it('captures document.activeElement on open (WCAG 2.4.3 focus return)', () => {
    expect(overlaySrc).toContain('document.activeElement')
    expect(overlaySrc).toContain('triggerRef.current = document.activeElement')
  })

  it('restores focus to trigger on close (WCAG 2.4.3)', () => {
    expect(overlaySrc).toMatch(/else\s*\{[\s\S]*?\.focus\(\)/)
  })

  it('close button has aria-label="Close preview"', () => {
    expect(overlaySrc).toContain('aria-label="Close preview"')
  })

  it('close button uses the shared 44px Button size', () => {
    const closeActionStart = overlaySrc.indexOf('aria-label="Close preview"')
    const closeActionBlock = overlaySrc.slice(closeActionStart - 250, closeActionStart + 250)

    expect(closeActionBlock).toContain('<Button')
    expect(closeActionBlock).toContain('size="lg"')
  })

  it('backdrop has aria-hidden="true" (screen readers ignore it)', () => {
    expect(overlaySrc).toContain('aria-hidden="true"')
  })

  it('uses the CMS runtime preview boundary instead of bypassing server prefetch', () => {
    const previewHookSrc = readFileSync(
      new URL('../../admin/pages/site/preview/useRuntimePreviewDocument.ts', import.meta.url),
      'utf-8',
    )
    expect(previewHookSrc).toContain('buildCmsRuntimePreview(')
    expect(overlaySrc).not.toContain('publishPage(')
  })

  it('forces eager image loading (native lazy never fires in the sandboxed srcDoc)', () => {
    // Below-the-fold `loading="lazy"` images never load in the opaque-origin,
    // script-less preview iframe; the preview is a static snapshot, so it must
    // rewrite lazy → eager. See preparePreviewHtml.
    expect(overlaySrc).toContain('lazy')
    expect(overlaySrc).toContain('loading="eager"')
  })

  it('routes link activation itself — the frame is never allowed to navigate', () => {
    // The page renders inside its template chrome, so the real site nav is
    // present and clickable. The frame following a link would land on the
    // PUBLIC route (a 404 for anything unpublished) and destroy the draft
    // snapshot, so activation is cancelled in the capture phase and
    // re-interpreted against the draft. Mirrors IframeFrameSurface.
    expect(overlaySrc).toContain('NAVIGABLE_SELECTOR')
    expect(overlaySrc).toContain("addEventListener('click', onActivate, true)")
    expect(overlaySrc).toContain("addEventListener('auxclick', onActivate, true)")
    expect(overlaySrc).toContain("addEventListener('submit', blockSubmit, true)")
    expect(overlaySrc).toContain('event.preventDefault()')
    // Capture phase cancels the default only. Propagation must NOT be stopped —
    // that would silently break any other listener on the way down. Asserted on
    // the call syntax so the rationale can still be spelled out in a comment.
    expect(overlaySrc).not.toContain('.stopPropagation()')
  })

  it('injects a <base href> so root-relative /uploads/ assets resolve', () => {
    expect(overlaySrc).toContain('<base href=')
    expect(overlaySrc).toContain('window.location.origin')
  })

  it('offers an "Open live" action that opens the served page in a new tab', () => {
    // The static preview can't run scripts; the escape hatch is opening the
    // live page (same-origin top-level tab) where interactions run natively.
    expect(overlaySrc).toContain('Open live')
    expect(overlaySrc).toContain("window.open(liveTarget, '_blank', 'noopener,noreferrer')")
    expect(overlaySrc).toContain('activeLivePath')
    // …but only once there IS a live page: before the first publish the public
    // URL 404s, so the action must stay hidden.
    expect(overlaySrc).toContain('hasPublishedVersion')
  })
})

// ---------------------------------------------------------------------------
// 4 — Happy-path golden: 2-node tree → expected HTML (Phase 7 deliverable)
//
// Task #185 requires: "Unit test: render a simple 2-node tree and assert the
// HTML output matches expected string."
// ---------------------------------------------------------------------------

describe('publishPage — 2-node tree golden test (Phase 7)', () => {
  const rootModule = makeModule('base.body', {
    canHaveChildren: true,
    render: (_props, children) => ({ html: children.join('') }),
  })

  const headingModule = makeModule('base.text', {
    canHaveChildren: false,
    render: (props) => ({
      html: `<h1 class="instatic-heading">${props['text'] ?? ''}</h1>`,
      css: '/* base.text */\n.instatic-heading { font-family: sans-serif; margin: 0; }',
    }),
  })

  const reg = makeRegistry({ 'base.body': rootModule, 'base.text': headingModule })

  it('renders a 2-node tree (root + heading) to a complete HTML document', () => {
    const page = makePage(
      {
        root: { moduleId: 'base.body', children: ['h1'] },
        h1: { moduleId: 'base.text', props: { text: 'Hello World' } },
      },
      'root',
    )
    const site = makeSite({ name: 'Golden Test', pages: [page] })

    const { html, filename } = publishPage(page, site, reg)

    // Document structure
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html')
    expect(html).toContain('<body>')
    expect(html).toContain('</html>')

    // Page content
    expect(html).toContain('<h1 class="instatic-heading">Hello World</h1>')

    // CSS injection (deduplicated)
    expect(html).toContain('.instatic-heading { font-family: sans-serif; margin: 0; }')

    // Filename derivation
    expect(filename).toBe('index.html')
  })

  it('HTML-escapes text props — XSS cannot reach the output', () => {
    const page = makePage(
      {
        root: { moduleId: 'base.body', children: ['h1'] },
        h1: { moduleId: 'base.text', props: { text: '<script>alert(1)</script>' } },
      },
      'root',
    )
    const site = makeSite({ pages: [page] })
    const { html } = publishPage(page, site, reg)

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('CSS deduplication — 3 heading nodes produce 1 CSS entry', () => {
    const containerModule = makeModule('base.container', {
      canHaveChildren: true,
      render: (_props, children) => ({ html: `<div>${children.join('')}</div>` }),
    })
    const regWithContainer = makeRegistry({
      'base.body': makeModule('base.body', {
        canHaveChildren: true,
        render: (_props, children) => ({ html: children.join('') }),
      }),
      'base.container': containerModule,
      'base.text': headingModule,
    })

    const page = makePage(
      {
        root: { moduleId: 'base.body', children: ['wrap'] },
        wrap: { moduleId: 'base.container', children: ['h1', 'h2', 'h3'] },
        h1: { moduleId: 'base.text', props: { text: 'A' } },
        h2: { moduleId: 'base.text', props: { text: 'B' } },
        h3: { moduleId: 'base.text', props: { text: 'C' } },
      },
      'root',
    )
    const site = makeSite({ pages: [page] })
    const { html } = publishPage(page, site, regWithContainer)

    // The text-module CSS marker appears exactly once
    const occurrences = (html.match(/\/\* base\.text \*\//g) ?? []).length
    expect(occurrences).toBe(1)
  })

  it('output contains CSP meta tag (Constraint #227)', () => {
    const page = makePage(
      { root: { moduleId: 'base.body', children: [] } },
      'root',
    )
    const site = makeSite({ pages: [page] })
    const { html } = publishPage(page, site, reg)
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("script-src 'none'")
  })

  it('output has zero editor artefacts', () => {
    const page = makePage(
      { root: { moduleId: 'base.body', children: [] } },
      'root',
    )
    const site = makeSite({ pages: [page] })
    const { html } = publishPage(page, site, reg)
    expect(html).not.toContain('data-testid')
    expect(html).not.toContain('zustand')
    expect(html).not.toContain('data-reactroot')
    expect(html).not.toContain('__editor')
  })
})
