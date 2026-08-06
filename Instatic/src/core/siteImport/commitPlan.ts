/**
 * commitImportPlan — the commit half of the Super Import pipeline.
 *
 * Applies a (conflict-resolved) `ImportPlan` to the site via the adapter:
 *
 *   Step A: Upload assets via `adapter.uploadAsset`. Collect `sourcePath → newUrl`.
 *   Step B: Rewrite the plan with `applyAssetRewrites`; install Google fonts.
 *   Step C: ONE `adapter.commit` call that adds all pages + style rules.
 *
 * Atomicity:
 *   Asset uploads (Step A) are additive — if the process aborts mid-upload,
 *   the already-uploaded assets remain in the media library. They are harmless
 *   (unused orphans) and will be reaped by a future background sweep. Per-asset
 *   failures are recorded as warnings and the rest continue — one bad file
 *   never aborts the import. The store mutation (Step C) is a single
 *   `adapter.commit` call that the admin side executes as one history
 *   snapshot — Cmd+Z reverts the entire import in one step.
 *
 * Each commit concern (tokens, fonts, rules, pages, page-scoped files) is a
 * named function below; the transaction recipe is straight-line calls.
 */

import { nanoid } from 'nanoid'
import type { FontEntry } from '@core/fonts'
import type { PageNode } from '@core/page-tree'
import type { ImportFragment } from '@core/htmlImport'
import { applyAssetRewrites } from './applyAssetRewrites'
import { rewriteInternalLinks, rewriteFragmentInternalLinks } from './linkRewrite'
import type {
  GlobalSectionCandidate,
  SharedBlockCandidate,
  ImportColorToken,
  ImportFontToken,
  ImportPlan,
  ImportResult,
  ImportWarning,
  PageConflict,
  RuleConflict,
  TokenConflict,
} from './types'
import type { SiteImportAdapter, SiteImportTransaction } from './adapter'

// ---------------------------------------------------------------------------
// Runtime active-state script
// ---------------------------------------------------------------------------
// Injected as a page-scoped script on every page that references a shared nav
// component that had baked-in active-state classes stripped during import.
// Reads window.location.pathname at runtime and toggles the common active-state
// class names + aria-current on the correct nav link, regardless of which
// class name the original designer used.

const NAV_ACTIVE_STATE_SCRIPT = `(function(){
  var p=location.pathname.replace(/\\/$/,'')||'/';
  var AC=['active','nav-link-active','is-active','current','current-page','selected'];
  document.querySelectorAll('nav a[href],header a[href]').forEach(function(a){
    var h=a.getAttribute('href').replace(/\\/$/,'')||'/';
    var on=h===p;
    AC.forEach(function(c){a.classList.toggle(c,on);});
    if(on)a.setAttribute('aria-current','page');
    else a.removeAttribute('aria-current');
  });
})();`

