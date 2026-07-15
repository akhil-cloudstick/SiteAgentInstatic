/**
 * Apply a headless ImportPlan onto the current site → a SiteBundle with
 * merge-overwrite semantics.
 *
 * No-duplicate re-push: a page whose slug already exists reuses that existing
 * page's id (upsert), so pushing the same site again UPDATES rows instead of
 * inserting new ones. New pages get a fresh id. Class names stamped on imported
 * nodes are reconciled to real registry class ids (unknown names auto-create
 * bare classes), and parsed CSS rules merge into the shell's style-rule registry.
 *
 * Scope: pages + style rules (classes/ambient CSS) + reusable conditions (custom
 * @media/@container/@supports queries, so responsive overrides survive publish) +
 * colour tokens + custom @font-face fonts + `--font-*` tokens + page scripts. Media
 * assets are uploaded into the library and the plan URL-rewritten by the handler
 * BEFORE this runs (see `importSiteHtml.ts`), so imported `src`/`url()` values are
 * already final /uploads/ paths here. Google-font self-hosting and cross-page
 * Visual Component dedup are the remaining follow-ups, additive on top of this.
 */
import { nanoid } from 'nanoid'
import { createNode } from '@core/page-tree'
import type { ConditionDef, Page, PageNode, SiteDocument } from '@core/page-tree'
import type { ImportPlan } from '@core/siteImport'
import { rewriteInternalLinks } from '@core/siteImport'
import type { SiteBundle } from '@core/data/bundleSchema'
import type { DataRow, DataTable } from '@core/data/schemas'
import { pageToCells } from '@core/data/pageFromRow'
import { normalizeFrameworkColorSlug } from '@core/framework'
import type { FrameworkColorToken } from '@core/framework-schema'
import {
  makeUniqueFontTokenVariable,
  normalizeFontTokenVariable,
  sanitizeFontFallbackStack,
} from '@core/fonts'
import type { FontEntry, FontFile, FontToken } from '@core/fonts'
import { normalizePath, isSafePath } from '@core/files/pathValidation'
import { DEFAULT_SCRIPT_RUNTIME_CONFIG } from '@core/site-runtime'
import type { SiteFile } from '@core/files/schemas'
import { indexStyleRulesByName, mergeImportedStyleRules, linkImportedClassNames } from './classLinking'

/**
 * Commit imported colour tokens into the shell's framework settings so every
 * `var(--<slug>)` in the imported CSS keeps resolving on publish — the framework
 * re-emits each token as a `--<slug>` root variable (see
 * `src/core/siteImport/colorTokens.ts`). The extraction step strips the palette
 * off the imported `:root` rule, so without this commit those variables resolve
 * to nothing and colours break.
 *
 * Mirrors the browser wizard's `addImportedColorTokens`
 * (`src/admin/pages/site/store/slices/site/helpers.ts`): normalise the slug,
 * skip slugs already present (first-wins, so a re-push keeps existing tokens),
 * and construct a plain base token. Keep the two in sync.
 */
export function commitImportedColorTokens(
  settings: SiteDocument['settings'],
  colors: ImportPlan['colors'],
): void {
  if (colors.length === 0) return
  settings.framework ??= { colors: { tokens: [] } }
  settings.framework.colors ??= { tokens: [] }
  const tokens = settings.framework.colors.tokens
  const existingSlugs = new Set(tokens.map((t) => normalizeFrameworkColorSlug(t.slug)))
  let maxOrder = tokens.reduce((m, t) => Math.max(m, t.order ?? 0), -1)
  for (const { slug: rawSlug, value } of colors) {
    const slug = normalizeFrameworkColorSlug(rawSlug)
    if (existingSlugs.has(slug)) continue
    existingSlugs.add(slug)
    const now = Date.now()
    const token: FrameworkColorToken = {
      id: nanoid(),
      category: '',
      slug,
      lightValue: value,
      darkValue: '',
      darkModeEnabled: false,
      generateUtilities: { text: false, background: false, border: false, fill: false },
      generateTransparent: false,
      generateShades: { enabled: false, count: 0 },
      generateTints: { enabled: false, count: 0 },
      order: (maxOrder += 1),
      createdAt: now,
      updatedAt: now,
    }
    tokens.push(token)
  }
}

