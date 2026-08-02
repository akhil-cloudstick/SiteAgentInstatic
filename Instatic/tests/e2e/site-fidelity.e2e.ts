/**
 * Site screen fidelity — the pixel half of the acceptance bar.
 *
 * The Site workspace is a pixel-match reproduction of the approved MMSBUILD
 * screen library's Site screen. `src/__tests__/architecture/siteScreenFidelity.test.ts`
 * audits the reference's token VALUES and icon names statically; this spec
 * answers the other half: does the rendered screen actually look like the
 * approved capture?
 *
 * ── Seeding the baselines (one-off) ───────────────────────────────────────
 * Playwright diffs against its own snapshot folder, so seed it from the
 * approved bundle once:
 *
 *   bun scripts/seed-site-fidelity-baselines.mjs
 *
 * That copies `screens/site/captures/*.png` into
 * `tests/e2e/site-fidelity.e2e.ts-snapshots/`. Re-run it whenever a new
 * screen-library handoff lands. Without it the spec is skipped, not failed —
 * the design bundle is a handoff, not a repo dependency.
 *
 * ── Running ───────────────────────────────────────────────────────────────
 *   bun run test:e2e -- site-fidelity
 *
 * ── What is masked, and why ───────────────────────────────────────────────
 * Three regions can never match, precisely because this editor shows real data
 * where the reference mock showed staged demo content:
 *
 *   1. The canvas interior — the mock draws a fake "LUXE SALON" page from
 *      bundled stock photography; the real editor renders the tenant's own
 *      site. The frame, rings, labels and toolbars around it must match; the
 *      pixels inside are the customer's.
 *   2. `[data-fidelity-dynamic]` — controls bound to real values (a heading, a
 *      character counter). Same box, same font, same position; different
 *      glyphs, therefore different widths.
 *   3. The presence peer stack — the mock hardcodes two stock portraits; real
 *      presence shows whoever is actually connected.
 *
 * Everything outside those masks is chrome and is expected to match.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { OWNER_STATE_FILE } from './helpers/constants'
import { openSiteEditor } from './helpers/editor'

const SNAPSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'site-fidelity.e2e.ts-snapshots')

/**
 * A wrong glyph, a 1px border or an off-by-one radius is a small area but a
 * real defect, so the ratio is deliberately tight rather than generous.
 */
const MAX_DIFF_PIXEL_RATIO = 0.005
/** Per-channel tolerance for antialiasing noise between machines. */
const THRESHOLD = 0.02

test.use({ storageState: OWNER_STATE_FILE })

interface FidelityState {
  name: string
  /** Baseline file name, matching the approved bundle's capture name. */
  snapshot: string
  viewport: { width: number; height: number }
  theme: 'light' | 'dark'
  prepare: (page: Page) => Promise<void>
}

const STATES: FidelityState[] = [
  { name: 'Live Edit (light)', snapshot: 'live-edit-light-1487x1058.png', viewport: { width: 1487, height: 1058 }, theme: 'light', prepare: (p) => clickMode(p, 'live') },
  { name: 'Live Edit (dark)', snapshot: 'live-edit-dark-1487x1058.png', viewport: { width: 1487, height: 1058 }, theme: 'dark', prepare: (p) => clickMode(p, 'live') },
  { name: 'Section Focus (light)', snapshot: 'section-focus-light-1487x1058.png', viewport: { width: 1487, height: 1058 }, theme: 'light', prepare: (p) => clickMode(p, 'focus') },
  { name: 'Section Focus (dark)', snapshot: 'section-focus-dark-1487x1058.png', viewport: { width: 1487, height: 1058 }, theme: 'dark', prepare: (p) => clickMode(p, 'focus') },
  { name: 'Responsive Review (light)', snapshot: 'responsive-review-light-1484x1060.png', viewport: { width: 1484, height: 1060 }, theme: 'light', prepare: (p) => clickMode(p, 'review') },
  { name: 'Responsive Review (dark)', snapshot: 'responsive-review-dark-1484x1060.png', viewport: { width: 1484, height: 1060 }, theme: 'dark', prepare: (p) => clickMode(p, 'review') },
  { name: 'Live Edit (390px)', snapshot: 'live-edit-mobile-390x844.png', viewport: { width: 390, height: 844 }, theme: 'light', prepare: (p) => clickMode(p, 'live') },
  { name: 'Outline drawer', snapshot: 'mobile-drawer-outline-390x844.png', viewport: { width: 390, height: 844 }, theme: 'light', prepare: (p) => p.getByTestId('workspace-dock-outline').click() },
  { name: 'Properties drawer', snapshot: 'mobile-drawer-properties-390x844.png', viewport: { width: 390, height: 844 }, theme: 'light', prepare: (p) => p.getByTestId('workspace-dock-properties').click() },
  { name: 'Advanced drawer', snapshot: 'mobile-drawer-advanced-390x844.png', viewport: { width: 390, height: 844 }, theme: 'light', prepare: (p) => p.getByTestId('workspace-dock-advanced').click() },
  { name: 'Publish menu', snapshot: 'publish-menu-1280x900.png', viewport: { width: 1280, height: 900 }, theme: 'light', prepare: (p) => p.getByTestId('toolbar-publish-actions-trigger').click() },
  { name: 'Preview overlay', snapshot: 'preview-overlay-1280x900.png', viewport: { width: 1280, height: 900 }, theme: 'light', prepare: (p) => p.getByTestId('toolbar-preview-btn').click() },
]

/**
 * Drive the mode through the real control, never the store — a state that
 * cannot be reached by clicking is a finding in itself.
 */
async function clickMode(page: Page, mode: 'live' | 'focus' | 'review'): Promise<void> {
  const button = page.getByTestId(`site-mode-${mode}`)
  if (await button.isVisible().catch(() => false)) await button.click()
}

test.describe('Site screen fidelity', () => {
  for (const state of STATES) {
    test(state.name, async ({ page }) => {
      test.skip(
        !existsSync(join(SNAPSHOT_DIR, state.snapshot)),
        'Approved baseline not seeded — run scripts/seed-site-fidelity-baselines.mjs',
      )

      await page.setViewportSize(state.viewport)
      await page.emulateMedia({ colorScheme: state.theme })
      await openSiteEditor(page)
      await page.evaluate((theme) => {
        document.documentElement.setAttribute('data-editor-theme', theme)
      }, state.theme)
      await expect(page.getByTestId('site-workspace-toolbar')).toBeVisible()
      await state.prepare(page)

      await expect(page).toHaveScreenshot(state.snapshot, {
        mask: [
          // The tenant's real site, not the mock's staged salon page.
          page.locator('[data-testid="canvas-root"] iframe'),
          // Controls bound to real values.
          page.locator('[data-fidelity-dynamic]'),
          // Real collaborators, not the mock's two stock portraits.
          page.locator('[data-testid="presence-peer-stack"]'),
        ],
        maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
        threshold: THRESHOLD,
        animations: 'disabled',
        // The canvas iframes settle asynchronously; let the shot stabilise
        // rather than racing the first paint.
        timeout: 30_000,
      })
    })
  }
})
