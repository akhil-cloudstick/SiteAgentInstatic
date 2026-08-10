/**
 * Data screen fidelity gate — the static half of the acceptance bar.
 *
 * The Data workspace is a pixel-match reproduction of the approved MMSBUILD
 * Data Workbench screen. A pixel diff catches "this looks wrong"; it is
 * weakest exactly where this re-skin is most likely to drift — a value that is
 * visually close but is not the reference number (12px vs 11px, 650 vs 600, a
 * 7px radius rounded to 8), or a geometry token quietly retuned later.
 *
 * So this gate reads the reference sources directly and asserts:
 *   1. Every colour the reference declares exists as a token in globals.css.
 *   2. The reference's exact geometry values appear in the Data token block.
 *   3. The in-repo invariants that keep the screen honest hold regardless of
 *      whether the reference bundle is present.
 *
 * The reference bundle lives outside the repo (it is a design handoff, not a
 * dependency), so when it is absent — CI, a fresh clone — the value-level
 * gates skip and only the in-repo invariants run. That keeps the gate useful
 * where the bundle exists without making the build depend on a downloads
 * folder. Mirrors `siteScreenFidelity.test.ts`.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../..')

/** The approved screen bundle, as handed off on 2026-08-06. */
const REFERENCE_STYLES = join(
  'c:', 'Users', 'itsinfra', 'Downloads',
  'mmsbuild-data-workbench-2026-08-06-fixed',
  'mmsbuild-data-workbench', 'src', 'styles.css',
)
const REFERENCE_APP = REFERENCE_STYLES.replace('styles.css', 'App.jsx')

const hasReference = existsSync(REFERENCE_STYLES) && existsSync(REFERENCE_APP)

function read(relative: string): string {
  const path = join(ROOT, relative)
  if (!existsSync(path)) throw new Error(`[fidelity] missing file: ${relative}`)
  return readFileSync(path, 'utf8')
}

/** The token file plus every CSS module that reproduces the approved screen. */
const DATA_SCREEN_CSS = [
  'styles/globals.css',
  'admin/pages/data/components/DataGrid/DataGrid.module.css',
  'admin/pages/data/components/DataSidebar/DataSidebar.module.css',
  'admin/pages/data/components/DataInspector/DataInspector.module.css',
  'admin/pages/data/components/DataWorkbenchHeader/DataWorkbenchHeader.module.css',
] as const

function allScreenCss(): string {
  return DATA_SCREEN_CSS.map((f) => read(f)).join('\n')
}

// ---------------------------------------------------------------------------
// 1. Palette — every colour the reference's `:root` declares is tokenized.
// ---------------------------------------------------------------------------

/** `--mms-bg: #fbf7ea;` → ['--mms-bg', '#fbf7ea'] */
function referenceRootTokens(): Array<[string, string]> {
  const source = readFileSync(REFERENCE_STYLES, 'utf8')
  const root = source.slice(source.indexOf(':root {'), source.indexOf('}', source.indexOf(':root {')))
  const out: Array<[string, string]> = []
  for (const line of root.split('\n')) {
    const match = line.match(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8});/)
    if (match) out.push([match[1], match[2].toLowerCase()])
  }
  return out
}