/**
 * Commit imported custom @font-face families into `settings.fonts.items`.
 * Mirrors the browser wizard's `addImportedFonts` (importedFonts.ts). Google
 * fonts (which need the network installer) are NOT handled here yet — those
 * self-host via a follow-up; custom @font-face families import directly.
 */
export function commitImportedFonts(
  settings: SiteDocument['settings'],
  fonts: ImportPlan['fonts'],
): void {
  if (fonts.length === 0) return
  settings.fonts ??= { items: [] }
  const lib = settings.fonts
  for (const font of fonts) {
    if (font.files.length === 0) continue
    const id = nanoid()
    const now = Date.now()
    const files: FontFile[] = font.files.map((f) => ({
      variant: f.variant,
      subset: 'latin',
      path: f.src,
      format: f.format,
      ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}),
    }))
    const variants = Array.from(new Set(files.map((f) => f.variant)))
    const entry: FontEntry = {
      id,
      source: 'custom',
      family: font.family,
      variants,
      subsets: ['latin'],
      files,
      createdAt: now,
      updatedAt: now,
    }
    const familyLower = font.family.toLowerCase()
    const idx = lib.items.findIndex((f) => f.family.toLowerCase() === familyLower && f.source === 'custom')
    if (idx >= 0) lib.items[idx] = entry
    else lib.items.push(entry)
  }
}

/**
 * Merge already-installed Google font entries into `settings.fonts.items` so the
 * published `@font-face` self-hosts them from `/uploads/fonts/…` (typography
 * matches the source design). Mirrors the browser wizard's `addInstalledFontEntries`
 * (importedFonts.ts): dedupe by id, then by (family, source); re-point any font
 * token bound to a replaced family id. Call BEFORE `commitImportedFontTokens` so
 * a `--font-*` token can bind to the newly-committed family. Keep in sync.
 */
export function commitInstalledFonts(
  settings: SiteDocument['settings'],
  entries: FontEntry[],
): void {
  if (entries.length === 0) return
  settings.fonts ??= { items: [] }
  const lib = settings.fonts
  for (const entry of entries) {
    const familyLower = entry.family.toLowerCase()
    const sameIdIndex = lib.items.findIndex((f) => f.id === entry.id)
    const sameFamilyIndex = lib.items.findIndex(
      (f) => f.family.toLowerCase() === familyLower && f.source === entry.source,
    )
    const idx = sameIdIndex >= 0 ? sameIdIndex : sameFamilyIndex
    const previousId = idx >= 0 ? lib.items[idx]!.id : null
    if (idx >= 0) lib.items[idx] = entry
    else lib.items.push(entry)
    if (previousId && previousId !== entry.id) {
      for (const token of lib.tokens ?? []) {
        if (token.familyId === previousId) token.familyId = entry.id
      }
    }
  }
}

/**
 * Commit imported `--font-*` root variables into `settings.fonts.tokens` so
 * every `var(--font-…)` in the imported CSS keeps resolving on publish. Mirrors
 * the browser wizard's `addImportedFontTokens` (importedFonts.ts). Binds a
 * `familyId` when a matching imported family exists; otherwise the token
 * resolves to its fallback stack. Keep in sync.
 */
export function commitImportedFontTokens(
  settings: SiteDocument['settings'],
  tokens: ImportPlan['fontTokens'],
): void {
  if (tokens.length === 0) return
  settings.fonts ??= { items: [] }
  settings.fonts.tokens ??= []
  const lib = settings.fonts
  const fontTokens = lib.tokens ?? (lib.tokens = [])
  let maxOrder = fontTokens.reduce((m, t) => Math.max(m, t.order ?? 0), -1)
  const familyIdByName = new Map<string, string>()
  for (const entry of lib.items) familyIdByName.set(entry.family.toLowerCase(), entry.id)
  for (const input of tokens) {
    const variable = makeUniqueFontTokenVariable(normalizeFontTokenVariable(input.variable), fontTokens)
    const familyId = input.family ? familyIdByName.get(input.family.toLowerCase()) : undefined
    const now = Date.now()
    const token: FontToken = {
      id: nanoid(),
      name: input.name.trim() || variable.replace(/^font-/, ''),
      variable,
      ...(familyId ? { familyId } : {}),
      fallback: sanitizeFontFallbackStack(input.fallback),
      order: (maxOrder += 1),
      createdAt: now,
      updatedAt: now,
    }
    fontTokens.push(token)
  }
}