export async function commitImportPlan(
  plan: ImportPlan,
  adapter: SiteImportAdapter,
): Promise<ImportResult> {
  // ── Step A: upload all assets ─────────────────────────────────────────────
  const { rewriteMap, warnings: uploadWarnings } = await uploadPlanAssets(plan, adapter)

  // ── Step B: rewrite plan URLs + install Google fonts ──────────────────────
  const rewrittenPlan = applyAssetRewrites(plan, rewriteMap)
  const { installedGoogleFonts, warnings: fontInstallWarnings } =
    await installPlanGoogleFonts(rewrittenPlan, adapter)

  // ── Step C: commit pages + style rules (single atomic transaction) ────────
  // Conflict resolution lookup maps (source → resolution).
  const pageConflictsBySource = new Map<string, PageConflict>(
    rewrittenPlan.conflicts.pages.map((c) => [c.source, c]),
  )
  const ruleConflictsByName = new Map<string, RuleConflict>(
    rewrittenPlan.conflicts.rules.map((c) => [c.desiredName, c]),
  )
  // Token conflicts keyed by `${kind}:${variable}`. Only `overwrite` is handled
  // here — `skip` and rename were already applied to plan.colors/fontTokens by
  // applyConflictResolutions (skip drops the token; rename gives it a unique
  // name and rewrites its `var(--x)` references).
  const tokenConflictByKey = new Map<string, TokenConflict>(
    rewrittenPlan.conflicts.tokens.map((c) => [`${c.kind}:${c.desiredVariable}`, c]),
  )

  const pageIdBySource = mintPageIds(rewrittenPlan, pageConflictsBySource)
  const linkedPages = rewriteInternalLinks(rewrittenPlan.pages, pageIdBySource)

  const results: CommitResults = {
    pages: [],
    styleRules: [],
    fonts: [],
    colors: [],
    fontTokens: [],
    scripts: [],
    stylesheets: [],
  }

  // Global sections: build a lookup of page-source → vcRef nodeFragment
  // mutation closures BEFORE the atomic commit so the affected linkedPages
  // are mutated in-place before commitPages writes them.
  const globalSections = rewrittenPlan.globalSections ?? []
  const activeScriptPageSources = new Set<string>()

  await adapter.commit((tx) => {
    // Merge reusable conditions first so rule contextStyles keys resolve.
    if ((rewrittenPlan.conditions ?? []).length > 0) {
      tx.addConditions(rewrittenPlan.conditions)
    }
    // Colour tokens before style rules so any framework `--<slug>` they emit
    // is available to everything that follows.
    commitColorTokens(tx, rewrittenPlan, tokenConflictByKey, results)
    commitFonts(tx, rewrittenPlan, installedGoogleFonts, results)
    // Font tokens after fonts so tokens can bind to a matching imported
    // family id when the source stack names one.
    commitFontTokens(tx, rewrittenPlan, tokenConflictByKey, results)
    // Style rules before pages so pages that auto-create class links can
    // reference newly-imported rules.
    commitStyleRules(tx, rewrittenPlan, ruleConflictsByName, results)
    // Global sections: promote shared nav/header/footer into ONE everywhere
    // layout template and strip them from each page BEFORE commitPages, so
    // every page commits only its body content and inherits the shared chrome
    // through the template's outlet (new CMS pages inherit it too).
    commitGlobalSections(tx, globalSections, linkedPages, activeScriptPageSources, pageIdBySource)
    // Author-marked shared blocks: one Visual Component each, referenced IN PLACE
    // so the block stays where the designer put it. Also before commitPages, so
    // pages commit with the reference already spliced in.
    commitSharedBlocks(tx, rewrittenPlan.sharedBlocks ?? [], linkedPages, pageIdBySource)
    commitPages(tx, linkedPages, pageConflictsBySource, pageIdBySource, results)
    commitPageScopedFiles(tx, rewrittenPlan, pageIdBySource, results)
    // Active-state script: injected once per page that had a shared nav with
    // a baked-in active class (detected during global section deduplication).
    if (activeScriptPageSources.size > 0) {
      commitNavActiveScript(tx, activeScriptPageSources, pageIdBySource, results)
    }
  })

  // Build asset result — only include the ones that actually uploaded.
  // The user-facing "K assets imported" count needs to match reality; if
  // we listed failed uploads here they'd inflate the count and confuse the
  // Done step.
  const resultAssets: ImportResult['assets'] = plan.assets
    .filter((a) => rewriteMap[a.sourcePath] !== undefined)
    .map((a) => ({
      sourcePath: a.sourcePath,
      mediaUrl: rewriteMap[a.sourcePath]!,
    }))

  return {
    ...results,
    assets: resultAssets,
    conflicts: plan.conflicts,
    // Carry forward the plan-level warnings (CSS parser / asset planner /
    // missing stylesheet …) AND surface any per-asset upload failures from
    // Step A above. The wizard's Done step renders this list verbatim.
    warnings: [...plan.warnings, ...uploadWarnings, ...fontInstallWarnings],
  }
}

type CommitResults = Pick<
  ImportResult,
  'pages' | 'styleRules' | 'fonts' | 'colors' | 'fontTokens' | 'scripts' | 'stylesheets'