describe('Data screen fidelity — palette', () => {
  it.skipIf(!hasReference)('every reference colour token is declared for the data screen', () => {
    const globals = read('styles/globals.css')
    const dataBlock = globals.slice(globals.indexOf("[data-editor-screen='data']"))
    expect(dataBlock.length).toBeGreaterThan(0)

    const missing: string[] = []
    for (const [name, value] of referenceRootTokens()) {
      // The reference declares these on its own `:root`; ours must carry the
      // same name at the same value inside the data scope.
      const declared = new RegExp(`${name}:\\s*${value};`, 'i').test(dataBlock)
      if (!declared) missing.push(`${name}: ${value}`)
    }

    if (missing.length > 0) {
      throw new Error(
        `[data-fidelity] ${missing.length} reference colour(s) missing or drifted in the ` +
        `[data-editor-screen='data'] block of globals.css:\n` +
        missing.map((m) => `  ${m}`).join('\n'),
      )
    }
    expect(missing).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 2. Geometry — the reference's load-bearing pixel values.
// ---------------------------------------------------------------------------

/**
 * Values the approved screen specifies exactly. These are the numbers a
 * re-skin drifts first, and each one is visible: row height sets grid density,
 * the gutters set the sticky-column offsets, the band heights set the vertical
 * rhythm of the whole workspace.
 */
const REQUIRED_GEOMETRY: ReadonlyArray<[string, string]> = [
  ['--data-row-h', '78px'],
  ['--data-head-h', '54px'],
  ['--data-context-h', '78px'],
  ['--data-toolbar-h', '74px'],
  ['--data-footer-h', '70px'],
  ['--data-group-h', '44px'],
  ['--data-protected-h', '38px'],
  ['--data-gutter', '52px'],
  ['--data-rail-w', '44px'],
  ['--data-panel-header-h', '64px'],
  ['--data-left-track', '344px'],
  ['--data-right-track', '330px'],
  ['--data-table-min-w', '760px'],
  ['--data-dock-h', '62px'],
  ['--data-tap', '44px'],
]

describe('Data screen fidelity — geometry', () => {
  it('declares the reference geometry tokens at their exact values', () => {
    const globals = read('styles/globals.css')
    const drift: string[] = []
    for (const [name, value] of REQUIRED_GEOMETRY) {
      if (!new RegExp(`${name}:\\s*${value};`).test(globals)) {
        drift.push(`${name} should be ${value}`)
      }
    }
    if (drift.length > 0) {
      throw new Error(
        `[data-fidelity] geometry drift in globals.css:\n` +
        drift.map((d) => `  ${d}`).join('\n'),
      )
    }
    expect(drift).toHaveLength(0)
  })

  it('the reference itself still specifies those heights', () => {
    if (!hasReference) return
    const source = readFileSync(REFERENCE_STYLES, 'utf8')
    // Spot-check the three that define the grid's density and rhythm.
    expect(source).toContain('min-height: 78px')  // .data-grid-body-row
    expect(source).toContain('min-height: 54px')  // .data-grid-head
    expect(source).toContain('min-width: 52px')   // .selection-cell
  })
})

// ---------------------------------------------------------------------------
// 3. In-repo invariants — run with or without the reference bundle.
// ---------------------------------------------------------------------------

describe('Data screen fidelity — invariants', () => {
  it('the workspace body carries the data screen scope', () => {
    const layout = read('admin/layouts/AdminWorkspaceCanvasLayout/AdminWorkspaceCanvasLayout.tsx')
    // Every workspace this layout serves now has an approved screen, so the
    // scope attribute is the workspace id directly. What matters for Data is
    // that the attribute is on the BODY, not the shell — the shared toolbar
    // sits outside it and must keep the Dashboard palette.
    expect(layout).toContain('data-editor-screen={workspace}')
    expect(layout).toMatch(/className=\{styles\.editorBody\}[\s\S]{0,600}?data-editor-screen/)
  })

  it('the Data page renders the approved pixel-art icon set, not the Remix re-skin', () => {
    // Every Data component imports from the page-local set; a stray deep
    // import of the shared vendor would render a different icon family on
    // one control and read as a bug.
    const strays: string[] = []
    for (const file of [
      'admin/pages/data/DataPage.tsx',
      'admin/pages/data/components/DataGrid/DataGrid.tsx',
      'admin/pages/data/components/DataGrid/DataGridRow.tsx',
      'admin/pages/data/components/DataSidebar/DataSidebar.tsx',
      'admin/pages/data/components/DataInspector/DataInspector.tsx',
      'admin/pages/data/components/DataWorkbenchHeader/DataWorkbenchHeader.tsx',
    ]) {
      if (/from\s+['"]pixel-art-icons\/icons\//.test(read(file))) strays.push(file)
    }
    expect(strays).toHaveLength(0)
  })

  it('the grid is the only element allowed to scroll horizontally', () => {
    const grid = read('admin/pages/data/components/DataGrid/DataGrid.module.css')
    expect(grid).toMatch(/\.scrollContainer\s*\{[^}]*overflow:\s*auto/)
    // A floor on the table keeps narrow viewports scrolling rather than
    // crushing columns — and keeps the overflow inside the scroller.
    expect(grid).toContain('var(--data-table-min-w)')
  })

  it('long values are prevented from breaking the grid or the inspector', () => {
    const grid = read('admin/pages/data/components/DataGrid/DataGrid.module.css')
    const inspector = read('admin/pages/data/components/DataInspector/DataInspector.module.css')
    // Cells clip; the truncate helper ellipsises single-run text.
    expect(grid).toMatch(/\.cell\s*\{[^}]*overflow:\s*hidden/)
    expect(grid).toContain('.truncateCell')
    // Inspector values wrap rather than overflow the panel.
    expect(inspector).toContain('overflow-wrap: anywhere')
  })

  it('no Data CSS module hardcodes a colour', () => {
    // `css-token-policy` covers the whole admin; this narrows the failure
    // message to the Data re-skin, where transcribing the reference's raw
    // literals is the tempting shortcut.
    const offenders: string[] = []
    for (const file of DATA_SCREEN_CSS) {
      if (file === 'styles/globals.css') continue
      const source = read(file)
      for (const line of source.split('\n')) {
        if (/^\s*\/\*/.test(line)) continue
        if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(line)) {
          offenders.push(`${file}: ${line.trim()}`)
        }
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `[data-fidelity] hardcoded colour(s) in Data CSS — add a token to the ` +
        `[data-editor-screen='data'] block instead:\n` +
        offenders.map((o) => `  ${o}`).join('\n'),
      )
    }
    expect(offenders).toHaveLength(0)
  })

  it('the shared toolbar is left alone — the re-skin is scoped to the body', () => {
    // Deviation #2 in the migration plan: the approved screen's own 61px app
    // header is out of scope, so nothing here may retune the shared toolbar.
    const globals = read('styles/globals.css')
    const dataBlockStart = globals.indexOf("[data-editor-screen='data']")
    const dataBlock = globals.slice(dataBlockStart, globals.indexOf('\n}', dataBlockStart))
    expect(dataBlock).not.toContain('--toolbar-')
  })
})
