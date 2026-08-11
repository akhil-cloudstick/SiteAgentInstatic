/**
 * Users screen fidelity gate — the static half of the acceptance bar.
 *
 * The Team Access workspace is a pixel-match reproduction of the approved
 * MMSBUILD "Adaptive Team Access Workspace" screen. A pixel diff catches "this
 * looks wrong"; it is weakest exactly where this re-skin is most likely to
 * drift — a value that is visually close but is not the reference number
 * (12px vs 11px, 680 vs 700, a 7px radius rounded to 8), or a geometry token
 * quietly retuned later.
 *
 * So this gate reads the reference sources directly and asserts:
 *   1. Every colour the reference declares exists as a token in globals.css.
 *   2. The reference's exact geometry values appear in the Users token block.
 *   3. The in-repo invariants that keep the screen honest hold regardless of
 *      whether the reference bundle is present.
 *
 * The reference bundle lives outside the repo (it is a design handoff, not a
 * dependency), so when it is absent — CI, a fresh clone — the value-level
 * gates skip and only the in-repo invariants run. Mirrors
 * `dataScreenFidelity.test.ts` and `mediaScreenFidelity.test.ts`.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../..')

/** The approved screen bundle, as handed off. */
const REFERENCE_STYLES = join(
  'c:', 'Users', 'itsinfra', 'Downloads',
  'mmsbuild-instatic-users-profilepage',
  'mmsbuild-instatic-users', 'src', 'styles.css',
)
const REFERENCE_WORKSPACE = REFERENCE_STYLES.replace('styles.css', 'workspace.jsx')

const hasReference = existsSync(REFERENCE_STYLES) && existsSync(REFERENCE_WORKSPACE)

function read(relative: string): string {
  const path = join(ROOT, relative)
  if (!existsSync(path)) throw new Error(`[fidelity] missing file: ${relative}`)
  return readFileSync(path, 'utf8')
}

const USERS_DIR = 'admin/pages/users'