>

// ---------------------------------------------------------------------------
// Step A — asset uploads
// ---------------------------------------------------------------------------

/**
 * Upload sequentially to avoid saturating the server — sequential uploads
 * also give clearer progress. A single rejected file (unsupported MIME,
 * oversized payload, network blip) is recorded as an `asset-upload-failed`
 * warning and the rest continue; pages and rules that referenced a failed
 * asset keep their original FileMap reference, so the publisher emits the
 * unrewritten path and the user can re-upload manually.
 */
async function uploadPlanAssets(
  plan: ImportPlan,
  adapter: SiteImportAdapter,
): Promise<{ rewriteMap: Record<string, string>; warnings: ImportWarning[] }> {
  const rewriteMap: Record<string, string> = {}
  const warnings: ImportWarning[] = []
  for (const asset of plan.assets) {
    try {
      const newUrl = await adapter.uploadAsset({
        path: asset.sourcePath,
        bytes: asset.bytes,
        mimeType: asset.mimeType,
      })
      rewriteMap[asset.sourcePath] = newUrl
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown upload error'
      warnings.push({
        kind: 'asset-upload-failed',
        message: `Failed to upload ${asset.sourcePath} (${asset.mimeType}): ${reason}`,
        path: asset.sourcePath,
      })
    }
  }
  return { rewriteMap, warnings }
}

async function installPlanGoogleFonts(
  plan: ImportPlan,
  adapter: SiteImportAdapter,
): Promise<{ installedGoogleFonts: FontEntry[]; warnings: ImportWarning[] }> {
  const installedGoogleFonts: FontEntry[] = []
  const warnings: ImportWarning[] = []
  for (const font of plan.googleFonts) {
    try {
      installedGoogleFonts.push(await adapter.installGoogleFont(font))
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown font install error'
      warnings.push({
        kind: 'font-install-failed',
        message: `Failed to install Google font ${font.family}: ${reason}`,
        path: font.family,
      })
    }
  }
  return { installedGoogleFonts, warnings }
}

// ---------------------------------------------------------------------------
// Step C — commit helpers (each owns one entity kind)
// ---------------------------------------------------------------------------

/**
 * Pre-mint a stable page id for every page we're about to commit, keyed by
 * its source FileMap path. Overwritten pages reuse the existing id; added
 * pages get a fresh one. This lets `rewriteInternalLinks` turn intra-site
 * `<a href="club.html">` links into `cms:page:<id>` references BEFORE the
 * pages are committed, so they survive future slug renames. The same id is
 * then passed to `tx.addPage` so the ref resolves to the real page.
 */
function mintPageIds(
  plan: ImportPlan,
  pageConflictsBySource: Map<string, PageConflict>,
): Map<string, string> {
  const pageIdBySource = new Map<string, string>()
  for (const page of plan.pages) {
    const conflict = pageConflictsBySource.get(page.source)
    const resolution = conflict?.defaultResolution
    if (resolution?.action === 'skip') continue
    // Only reuse the existing id when there is a real page to overwrite.
    // Intra-batch slug collisions carry an empty `existingPageId` (no existing
    // page yet) — "overwrite" there has no target, so we add a fresh page.
    const id =
      resolution?.action === 'overwrite' && conflict?.existingPageId
        ? conflict.existingPageId
        : nanoid()
    pageIdBySource.set(page.source, id)
  }
  return pageIdBySource
}

/**
 * Partition by conflict resolution — `overwrite` replaces the existing
 * token's value by id; the rest are added (renamed tokens already carry
 * their unique slug).
 */
function commitColorTokens(
  tx: SiteImportTransaction,
  plan: ImportPlan,
  tokenConflictByKey: Map<string, TokenConflict>,
  results: CommitResults,
): void {
  if ((plan.colors ?? []).length === 0) return
  const adds: ImportColorToken[] = []
  const overwrites: { existingTokenId: string; value: string }[] = []
  for (const token of plan.colors) {
    const conflict = tokenConflictByKey.get(`color:${token.slug}`)
    if (conflict?.defaultResolution.action === 'overwrite') {
      overwrites.push({ existingTokenId: conflict.existingTokenId, value: token.value })
    } else {
      adds.push(token)
    }
  }
  if (adds.length > 0) results.colors.push(...tx.addColorTokens(adds))
  if (overwrites.length > 0) results.colors.push(...tx.overwriteColorTokens(overwrites))
}

