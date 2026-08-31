/**
 * Media screen fidelity gate — the static half of the acceptance bar.
 *
 * The Media workspace is a reproduction of the approved MMSBUILD screen
 * library's Media screen, under the migration rule agreed for it:
 *   • STRUCTURE and geometry come from `screens/media/src/styles.css`.
 *   • LOOKS come from the approved design masters in
 *     `docs/instatic/cms-new-ui-review/04-media-*-approved-*.png`.
 *
 * A pixel diff catches "this looks wrong"; it is weakest exactly where this
 * re-skin is most likely to drift — a value that is visually close but is not
 * the reference number (13px vs 12px, a 7px radius rounded to 8), and a Font
 * Awesome glyph swapped for a near-neighbour that reads fine but is not the
 * approved icon.
 *
 * So this gate reads the reference source directly and asserts:
 *   1. Every colour the reference declares exists as a token in globals.css.
 *   2. The reference's exact geometry values appear in the media token block.
 *   3. Every FA glyph the Media surfaces render actually exists in the
 *      vendored Font Awesome Solid set.
 *   4. The shared-surface guards that keep Media's re-skin from leaking into
 *      Site / Content / Data / Dashboard stay in place.
 *
 * The reference bundle lives outside the repo (it is a design handoff, not a
 * dependency), so when it is absent — CI, a fresh clone — the value-level
 * gates skip and only the in-repo invariants run. That keeps the gate useful
 * where the bundle exists without making the build depend on a downloads
 * folder. Same arrangement as `siteScreenFidelity.test.ts`.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../..')

/** The approved screen bundle, as handed off on 2026-08-07. */
const REFERENCE_STYLES = join(
  'c:', 'Users', 'itsinfra', 'Downloads',
  'mmsbuild-instatic-screen-library-20260807-media-plugins',
  'mmsbuild-instatic-screen-library', 'screens', 'media', 'src', 'styles.css',
)

const hasReference = existsSync(REFERENCE_STYLES)

function read(relative: string): string {
  const path = join(ROOT, relative)
  if (!existsSync(path)) throw new Error(`[media-fidelity] missing file: ${relative}`)
  return readFileSync(path, 'utf8')
}

/** The CSS modules that reproduce the approved screen. */
const MEDIA_SCREEN_CSS = [
  'admin/pages/media/components/MediaSidebar/MediaSidebar.module.css',
  'admin/pages/media/components/MediaFolderPanel/MediaFolderPanel.module.css',
  'admin/pages/media/components/MediaCanvas/MediaCanvas.module.css',
  'admin/pages/media/components/MediaViewerWindow/MediaViewerWindow.module.css',
  'admin/pages/media/components/UploadQueueWindow/UploadQueueWindow.module.css',
  'admin/pages/media/components/ReplaceFileDialog/ReplaceFileDialog.module.css',
  'admin/pages/media/components/BulkEditWindow/BulkEditWindow.module.css',
] as const

/** TSX that renders the re-skinned surfaces — the icon audit's search space. */
const MEDIA_SCREEN_TSX = [
  'admin/pages/media/MediaPage.tsx',
  'admin/pages/media/components/MediaSidebar/MediaSidebar.tsx',
  'admin/pages/media/components/MediaFolderPanel/MediaFolderPanel.tsx',
  'admin/pages/media/components/MediaCanvas/MediaCanvas.tsx',
  'admin/pages/media/components/MediaCanvas/MediaCanvasItems.tsx',
  'admin/pages/media/components/MediaViewerWindow/MediaViewerWindow.tsx',
  'admin/pages/media/components/UploadQueueWindow/UploadQueueWindow.tsx',
  'admin/pages/media/components/ReplaceFileDialog/ReplaceFileDialog.tsx',
  'admin/pages/media/components/BulkEditWindow/BulkEditWindow.tsx',
] as const