/**
 * Merge imported reusable conditions (custom `@media` / `@container` / `@supports`
 * queries that DON'T line up with a configured site breakpoint) into
 * `settings.conditions`, deduped by id. Imported style rules reference these via
 * their `contextStyles` keys, so they MUST be committed or the publisher's CSS
 * emitter silently drops every override under an unregistered condition
 * (`classCss.ts` skips unknown context keys) — i.e. responsive layout vanishes.
 *
 * Mirrors the browser wizard's `tx.addConditions` (helpers.ts). Committed BEFORE
 * style rules so every `contextStyles` key resolves.
 */
export function commitImportedConditions(
  shell: { conditions?: ConditionDef[] },
  conditions: ConditionDef[] | undefined,
): void {
  if (!conditions || conditions.length === 0) return
  shell.conditions ??= []
  const existing = new Set(shell.conditions.map((c) => c.id))
  for (const def of conditions) {
    if (existing.has(def.id)) continue
    existing.add(def.id)
    shell.conditions.push(def)
  }
}

/** Append `-2`, `-3`, … before the extension until the path is unused. */
function uniqueFilePath(path: string, used: Set<string>): string {
  if (!used.has(path)) return path
  const slash = path.lastIndexOf('/')
  const dot = path.lastIndexOf('.')
  const hasExt = dot > slash
  const stem = hasExt ? path.slice(0, dot) : path
  const ext = hasExt ? path.slice(dot) : ''
  let n = 2
  while (used.has(`${stem}-${n}${ext}`)) n += 1
  return `${stem}-${n}${ext}`
}

/** Normalise a source path into a safe SiteFile path, falling back to src/scripts/. */
function safeScriptPath(rawPath: string): string {
  const normalized = normalizePath(rawPath)
  if (isSafePath(normalized)) return normalized
  const base = (rawPath.split('/').pop() ?? 'script.js').replace(/[^a-zA-Z0-9._-]+/g, '-')
  return `src/scripts/${base || 'script.js'}`
}

/**
 * Commit imported page scripts as SiteFiles + page-scoped runtime entries so
 * interactive behaviour (menu toggles, nav active-state, counters, …) survives
 * import. `scripts` must already carry resolved `pageIds` (empty → all-pages).
 *
 * Mirrors the browser wizard's `addImportedScripts`
 * (`src/admin/pages/site/store/slices/site/importedSiteFiles.ts`); the server
 * has no live canvas mirror, so only `site.runtime` is written. Keep in sync.
 */
export function commitImportedScripts(
  shell: Pick<SiteDocument, 'files' | 'runtime'>,
  scripts: Array<ImportPlan['scripts'][number] & { pageIds: string[] }>,
): void {
  if (scripts.length === 0) return
  shell.runtime.scripts ??= {}
  const usedPaths = new Set(shell.files.map((f) => f.path))
  for (const script of scripts) {
    const path = uniqueFilePath(safeScriptPath(script.path), usedPaths)
    usedPaths.add(path)
    const id = nanoid()
    const now = Date.now()
    const file: SiteFile = { id, path, type: 'script', content: script.content, createdAt: now, updatedAt: now }
    shell.files.push(file)
    const pageIds = script.pageIds.filter((p): p is string => typeof p === 'string' && p.length > 0)
    shell.runtime.scripts[id] = {
      ...DEFAULT_SCRIPT_RUNTIME_CONFIG,
      format: script.format,
      priority: script.priority,
      scope: pageIds.length > 0 ? { type: 'pages', pageIds } : DEFAULT_SCRIPT_RUNTIME_CONFIG.scope,
    }
  }
}

function newRow(id: string, slug: string, cells: DataRow['cells'], nowIso: string): DataRow {
  return {
    id,
    tableId: 'pages',
    cells,
    slug,
    status: 'draft',
    authorUserId: null,
    createdByUserId: null,
    updatedByUserId: null,
    publishedByUserId: null,
    author: null,
    createdBy: null,
    updatedBy: null,
    publishedBy: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    publishedAt: null,
    scheduledPublishAt: null,
    deletedAt: null,
  }
}