function commitFontTokens(
  tx: SiteImportTransaction,
  plan: ImportPlan,
  tokenConflictByKey: Map<string, TokenConflict>,
  results: CommitResults,
): void {
  if ((plan.fontTokens ?? []).length === 0) return
  const adds: ImportFontToken[] = []
  const overwrites: { existingTokenId: string; token: ImportFontToken }[] = []
  for (const token of plan.fontTokens) {
    const conflict = tokenConflictByKey.get(`font:${token.variable}`)
    if (conflict?.defaultResolution.action === 'overwrite') {
      overwrites.push({ existingTokenId: conflict.existingTokenId, token })
    } else {
      adds.push(token)
    }
  }
  if (adds.length > 0) results.fontTokens.push(...tx.addFontTokens(adds))
  if (overwrites.length > 0) results.fontTokens.push(...tx.overwriteFontTokens(overwrites))
}

/**
 * Custom fonts: only commit files whose src actually became a media URL
 * (a failed upload leaves a FileMap key). A family with no usable files is
 * dropped rather than producing a broken @font-face.
 */
function commitFonts(
  tx: SiteImportTransaction,
  plan: ImportPlan,
  installedGoogleFonts: FontEntry[],
  results: CommitResults,
): void {
  const commitableFonts = plan.fonts
    .map((font) => ({
      ...font,
      files: font.files.filter((f) => isMediaUrl(f.src)),
    }))
    .filter((font) => font.files.length > 0)
  if (commitableFonts.length > 0) {
    results.fonts.push(...tx.addFonts(commitableFonts))
  }
  if (installedGoogleFonts.length > 0) {
    results.fonts.push(...tx.addInstalledFonts(installedGoogleFonts))
  }
}

function commitStyleRules(
  tx: SiteImportTransaction,
  plan: ImportPlan,
  ruleConflictsByName: Map<string, RuleConflict>,
  results: CommitResults,
): void {
  for (const rule of plan.styleRules) {
    const conflict = rule.kind === 'class'
      ? ruleConflictsByName.get(rule.name)
      : undefined
    const resolution = conflict?.defaultResolution

    if (resolution?.action === 'skip') continue

    let id: string
    if (resolution?.action === 'overwrite' && conflict?.existingRuleId) {
      tx.overwriteStyleRule(conflict.existingRuleId, rule)
      id = conflict.existingRuleId
    } else {
      id = tx.addStyleRule(rule)
    }

    results.styleRules.push({ id, selector: rule.selector, kind: rule.kind })
  }
}

function commitPages(
  tx: SiteImportTransaction,
  linkedPages: ImportPlan['pages'],
  pageConflictsBySource: Map<string, PageConflict>,
  pageIdBySource: Map<string, string>,
  results: CommitResults,
): void {
  for (const page of linkedPages) {
    const conflict = pageConflictsBySource.get(page.source)
    const resolution = conflict?.defaultResolution

    if (resolution?.action === 'skip') continue

    // The pre-minted id this page's links were rewritten against.
    const mintedId = pageIdBySource.get(page.source)

    let id: string
    if (resolution?.action === 'overwrite' && conflict?.existingPageId) {
      tx.overwritePage(conflict.existingPageId, {
        title: page.title,
        slug: page.slug,
        nodeFragment: page.nodeFragment,
      })
      id = conflict.existingPageId
    } else {
      id = tx.addPage({
        id: mintedId,
        title: page.title,
        slug: resolution?.resolvedSlug ?? page.slug,
        nodeFragment: page.nodeFragment,
      })
    }

    results.pages.push({ id, title: page.title, slug: page.slug, source: page.source })
  }
}