const combinedCss = () => MEDIA_SCREEN_CSS.map(read).join('\n')
const combinedTsx = () => MEDIA_SCREEN_TSX.map(read).join('\n')

describe('media screen fidelity — in-repo invariants', () => {
  it('declares the media-scoped palette without disturbing the other screens', () => {
    const globals = read('styles/globals.css')
    expect(globals).toContain("[data-editor-screen='media']")
    expect(globals).toContain("[data-editor-theme='dark'] [data-editor-screen='media']")
    // The Dashboard's approved green must survive in the generic ramp…
    expect(globals).toMatch(/--mms-action:\s*#1ba957/)
    // …and the Media screen's deeper green must exist in the scoped block.
    expect(globals).toMatch(/--mms-action:\s*#15964e/)
  })

  it('activates the media scope on the workspace body', () => {
    const layout = read(
      'admin/layouts/AdminWorkspaceCanvasLayout/AdminWorkspaceCanvasLayout.tsx',
    )
    // Media used to be excluded from the scope; the whole re-skin hangs off
    // this attribute reaching the media body.
    expect(layout).toContain('data-editor-screen={workspace}')
    expect(layout).not.toContain("workspace === 'media' ? undefined")
  })

  it('carries the media scope onto the portalled picker and viewer', () => {
    // Both portal to document.body, landing OUTSIDE the workspace that opened
    // them. Without this they would render with the Site / Content / Data
    // palette. See the shared-surface analysis in the migration plan.
    const picker = read('admin/pages/media/components/MediaPickerModal/MediaPickerModal.tsx')
    const viewer = read('admin/pages/media/components/MediaViewerWindow/MediaViewerWindow.tsx')
    expect(picker).toContain('data-editor-screen="media"')
    expect(viewer).toContain('data-editor-screen="media"')
  })

  it('suppresses page chrome when the canvas is embedded in the picker', () => {
    const canvas = read('admin/pages/media/components/MediaCanvas/MediaCanvas.tsx')
    const picker = read('admin/pages/media/components/MediaPickerModal/MediaPickerModal.tsx')
    expect(canvas).toContain("chrome?: 'page' | 'embedded'")
    expect(canvas).toContain('pageChrome')
    // A picker modal must not grow a breadcrumb / library heading / upload
    // trigger / footer count.
    expect(picker).toContain('chrome="embedded"')
  })

  it('keeps the MediaCanvas classes the Data repeater gallery consumes', () => {
    // `MediaRepeaterGallery` imports this module directly and renders twelve
    // of its classes. Renaming or deleting one silently breaks a Data cell.
    const css = read('admin/pages/media/components/MediaCanvas/MediaCanvas.module.css')
    for (const name of [
      'tileItem', 'rowItem', 'tile', 'row', 'tilePreview', 'rowPreview',
      'tileBody', 'tileLabel', 'tileMeta', 'rowLabel', 'rowMeta', 'itemActions',
    ]) {
      expect(css).toContain(`.${name}`)
    }
  })

  it('does not borrow another workspace\'s CSS module', () => {
    const tsx = combinedTsx()
    // Media owned none of its chrome before this migration; borrowing again
    // would mean restyling Media repaints the Site editor.
    expect(tsx).not.toContain('@site/canvas/CanvasRoot.module.css')
    expect(tsx).not.toContain('LeftSidebar/LeftSidebar.module.css')
    expect(tsx).not.toContain('PanelRail/PanelRail.module.css')
  })

  it('uses Font Awesome, not the Remix set, on the re-skinned surfaces', () => {
    const tsx = combinedTsx()
    expect(tsx).toContain('FaIcon')
    const remixImports = tsx.match(/from 'pixel-art-icons\/icons\/[^']+'/g) ?? []
    expect(remixImports).toEqual([])
  })

  it('renders only glyphs that exist in the vendored Font Awesome set', () => {
    const fontAwesome = read('styles/fontawesome/fontawesome-solid.css')
    const tsx = combinedTsx()
    const glyphs = new Set(
      [...tsx.matchAll(/<FaIcon\s+name="([a-z0-9-]+)"/g)].map((m) => m[1]),
    )
    expect(glyphs.size).toBeGreaterThan(0)
    const missing = [...glyphs].filter(
      (glyph) => !new RegExp(`\\.fa-${glyph}[:,{ ]`).test(fontAwesome),
    )
    expect(missing).toEqual([])
  })

  it('keeps every re-skinned CSS module free of hardcoded colours', () => {
    // globals.css is where literals legitimately live; the modules must not
    // repeat them. Mirrors css-token-policy but scoped to this screen so a
    // failure names the fidelity work rather than the global rule.
    const offenders: string[] = []
    for (const relative of MEDIA_SCREEN_CSS) {
      const withoutComments = read(relative).replace(/\/\*[\s\S]*?\*\//g, '')
      if (/#[0-9a-fA-F]{3,8}\b/.test(withoutComments)) offenders.push(`${relative} (hex)`)
      if (/\b(?:rgba?|hsla?)\(/.test(withoutComments)) offenders.push(`${relative} (rgb/hsl)`)
    }
    expect(offenders).toEqual([])
  })

  it('leaves media pixels unfiltered in both themes', () => {
    // Dark mode themes the CMS chrome only. A filter on a thumbnail or a
    // preview would recolour the user's own media.
    const css = combinedCss()
    const filtered = [...css.matchAll(/\.(tileImage|rowImage|previewImage|preview)\s*\{[^}]*\}/g)]
      .filter((match) => /filter\s*:/.test(match[0]))
      .map((match) => match[1])
    expect(filtered).toEqual([])
  })

  it('owns its folder rows instead of overriding the shared Tree module', () => {
    const treeRow = read('admin/pages/site/ui/Tree/TreeRow.module.css')
    const panel = read('admin/pages/media/components/MediaFolderPanel/MediaFolderPanel.tsx')
    // The reference draws plain `.folder-row` buttons, not editor tree rows.
    // The Media panel therefore owns its rows outright — and must leave the
    // module shared by the DOM panel, Site explorer, Content explorer and
    // HTML-import modal completely alone.
    expect(treeRow).not.toContain("[data-editor-screen='media']")
    expect(treeRow).toContain(":global([data-editor-screen='site']) .row")
    expect(panel).not.toContain('@admin/pages/site/ui/Tree')
  })

  it('never shows a desktop close button on the folder column', () => {
    // The reference has the button in markup but hides it with
    // `.sidebar-close { display: none }`, revealing it only at ≤767px where
    // the column becomes a drawer.
    const css = read('admin/pages/media/components/MediaSidebar/MediaSidebar.module.css')
    const closeRule = css.match(/\.sidebarClose\s*\{[^}]*\}/)
    expect(closeRule).not.toBeNull()
    expect(closeRule?.[0]).toContain('display: none')
    // …and it comes back inside the mobile block.
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.sidebarClose\s*\{\s*display: grid/)
  })

  it('opens Storage as a panel instead of replacing the folder column', () => {
    const sidebar = read('admin/pages/media/components/MediaSidebar/MediaSidebar.tsx')
    const css = read('admin/pages/media/components/MediaSidebar/MediaSidebar.module.css')
    // `.storage-panel` is `position: fixed` in the reference; the folder
    // column stays mounted alongside it.
    expect(css).toMatch(/\.storagePanel\s*\{[^}]*position: fixed/)
    // The folder panel is rendered unconditionally — never behind a ternary
    // that swaps it for Storage.
    expect(sidebar).toContain('<MediaFolderPanel workspace={workspace} />')
    expect(sidebar).toContain('<MediaStoragePanel />')
    expect(sidebar).not.toMatch(/activePanel === 'folders' \?[\s\S]{0,80}<MediaStoragePanel/)
  })

  it('uses the reference rail glyphs', () => {
    const sidebar = read('admin/pages/media/components/MediaSidebar/MediaSidebar.tsx')
    // fa-folder-open / fa-hard-drive / fa-gear, in that order.
    for (const glyph of ['folder-open', 'hard-drive', 'gear']) {
      expect(sidebar).toContain(`name="${glyph}"`)
    }
  })

  it('keeps the reference folder-menu structure', () => {
    const panel = read('admin/pages/media/components/MediaFolderPanel/MediaFolderPanel.tsx')
    // Two sections, the reference's labels and its smart-folder names.
    expect(panel).toContain('Library')
    expect(panel).toContain('Smart folders')
    for (const label of [
      'All media', 'Trash', 'Missing alt', 'Missing title',
      'Untagged', 'Large files', 'Recently replaced',
    ]) {
      expect(panel).toContain(label)
    }
    // Smart folders carry a chevron and no count; library rows carry counts.
    expect(panel).toContain('chevron')
  })
})

describe.if(hasReference)('media screen fidelity — reference values', () => {
  const reference = () => readFileSync(REFERENCE_STYLES, 'utf8')

  it('transcribes the reference palette into the media scope', () => {
    const globals = read('styles/globals.css')
    const source = reference()
    // Pull the reference's own `--mms-*` declarations and require each one to
    // appear verbatim in globals.css.
    const declared = [...source.matchAll(/(--mms-[a-z-]+):\s*([^;]+);/g)]
      .map(([, name, value]) => [name, value.trim()] as const)
    const missing = declared.filter(([name, value]) => {
      // Alpha colours are re-authored as rgba() in globals; compare loosely.
      if (value.startsWith('rgb')) return false
      // Shadow / ring declarations are not colours and are deliberately
      // re-namespaced to `--media-*`: the `--mms-*` set is shared with the
      // other scoped screens, so redefining `--mms-focus` here would change
      // Site / Content / Data too. `--media-focus` is asserted separately.
      if (/\dpx/.test(value)) return false
      return !globals.includes(`${name}: ${value};`)
    })
    expect(missing.map(([n, v]) => `${n}: ${v}`)).toEqual([])
  })

  it('carries the reference geometry into the media token block', () => {
    const globals = read('styles/globals.css')
    // Structural numbers the approved screen fixes. A drift here is exactly
    // the "visually close but not the reference number" failure this gate
    // exists to catch.
    expect(globals).toMatch(/--media-rail-w:\s*50px/)
    expect(globals).toMatch(/--media-sidebar-w:\s*276px/)
    expect(globals).toMatch(/--media-tap:\s*44px/)
    expect(globals).toMatch(/--media-toolbar-h:\s*64px/)
    expect(globals).toMatch(/--media-titlebar-h:\s*54px/)
    expect(globals).toMatch(/--media-footer-h:\s*58px/)
    expect(globals).toMatch(/--media-thumb-ratio:\s*1\.28/)
    expect(globals).toMatch(/--media-radius-7:\s*7px/)
    expect(globals).toMatch(/--media-radius-9:\s*9px/)
    expect(globals).toMatch(/--media-radius-12:\s*12px/)
  })

  it('keeps the reference breakpoints and adds none of its own', () => {
    const source = reference()
    const referenceWidths = new Set(
      [...source.matchAll(/max-width:\s*(\d+)px/g)].map((m) => m[1]),
    )
    const ours = new Set(
      [...combinedCss().matchAll(/max-width:\s*(\d+)px/g)].map((m) => m[1]),
    )
    const invented = [...ours].filter((width) => !referenceWidths.has(width))
    expect(invented).toEqual([])
  })

  it('keeps the reference focus treatment on this screen', () => {
    const globals = read('styles/globals.css')
    // The reference focuses in amber, where the rest of the admin is green.
    expect(globals).toMatch(/--media-focus:\s*0 0 0 3px rgba\(243, 201, 79, 0\.78\)/)
  })
})