export function applyPlanToBundle(
  plan: ImportPlan,
  currentSite: SiteDocument,
  pagesTable: DataTable,
  installedGoogleFonts: FontEntry[] = [],
): SiteBundle {
  // Clone the shell (drop the SiteDocument-only collections) so the source stays
  // untouched until the atomic import commits.
  const { pages: _p, visualComponents: _vc, layouts: _l, ...shell } = structuredClone(currentSite)
  void _p; void _vc; void _l

  // Commit reusable conditions FIRST so every style-rule `contextStyles` key
  // (custom @media/@container/@supports) resolves on publish — otherwise the
  // publisher drops those overrides and the page loses its responsive layout.
  commitImportedConditions(shell, plan.conditions)

  const byName = indexStyleRulesByName(shell.styleRules)
  // Register parsed CSS class/ambient rules FIRST, then resolve node class tokens.
  mergeImportedStyleRules(plan.styleRules, shell.styleRules, byName)

  // Commit colour tokens into the shell's framework so imported `var(--x)`
  // references keep resolving on publish. The bundle importer persists the whole
  // shell (settings.framework included) via saveDraftSite, so writing them here
  // is enough — no separate token API call needed.
  commitImportedColorTokens(shell.settings, plan.colors)

  // Commit fonts: custom @font-face families + self-hosted Google fonts first (so
  // a font token can bind its familyId), then the `--font-*` root variables so
  // `var(--font-…)` resolves.
  commitImportedFonts(shell.settings, plan.fonts)
  commitInstalledFonts(shell.settings, installedGoogleFonts)
  commitImportedFontTokens(shell.settings, plan.fontTokens)

  // slug conflict → reuse the existing page id (upsert, no duplicate on re-push).
  const existingIdBySource = new Map<string, string>()
  for (const c of plan.conflicts.pages) existingIdBySource.set(c.source, c.existingPageId)

  // Pre-mint every page id BEFORE processing so intra-site `<a href="about.html">`
  // links can be rewritten to `cms:page:<id>` references (survive slug renames).
  const pageIdBySource = new Map<string, string>()
  for (const pagePlan of plan.pages) {
    pageIdBySource.set(pagePlan.source, existingIdBySource.get(pagePlan.source) ?? nanoid())
  }
  const linkedPages = rewriteInternalLinks(plan.pages, pageIdBySource)

  const nowIso = new Date().toISOString()
  const rows: DataRow[] = []
  for (const pagePlan of linkedPages) {
    const fragment = pagePlan.nodeFragment
    for (const node of Object.values(fragment.nodes)) {
      if (node.classIds?.length) node.classIds = linkImportedClassNames(node.classIds, shell.styleRules, byName)
    }
    // Wrap the imported top-level nodes under a single base.body root.
    const body = createNode('base.body')
    body.children = [...fragment.rootIds]
    if (fragment.body?.classIds?.length) {
      body.classIds = linkImportedClassNames(fragment.body.classIds, shell.styleRules, byName)
    }
    const nodes: Record<string, PageNode> = { ...fragment.nodes, [body.id]: body }
    const id = pageIdBySource.get(pagePlan.source)!
    const page: Page = { id, title: pagePlan.title, slug: pagePlan.slug, nodes, rootNodeId: body.id }
    rows.push(newRow(id, pagePlan.slug, pageToCells(page), nowIso))
  }

  // Commit page scripts (menu toggles, nav active-state, …) as SiteFiles +
  // runtime entries scoped to the pages that linked them. Resolve each script's
  // source page paths to the committed page ids first (empty → all-pages).
  const scriptsWithScope = plan.scripts.map((s) => ({
    ...s,
    pageIds: s.pageSources.map((src) => pageIdBySource.get(src)).filter((x): x is string => !!x),
  }))
  commitImportedScripts(shell, scriptsWithScope)

  return {
    schemaVersion: 1,
    exportedAt: nowIso,
    sourceSiteName: shell.name,
    site: shell,
    tables: [pagesTable],
    rows,
  }
}