function commitPageScopedFiles(
  tx: SiteImportTransaction,
  plan: ImportPlan,
  pageIdBySource: Map<string, string>,
  results: CommitResults,
): void {
  const scopedScripts = resolvePageScopes(plan.scripts ?? [], pageIdBySource)
  if (scopedScripts.length > 0) {
    results.scripts.push(...tx.addScripts(scopedScripts))
  }
  const scopedStylesheets = resolvePageScopes(plan.stylesheets ?? [], pageIdBySource)
  if (scopedStylesheets.length > 0) {
    results.stylesheets.push(...tx.addStylesheets(scopedStylesheets))
  }
}

/**
 * Resolve an item's `pageSources` (HTML FileMap paths) into committed page
 * ids. Items whose every source page was skipped are dropped — a page-scoped
 * asset with no surviving page has nowhere to apply.
 */
function resolvePageScopes<T extends { pageSources: string[]; pageIds?: string[] }>(
  items: T[],
  pageIdBySource: Map<string, string>,
): T[] {
  return items.flatMap((item) => {
    if (item.pageSources.length === 0) return [item]
    const seen = new Set<string>()
    const pageIds: string[] = []
    for (const source of item.pageSources) {
      const pageId = pageIdBySource.get(source)
      if (!pageId || seen.has(pageId)) continue
      seen.add(pageId)
      pageIds.push(pageId)
    }
    if (pageIds.length === 0) return []
    return [{ ...item, pageIds }]
  })
}

/**
 * A font file `src` that was successfully rewritten to a media URL — either a
 * self-hosted `/uploads/` path or an absolute `https://` URL. A leftover FileMap
 * key (e.g. `fonts/Inter.woff2`) is neither, so the file is dropped.
 */
function isMediaUrl(src: string): boolean {
  return src.startsWith('/uploads/') || src.startsWith('https://')
}

// ---------------------------------------------------------------------------
// Global section commit helpers
// ---------------------------------------------------------------------------

/**
 * Promote cross-page global sections into ONE shared `everywhere` layout:
 *  1. Create a VisualComponent from each candidate's normalised representative
 *     fragment (edit-once-updates-all).
 *  2. Build a single `everywhere` page-template whose base.body holds the
 *     shared chrome around one `base.outlet` — header/nav above the outlet,
 *     footer below — and upsert it (re-share overwrites it in place).
 *  3. STRIP each shared section from the individual pages, leaving only their
 *     body content; the template supplies the chrome via the outlet, so a page
 *     the tenant adds later in the CMS inherits the same header/footer.
 *
 * Page mutations happen in-place on `linkedPages` BEFORE `commitPages` writes
 * them. Collects the page sources that need the runtime active-state script
 * into `activeScriptPageSources` — with a shared nav in the everywhere layout,
 * that is every rendered page.
 */
function commitGlobalSections(
  tx: SiteImportTransaction,
  globalSections: GlobalSectionCandidate[],
  linkedPages: ImportPlan['pages'],
  activeScriptPageSources: Set<string>,
  pageIdBySource: ReadonlyMap<string, string>,
): void {
  if (globalSections.length === 0) return

  const SECTION_NAMES: Record<string, string> = {
    nav: 'Shared Nav',
    header: 'Shared Header',
    footer: 'Shared Footer',
  }

  // 1. Promote each section to a VisualComponent. Rewrite its internal links to
  //    durable cms:page refs first (relative to the page it came from) so the
  //    shared nav/footer resolve to CMS routes (/shop) instead of shipping raw
  //    `shop.html` hrefs that 404 on the published site.
  const vcIdBySection = new Map<GlobalSectionCandidate, string>()
  for (const section of globalSections) {
    const name = SECTION_NAMES[section.tag] ?? `Shared ${section.tag}`
    const source = section.pageSources[0]
    const nodeFragment = source
      ? rewriteFragmentInternalLinks(section.representativeFragment, source, pageIdBySource)
      : section.representativeFragment
    vcIdBySection.set(section, tx.createVisualComponent({ name, nodeFragment }))
  }

  // 2. Build + upsert the single everywhere layout.
  tx.upsertEverywhereTemplate({
    title: 'Site Layout',
    slug: 'site-layout',
    nodeFragment: buildEverywhereTemplateFragment(globalSections, vcIdBySection, linkedPages),
  })

  // 3. Strip the shared sections from every page (their chrome now lives in the
  //    layout). A shared nav with baked active state means every rendered page
  //    needs the runtime active-state script.
  const pageBySource = new Map<string, ImportPlan['pages'][number]>()
  for (const page of linkedPages) pageBySource.set(page.source, page)
  for (const section of globalSections) {
    for (const pageSource of section.pageSources) {
      const page = pageBySource.get(pageSource)
      if (!page) continue
      const sectionRootId = section.rootIdByPageSource[pageSource]
      if (!sectionRootId) continue
      stripSection(page.nodeFragment, sectionRootId)
    }
  }
  if (globalSections.some((s) => s.hasActiveLinks)) {
    for (const page of linkedPages) activeScriptPageSources.add(page.source)
  }
}