/** Every `.tsx` under the Users page, discovered rather than enumerated. */
function usersTsxFiles(): string[] {
  const out: string[] = []
  function walk(relative: string): void {
    for (const entry of readdirSync(join(ROOT, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(child)
    }
  }
  walk(USERS_DIR)
  return out
}

/** Every CSS module under the Users page. */
function usersCssFiles(): string[] {
  const out: string[] = []
  function walk(relative: string): void {
    for (const entry of readdirSync(join(ROOT, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (entry.name.endsWith('.module.css')) out.push(child)
    }
  }
  walk(USERS_DIR)
  return out
}

function combinedTsx(): string {
  return usersTsxFiles().map((file) => read(file)).join('\n')
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

/**
 * The block from the rule itself — anchored on the opening brace, because the
 * banner comment above it names the selector too.
 */
function usersBlock(): string {
  const globals = read('styles/globals.css')
  const start = globals.indexOf("[data-editor-screen='users'] {")
  expect(start).toBeGreaterThan(-1)
  return globals.slice(start)
}

/** The rule's declarations, comments removed. */
function usersDeclarations(): string {
  const block = usersBlock()
  return block.slice(0, block.indexOf('\n}')).replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('Users screen fidelity — palette', () => {
  it.skipIf(!hasReference)('every reference colour token is declared for the users screen', () => {
    const block = usersBlock()
    const missing: string[] = []
    for (const [name, value] of referenceRootTokens()) {
      // The reference declares these on its own `:root`; ours must carry the
      // same name at the same value inside the users scope.
      if (!new RegExp(`${name}:\\s*${value};`, 'i').test(block)) missing.push(`${name}: ${value}`)
    }
    if (missing.length > 0) {
      throw new Error(
        `[users-fidelity] ${missing.length} reference colour(s) missing or drifted in the ` +
        `[data-editor-screen='users'] block of globals.css:\n` +
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
 * re-skin drifts first, and each one is visible: the roster row height sets
 * the roster's density, the workbench tracks set its three-pane balance, the
 * sheet width sets how much of the roster stays visible behind it.
 */
const REQUIRED_GEOMETRY: ReadonlyArray<[string, string]> = [
  ['--users-wrap-w', '1385px'],
  ['--users-wrap-gutter', '64px'],
  ['--users-heading-min-h', '150px'],
  ['--users-tabs-h', '68px'],
  ['--users-tabs-min-w', '480px'],
  ['--users-tab-min-w', '160px'],
  ['--users-tab-underbar', '3px'],
  ['--users-controls-min-h', '102px'],
  ['--users-head-h', '60px'],
  ['--users-row-h', '122px'],
  ['--users-avatar', '58px'],
  ['--users-chip-h', '29px'],
  ['--users-menu-trigger', '48px'],
  ['--users-menu-w', '190px'],
  ['--users-trust-h', '62px'],
  ['--users-sheet-w', '645px'],
  ['--users-field-h', '48px'],
  ['--users-role-summary-icon', '66px'],
  ['--users-rail-w', '340px'],
  ['--users-editor-min-w', '500px'],
  ['--users-summary-w', '285px'],
  ['--users-panel-min-h', '705px'],
  ['--users-role-row-h', '76px'],
  ['--users-role-mark', '40px'],
  ['--users-cap-head-h', '39px'],
  ['--users-cap-row-h', '38px'],
  ['--users-summary-shield', '38px'],
  ['--users-activity-head-h', '85px'],
  ['--users-activity-col-head-h', '52px'],
  ['--users-activity-row-h', '88px'],
  ['--users-activity-icon', '38px'],
  ['--users-tap', '44px'],
]

describe('Users screen fidelity — geometry', () => {
  it('declares the reference geometry tokens at their exact values', () => {
    const globals = read('styles/globals.css')
    const drift: string[] = []
    for (const [name, value] of REQUIRED_GEOMETRY) {
      if (!new RegExp(`${name}:\\s*${value};`).test(globals)) drift.push(`${name} should be ${value}`)
    }
    if (drift.length > 0) {
      throw new Error(
        `[users-fidelity] geometry drift in globals.css:\n` +
        drift.map((d) => `  ${d}`).join('\n'),
      )
    }
    expect(drift).toHaveLength(0)
  })

  it('the reference itself still specifies those heights', () => {
    if (!hasReference) return
    const source = readFileSync(REFERENCE_STYLES, 'utf8')
    // Spot-check the four that define the screen's density and rhythm.
    expect(source).toContain('min-height: 122px') // .person-row
    expect(source).toContain('height: 68px')      // .workspace-tabs
    expect(source).toContain('min-height: 705px') // .roles-panel
    expect(source).toContain('min-height: 88px')  // .activity-row
  })
})

// ---------------------------------------------------------------------------
// 3. In-repo invariants — run with or without the reference bundle.
// ---------------------------------------------------------------------------

describe('Users screen fidelity — invariants', () => {
  it('the workspace body carries the users screen scope', () => {
    const page = read(`${USERS_DIR}/UsersPage.tsx`)
    // On the BODY, not the shell: the two shared header rows sit outside it
    // and must keep the Dashboard palette.
    expect(page).toContain('data-editor-screen="users"')
    expect(page).toContain('mode="users"')
  })

  it('leaves the shared header rows alone — the re-skin is body-scoped', () => {
    // Reading `--hub-shell-height` / `--product-row-height` is fine (the sheet
    // insets below the header); REDECLARING them, or any `--toolbar-*`, would
    // retune chrome this screen does not own.
    const declarations = usersDeclarations()
    expect(declarations).not.toContain('--toolbar-')
    expect(declarations).not.toContain('--hub-shell-height:')
    expect(declarations).not.toContain('--product-row-height:')
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
    // Inline JSX plus the glyph names held in the two `*_ICONS` lookup maps
    // (tab icons, capability-group icons) and the `activityIcon` dispatcher.
    // Map values (`'Dashboard': 'table-cells-large',`) and the dispatcher's
    // returns (`return 'user-lock'`) — not the strings they match ON.
    const mapValues = [...tsx.matchAll(/_ICONS[^=]*=\s*\{([\s\S]*?)\n\}/g)]
      .flatMap((match) => [...match[1].matchAll(/:\s*'([a-z][a-z0-9-]+)'/g)].map((m) => m[1]))
    const dispatcher = tsx.match(/function activityIcon[\s\S]*?\n\}/)?.[0] ?? ''
    const returned = [...dispatcher.matchAll(/return '([a-z][a-z0-9-]+)'/g)].map((m) => m[1])
    const glyphs = new Set([
      ...[...tsx.matchAll(/<FaIcon\s+name="([a-z0-9-]+)"/g)].map((m) => m[1]),
      // `name={cond ? 'a' : 'b'}` — both branches, not the value `cond`
      // compares against.
      ...[...tsx.matchAll(/<FaIcon\s+name=\{[^}]*\?\s*'([a-z][a-z0-9-]+)'\s*:\s*'([a-z][a-z0-9-]+)'/g)]
        .flatMap((m) => [m[1], m[2]]),
      ...mapValues,
      ...returned,
    ])
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
    for (const relative of usersCssFiles()) {
      const withoutComments = read(relative).replace(/\/\*[\s\S]*?\*\//g, '')
      if (/#[0-9a-fA-F]{3,8}\b/.test(withoutComments)) offenders.push(`${relative} (hex)`)
      if (/\b(?:rgba?|hsla?)\(/.test(withoutComments)) offenders.push(`${relative} (rgb/hsl)`)
    }
    expect(offenders).toEqual([])
  })

  it('long content is prevented from breaking the roster or the workbench', () => {
    // Every constrained text container carries `min-width: 0` plus an explicit
    // decision — ellipsis for single-line identity values, wrap for the rest.
    // This is what keeps the ladder aligned regardless of the data.
    const people = read(`${USERS_DIR}/panels/PeoplePanel.module.css`)
    const editor = read(`${USERS_DIR}/components/RoleEditor/RoleEditor.module.css`)
    const activity = read(`${USERS_DIR}/panels/ActivityPanel.module.css`)
    expect(people).toContain('text-overflow: ellipsis')
    expect(people).toContain('min-width: 0')
    expect(editor).toContain('overflow-wrap: anywhere')
    expect(activity).toContain('overflow-wrap: anywhere')
  })

  it('renders the three states of one workspace, not three pages', () => {
    const page = read(`${USERS_DIR}/UsersPage.tsx`)
    for (const panel of ['PeoplePanel', 'RolesPanel', 'ActivityPanel']) {
      expect(page).toContain(panel)
    }
    const types = read(`${USERS_DIR}/types.ts`)
    expect(types).toContain("'people' | 'roles' | 'activity'")
  })

  it('creates accounts directly — no invitation flow', () => {
    // The approved contract is explicit: an account exists and is active the
    // moment it is created, and no email is sent.
    const sheet = read(`${USERS_DIR}/components/CreateAccountSheet/CreateAccountSheet.tsx`)
    expect(sheet).toContain('Create account')
    expect(sheet).toContain('Account starts active')
    expect(sheet).toContain('Share it securely outside the CMS')
    expect(sheet).toContain('PASSWORD_MIN_LENGTH = 12')
    // Rendered copy only — the docblock explains WHY there is no invitation
    // flow, and banning the word there would forbid documenting the decision.
    const rendered = sheet
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(/invite|invitation|pending invite/i.test(rendered)).toBe(false)
  })

  it('keeps every mutation behind step-up re-auth', () => {
    const people = read(`${USERS_DIR}/panels/PeoplePanel.tsx`)
    const roles = read(`${USERS_DIR}/panels/RolesPanel.tsx`)
    for (const source of [people, roles]) {
      expect(source).toContain('runStepUp')
      // Cancelling step-up must resolve silently, never surface as an error.
      expect(source).toContain('StepUpCancelledMessage')
    }
  })

  it('does not invent role actor attribution the schema cannot provide', () => {
    // `role.createdAt` / `updatedAt` are real; there is no `created_by`
    // column anywhere, so the approved screen's "by <name>" line is omitted.
    const summary = read(`${USERS_DIR}/components/AccessSummary/AccessSummary.tsx`)
    expect(summary).not.toMatch(/\bby \{/)
  })
})