/**
 * Assemble the everywhere layout's node fragment: a shared-chrome VC ref per
 * detected section arranged around a single `base.outlet`. Sections are ordered
 * by their position in a canonical page (the page carrying the most shared
 * sections) so headers/navs land above the outlet and footers below it.
 */
function buildEverywhereTemplateFragment(
  globalSections: GlobalSectionCandidate[],
  vcIdBySection: Map<GlobalSectionCandidate, string>,
  linkedPages: ImportPlan['pages'],
): ImportFragment {
  // Canonical page = the source appearing in the most sections' pageSources.
  const sourceScore = new Map<string, number>()
  for (const section of globalSections)
    for (const src of section.pageSources)
      sourceScore.set(src, (sourceScore.get(src) ?? 0) + 1)
  let canonicalSource: string | undefined
  let best = -1
  for (const page of linkedPages) {
    const score = sourceScore.get(page.source) ?? 0
    if (score > best) {
      best = score
      canonicalSource = page.source
    }
  }
  const canonicalPage = linkedPages.find((p) => p.source === canonicalSource)

  const positionInCanonical = (section: GlobalSectionCandidate): number => {
    if (!canonicalPage || canonicalSource === undefined) return Number.MAX_SAFE_INTEGER
    const rootId = section.rootIdByPageSource[canonicalSource]
    if (!rootId) return Number.MAX_SAFE_INTEGER
    const idx = canonicalPage.nodeFragment.rootIds.indexOf(rootId)
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx
  }

  const withPos = globalSections.map((section) => ({ section, pos: positionInCanonical(section) }))
  const top = withPos.filter((e) => e.section.tag !== 'footer').sort((a, b) => a.pos - b.pos)
  const bottom = withPos.filter((e) => e.section.tag === 'footer').sort((a, b) => a.pos - b.pos)

  const nodes: Record<string, PageNode> = {}
  const rootIds: string[] = []
  const pushRef = (section: GlobalSectionCandidate): void => {
    const vcId = vcIdBySection.get(section)
    if (!vcId) return
    const refId = nanoid()
    nodes[refId] = {
      id: refId,
      moduleId: 'base.visual-component-ref',
      props: { componentId: vcId },
      children: [],
      classIds: [],
      parentId: null,
      breakpointOverrides: {},
    } as unknown as PageNode
    rootIds.push(refId)
  }

  for (const e of top) pushRef(e.section)
  const outletId = nanoid()
  nodes[outletId] = {
    id: outletId,
    moduleId: 'base.outlet',
    props: {},
    children: [],
    classIds: [],
    parentId: null,
    breakpointOverrides: {},
  } as unknown as PageNode
  rootIds.push(outletId)
  for (const e of bottom) pushRef(e.section)

  return { nodes, rootIds }
}

/**
 * Remove a shared section (root + subtree) from a page's node fragment in
 * place. `rewriteInternalLinks` already produced a detached copy, so this is
 * safe to mutate.
 */
/**
 * Promote every author-marked `data-shared` group to ONE Visual Component and
 * point each occurrence at it.
 *
 * Deliberately different from `commitGlobalSections`: shared chrome is hoisted
 * into the everywhere layout (so new CMS pages inherit it), but an ordinary
 * shared block must stay where the designer put it. Replacing the node in place
 * keeps it visible at the right position in the canvas, and because every
 * occurrence references the same component, editing it once updates every page.
 */
function commitSharedBlocks(
  tx: SiteImportTransaction,
  sharedBlocks: SharedBlockCandidate[],
  linkedPages: ImportPlan['pages'],
  pageIdBySource: ReadonlyMap<string, string>,
): void {
  if (sharedBlocks.length === 0) return

  const pageBySource = new Map<string, ImportPlan['pages'][number]>()
  for (const page of linkedPages) pageBySource.set(page.source, page)

  for (const block of sharedBlocks) {
    // Rewrite internal links relative to the page the component was lifted from,
    // so a shared block's links resolve to CMS routes on every page it appears on.
    const source = block.occurrences[0]?.pageSource
    const nodeFragment = source
      ? rewriteFragmentInternalLinks(block.representativeFragment, source, pageIdBySource)
      : block.representativeFragment

    const vcId = tx.createVisualComponent({ name: humanizeSharedName(block.name), nodeFragment })

    for (const { pageSource, nodeId } of block.occurrences) {
      const page = pageBySource.get(pageSource)
      if (page) replaceWithComponentRef(page.nodeFragment, nodeId, vcId)
    }
  }
}

/** `contact-strip` → `Contact Strip`, so the components list reads like a name. */
function humanizeSharedName(raw: string): string {
  const words = raw
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return 'Shared Block'
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').slice(0, 40)
}

/**
 * Turn a node into a reference to `vcId`, dropping the subtree it used to own.
 * The node KEEPS its id, so the parent's `children` array and the fragment's
 * `rootIds` stay valid without having to find and patch the parent.
 */
function replaceWithComponentRef(fragment: ImportFragment, nodeId: string, vcId: string): void {
  const node = fragment.nodes[nodeId]
  if (!node) return
  for (const childId of node.children ?? []) removeSubtree(fragment.nodes, childId)
  fragment.nodes[nodeId] = {
    ...node,
    moduleId: 'base.visual-component-ref',
    props: { componentId: vcId },
    children: [],
    // The block's own classes live on the component's root node, so leaving them
    // here too would apply them twice.
    classIds: [],
  } as unknown as PageNode
}

function stripSection(nodeFragment: ImportFragment, sectionRootId: string): void {
  const idx = nodeFragment.rootIds.indexOf(sectionRootId)
  if (idx !== -1) nodeFragment.rootIds.splice(idx, 1)
  removeSubtree(nodeFragment.nodes, sectionRootId)
}

function removeSubtree(nodes: Record<string, PageNode>, rootId: string): void {
  const node = nodes[rootId]
  if (!node) return
  for (const childId of node.children ?? []) removeSubtree(nodes, childId)
  delete nodes[rootId]
}

/**
 * Inject a tiny runtime script on every page that had a shared nav with
 * baked-in active-state classes. The script reads `location.pathname` and
 * toggles the correct class + `aria-current` attribute at page load.
 */
function commitNavActiveScript(
  tx: SiteImportTransaction,
  activeScriptPageSources: Set<string>,
  pageIdBySource: Map<string, string>,
  results: CommitResults,
): void {
  const scriptPath = '_instatic/nav-active-state.js'
  const committed = tx.addScripts([
    {
      path: scriptPath,
      content: NAV_ACTIVE_STATE_SCRIPT,
      format: 'classic',
      pageSources: [...activeScriptPageSources],
      pageIds: [...activeScriptPageSources]
        .map((s) => pageIdBySource.get(s))
        .filter((id): id is string => id !== undefined),
      priority: 50,
    },
  ])
  results.scripts.push(...committed)
}
