/**
 * buildImportPlan — the analysis half of the Super Import pipeline.
 *
 * PURE and synchronous. Classifies files, parses HTML and CSS, collects
 * assets, normalises URLs, detects conflicts. Returns an `ImportPlan` ready
 * for preview in the import wizard or direct commit via `commitImportPlan`
 * (`commitPlan.ts`).
 *
 * The orchestrator is straight-line phase calls; each phase is a named
 * function below. Adding a new analysis concern means adding one phase, not
 * threading more state through a 250-line body.
 */

import {
  classKindSelector,
  extractCssSelectorClasses,
  type SiteDocument,
} from '@core/page-tree'
import { compareVariants } from '@core/fonts'
import { expandLinkedCssImports } from './cssImports'
import { extractGoogleFontImports, extractGoogleFontsFromHtmlLinks } from './fontImports'
import { classifyFiles } from './classifyFiles'
import { makeHtmlPagePlan } from './htmlPagePlan'
import { classifyCollections } from './collectionPlan'
import { extractEntryContent, makeTemplateSource, OUTLET_MARKER_ATTR, OUTLET_MARKER_VALUE } from './collectionEntry'
import type { ImportFragment } from '@core/htmlImport'
import { buildAssetPlan, type CssFileResult } from './assetPlan'
import { partitionLinkedStylesheets } from './stylesheetPlan'
import { detectCrossSheetClassConflicts } from './classCascades'
import { detectConflicts } from './conflicts'
import { detectGlobalSections, detectSharedBlocks } from './globalSections'
import { createCssPlanState, parseCssSourceIntoPlan } from './planCss'
import { rewriteNpmCdnModuleImports } from './scriptDependencies'
import type {
  ClassifiedFile,
  CollectionCommitPlan,
  CollectionEntryCommit,
  FileMap,
  ImportPlan,
  ImportWarning,
  ImportGoogleFont,
  ImportScript,
  NewStyleRule,
  PagePlan,
  StylesheetImportMode,
} from './types'

interface BuildImportPlanInput {
  fileMap: FileMap
  currentSite: SiteDocument
  options?: {
    /** Tolerance in px for matching older @media max-width queries by frame width. Default: 10. */
    mediaTolerance?: number
    /**
     * Per-stylesheet import mode, keyed by the top-level linked CSS path
     * (FileMap key). Unlisted paths convert to editable style rules.
     */
    stylesheetModes?: Record<string, StylesheetImportMode>
  }
}

/**
 * Build a fully-analysed `ImportPlan` from a `FileMap` and the current site.
 *
 * This is a pure, synchronous function. Call it before showing the import
 * wizard so the user can preview what will be imported and resolve conflicts.
 */
export function buildImportPlan({ fileMap, currentSite, options }: BuildImportPlanInput): ImportPlan {
  const mediaTolerance = options?.mediaTolerance ?? 10
  const warnings: ImportWarning[] = []
  const droppedAtRules: string[] = []

  // 1. Classify every file.
  const classified = classifyFiles(fileMap)

  // 2. Process each HTML file into a raw PagePlan; collect inline CSS and
  //    page scripts along the way.
  const htmlPhase = collectHtmlPagePlans(classified, fileMap)
  warnings.push(...htmlPhase.warnings)
  const { rawPagePlans, inlineCssByPage, scripts, externalLinkHrefs } = htmlPhase

  // Google fonts are harvested from every CSS source (linked, kept, inline) —
  // one shared collector dedupes by family and merges variants/subsets.
  const googleFontsByFamily = new Map<string, ImportGoogleFont>()
  const collectGoogleFonts = (cssSource: string): void => {
    for (const font of extractGoogleFontImports(cssSource)) {
      const key = font.family.toLowerCase()
      const existing = googleFontsByFamily.get(key)
      if (!existing) {
        googleFontsByFamily.set(key, font)
        continue
      }
      existing.variants = [...new Set([...existing.variants, ...font.variants])].sort(compareVariants)
      existing.subsets = [...new Set([...existing.subsets, ...font.subsets])]
    }
  }

  // 2a. Install Google Fonts found in HTML <link rel="stylesheet"> tags (e.g.
  //     fonts.googleapis.com links in the <head>). These are not picked up by
  //     the CSS @import scanner because they live in HTML, not CSS.
  for (const font of extractGoogleFontsFromHtmlLinks(externalLinkHrefs)) {
    const key = font.family.toLowerCase()
    const existing = googleFontsByFamily.get(key)
    if (!existing) {
      googleFontsByFamily.set(key, font)
    } else {
      existing.variants = [...new Set([...existing.variants, ...font.variants])].sort(compareVariants)
      existing.subsets = [...new Set([...existing.subsets, ...font.subsets])]
    }
  }

  // 2b. Catalogue top-level linked stylesheets by import mode; flatten the
  //     kept ones (`mode: 'file'`) verbatim. See stylesheetPlan.ts.
  const partition = partitionLinkedStylesheets(
    rawPagePlans,
    fileMap,
    options?.stylesheetModes ?? {},
    collectGoogleFonts,
  )
  warnings.push(...partition.warnings)
  droppedAtRules.push(...partition.droppedAtRules)
  const { linkedStylesheets, keptStylesheetPaths, rawStylesheetSources } = partition

  // 2c. Expand @imports of the CONVERTED sheets into a flat, ordered list of
  //     CSS sources (kept sheets bypass conversion entirely).
  const cssExpansion = expandConvertedCssSources(rawPagePlans, fileMap, keptStylesheetPaths, partition.usedCssPaths)
  warnings.push(...cssExpansion.warnings)
  droppedAtRules.push(...cssExpansion.droppedAtRules)
  const { cssSourcesByPath, orderedCssPaths, allLinkedCssPaths } = cssExpansion

  // 3. Record CSS files no page links to.
  const unusedCss = classified
    .filter((f) => f.role === 'css' && !allLinkedCssPaths.has(f.path))
    .map((f) => f.path)

  // 4. Parse every converted CSS source — external sheets first, then each
  //    page's `<style>` CSS as a synthetic per-page source. The synthetic
  //    cssPath `<htmlPath>::inline` keeps `url(...)` resolution relative to
  //    the HTML file's directory (dirname() drops the suffix) and is appended
  //    LAST to the page's linked paths so an inline `<style>` wins the cascade
  //    over external sheets for a shared class name. Both routes flow through
  //    the exact same parse → token → asset → conflict pipeline (planCss.ts).
  const cssPlan = createCssPlanState()
  const parseOptions = {
    breakpoints: currentSite.breakpoints.map((bp) => ({ id: bp.id, width: bp.width, mediaQuery: bp.mediaQuery })),
    mediaTolerance,
    collectGoogleFonts,
  }
  for (const cssPath of orderedCssPaths) {
    const cssSource = cssSourcesByPath.get(cssPath)
    if (!cssSource) continue
    parseCssSourceIntoPlan(cssPath, cssSource, cssPlan, parseOptions)
  }
  for (const plan of rawPagePlans) {
    const inlineCss = inlineCssByPage.get(plan.source)
    if (!inlineCss) continue
    const syntheticPath = `${plan.source}::inline`
    parseCssSourceIntoPlan(syntheticPath, inlineCss, cssPlan, parseOptions)
    plan.linkedCssPaths = [...plan.linkedCssPaths, syntheticPath]
  }
  warnings.push(...cssPlan.warnings)
  droppedAtRules.push(...cssPlan.droppedAtRules)

  // 4b. Detect divergent cross-sheet class definitions among the CONVERTED
  //     stylesheets. Converted sheets merge CSS-natively into the one global
  //     cascade; when two page cascades define the same class differently,
  //     that becomes an explicit conflict (default: rename with a suffix) for
  //     the wizard's Conflicts step — applied by
  //     `applyCrossSheetClassResolutions`, never silently here.
  const existingClassNames = Object.values(currentSite.styleRules)
    .filter((rule) => rule.kind === 'class')
    .map((rule) => rule.name)
  const crossSheetClasses = detectCrossSheetClassConflicts(
    rawPagePlans,
    cssPlan.cssFileResults,
    existingClassNames,
  )
  const publishableCssFileResults = addSelectorDependencyClasses(
    cssPlan.cssFileResults,
    currentSite,
  )

  // 5. Build asset plan — normalises URLs in node props, CSS values, and kept
  //    stylesheet text; resolves @font-face blocks; collects assets to upload.
  const { normalizedPagePlans, normalizedStyleRules: rawStyleRules, styleRuleSources: rawStyleRuleSources, stylesheets, fonts, assets, warnings: assetWarnings } =
    buildAssetPlan(rawPagePlans, publishableCssFileResults, fileMap, rawStylesheetSources)
  warnings.push(...assetWarnings)

  // 5a. Collapse byte-identical rules contributed by different pages. Runs
  //     AFTER buildAssetPlan so URL rewrites are already applied and two copies
  //     of the same authored rule really are identical.
  const { rules: normalizedStyleRules, sources: styleRuleSources } =
    dedupeIdenticalStyleRules(rawStyleRules, rawStyleRuleSources)

  // 5b. Re-run the bare-selector preference across the WHOLE batch.
  //     `normalizeParsedBindableClassRules` already runs per parsed source, but
  //     each page is its own source, so a name can arrive as `kind: 'class'`
  //     from several pages at once — e.g. bare `.prose-h2` from one page and
  //     `.prose .prose-h2` from another. Two class-kind rules then share a name
  //     and whichever the store's name index happens to resolve wins, which is
  //     how a heading ended up bound to the narrow `.prose .prose-h2` variant
  //     (colour only, no font-family) instead of its bare rule. Applying the
  //     same rule globally makes the canonical bare selector win the registry
  //     slot and demotes the variants to ambient, exactly as within one sheet.
  demoteNonCanonicalClassDuplicates(normalizedStyleRules)

  // 5b. Detect cross-page global sections (nav, header, footer) that appear
  //     structurally identical across ≥2 pages. These will be promoted to
  //     VisualComponents on commit so operators edit once → all pages update.
  const globalSections = detectGlobalSections(normalizedPagePlans)
  // Author-marked shared blocks are detected on the same normalized plans, but
  // are committed in place rather than hoisted into the everywhere layout.
  const sharedBlocks = detectSharedBlocks(normalizedPagePlans)

  // 6. Detect conflicts against the current site — pages, class rules, and
  //    design tokens (colour + font) all flow through one resolution model.
  const conflicts = detectConflicts(
    currentSite,
    normalizedPagePlans,
    normalizedStyleRules,
    [...cssPlan.colorsBySlug.values()],
    [...cssPlan.fontTokensByVariable.values()],
  )

  return {
    pages: normalizedPagePlans,
    styleRules: normalizedStyleRules,
    styleRuleSources,
    fonts,
    googleFonts: [...googleFontsByFamily.values()],
    conditions: [...cssPlan.conditionsById.values()],
    assets,
    colors: [...cssPlan.colorsBySlug.values()],
    fontTokens: [...cssPlan.fontTokensByVariable.values()],
    scripts,
    collections: htmlPhase.collections,
    linkedStylesheets,
    stylesheets,
    conflicts: { ...conflicts, crossSheetClasses },
    warnings,
    droppedAtRules,
    unusedCss,
    globalSections: globalSections.length > 0 ? globalSections : undefined,
    sharedBlocks: sharedBlocks.length > 0 ? sharedBlocks : undefined,
  }
}

// ---------------------------------------------------------------------------
// Phase 1b — collapse duplicate rules contributed by sibling pages
// ---------------------------------------------------------------------------

/**
 * Stable signature for a rule's AUTHORED identity — key order in the style bags
 * depends on parse/merge order, so the keys are sorted rather than relying on
 * `JSON.stringify` insertion order.
 */
function styleRuleIdentity(rule: NewStyleRule): string {
  const bag = (styles: Record<string, unknown> | undefined): Array<[string, unknown]> =>
    Object.entries(styles ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const contexts = Object.entries(rule.contextStyles ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([contextId, styles]) => [contextId, bag(styles as Record<string, unknown>)])
  return JSON.stringify([rule.kind, rule.name, rule.selector ?? '', bag(rule.styles), contexts])
}

/**
 * Collapse byte-identical style rules contributed by different pages.
 *
 * The build contract requires every page to inline the whole shared stylesheet,
 * so an N-page batch hands the importer ~N copies of every shared class. Each
 * copy used to become its own registry rule, which at 102 pages meant 109k rules
 * for 9.7k distinct definitions (91% redundant): a ~46 MB site-document save
 * that stalls the import, and an N-way name collision on every shared class that
 * destabilises the bare-vs-variant resolution in
 * `normalizeParsedBindableClassRules`.
 *
 * Two rules collapse only when every authored field matches — kind, name,
 * selector, declarations and per-context declarations. Anything that differs by
 * so much as one declaration is left alone, so genuinely divergent definitions
 * still reach `detectCrossSheetClassConflicts` / `detectConflicts` untouched.
 *
 * `order` is deliberately excluded from the signature and the FIRST copy's
 * position is the one kept: identical declarations render identically wherever
 * they sit, and keeping the earliest copy preserves relative order against every
 * non-duplicate rule around it.
 *
 * `sources` is index-aligned with `rules` (see `buildAssetPlan`) and is filtered
 * in lockstep; the surviving entry keeps the first contributing page's path.
 */
/**
 * Batch-wide half of `normalizeParsedBindableClassRules`: when one name is
 * claimed by several `kind: 'class'` rules from DIFFERENT pages, keep the
 * canonical bare selector as the bindable rule and demote the narrower variants
 * to ambient.
 *
 * Deliberately narrower than the per-sheet normaliser. It only demotes a rule
 * whose selector is NOT the canonical `.name`, and only when some other rule for
 * that name IS canonical. Two diverging *bare* definitions (`.btn` in sheet A vs
 * a different `.btn` in sheet B) are left completely alone — that is a genuine
 * cross-sheet conflict, owned by `detectCrossSheetClassConflicts`, which needs
 * both rules to stay class-kind so one can be renamed to `btn-2`.
 */
function demoteNonCanonicalClassDuplicates(rules: NewStyleRule[]): void {
  const canonicalNames = new Set<string>()
  const classCountByName = new Map<string, number>()
  for (const rule of rules) {
    if (rule.kind !== 'class') continue
    classCountByName.set(rule.name, (classCountByName.get(rule.name) ?? 0) + 1)
    if (rule.selector === classKindSelector(rule.name)) canonicalNames.add(rule.name)
  }

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]!
    if (rule.kind !== 'class') continue
    if ((classCountByName.get(rule.name) ?? 0) < 2) continue
    if (!canonicalNames.has(rule.name)) continue
    if (rule.selector === classKindSelector(rule.name)) continue
    rules[index] = { ...rule, kind: 'ambient', name: rule.selector ?? rule.name }
  }
}

function dedupeIdenticalStyleRules(
  rules: NewStyleRule[],
  sources: string[],
): { rules: NewStyleRule[]; sources: string[] } {
  const seen = new Set<string>()
  const outRules: NewStyleRule[] = []
  const outSources: string[] = []
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]!
    const identity = styleRuleIdentity(rule)
    if (seen.has(identity)) continue
    seen.add(identity)
    outRules.push(rule)
    outSources.push(sources[index] ?? '')
  }
  return { rules: outRules, sources: outSources }
}

// ---------------------------------------------------------------------------
// Phase 2 — HTML files → raw PagePlans + inline CSS + page scripts
// ---------------------------------------------------------------------------

interface HtmlPhaseResult {
  rawPagePlans: PagePlan[]
  /** Collections implied by the folder layout. Empty for a flat build. */
  collections: CollectionCommitPlan[]
  /** Per-page CSS harvested from `<style>` blocks, keyed by pagePlan.source. */
  inlineCssByPage: Map<string, string>
  scripts: ImportScript[]
  warnings: ImportWarning[]
  /** Deduplicated external stylesheet hrefs (e.g. Google Fonts CDN links) from all pages' <head>. */
  externalLinkHrefs: string[]
}

/**
 * Build the entry-template PagePlan for a collection from one of its entries.
 *
 * The template is the entry's own document with the post's region replaced by
 * an outlet marker, run through the ordinary page pipeline — so it inherits the
 * delivered header, nav, footer and article styling, and takes part in the CSS,
 * asset and link phases like any other page. The marked node is then swapped
 * for `base.outlet`, which is the hole every entry's body renders into.
 *
 * Returns null when the marker did not survive the conversion. Returning null
 * (rather than committing a template with no outlet) is deliberate: a template
 * without exactly one outlet renders every entry as a blank page, which is
 * harder to diagnose than a collection that reports it has no template.
 */
function makeEntryTemplatePlan(
  collectionSlug: string,
  entrySource: string,
  entryHtml: string,
  fileMap: FileMap,
): { pagePlan: PagePlan; inlineCss: string } | null {
  const templateHtml = makeTemplateSource(entryHtml)
  if (!templateHtml) return null

  const templatePath = `${collectionSlug}/__entry-template.html`
  const { pagePlan, inlineCss } = makeHtmlPagePlan(templatePath, templateHtml, fileMap)

  const outletId = findMarkedNodeId(pagePlan.nodeFragment)
  if (!outletId) return null

  // Swap the marker container for a real outlet. Its children are dropped —
  // the marker is empty by construction, and an outlet renders the entry body,
  // not authored children.
  const node = pagePlan.nodeFragment.nodes[outletId]
  pagePlan.nodeFragment.nodes[outletId] = {
    ...node,
    moduleId: 'base.outlet',
    props: {},
    children: [],
  }

  return {
    pagePlan: {
      ...pagePlan,
      title: `${titleFromSlug(collectionSlug)} entry template`,
      slug: `${collectionSlug}-entry-template`,
      template: {
        enabled: true,
        target: { kind: 'postTypes', tableSlugs: [collectionSlug] },
        priority: 0,
      },
      source: entrySource === templatePath ? templatePath : templatePath,
    },
    inlineCss,
  }
}

/** Locate the node `makeTemplateSource` marked, by its preserved attribute. */
function findMarkedNodeId(fragment: ImportFragment): string | null {
  for (const id of Object.keys(fragment.nodes)) {
    const attrs = (fragment.nodes[id].props as { htmlAttributes?: Record<string, unknown> } | undefined)
      ?.htmlAttributes
    if (attrs && attrs[OUTLET_MARKER_ATTR] === OUTLET_MARKER_VALUE) return id
  }
  return null
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function collectHtmlPagePlans(classified: ClassifiedFile[], fileMap: FileMap): HtmlPhaseResult {
  const warnings: ImportWarning[] = []
  const rawPagePlans: PagePlan[] = []
  const inlineCssByPage = new Map<string, string>()
  const externalLinkHrefSet = new Set<string>()
  const scriptsByPath = new Map<string, {
    path: string
    content: string
    format: ImportScript['format']
    dependencies: ImportScript['dependencies']
    pageSources: Set<string>
    priority: number
  }>()
  let nextScriptPriority = 100

  // Read the folder layout BEFORE planning any page. `<folder>/<slug>/index.html`
  // files become collection entries, not Pages — that routing decision has to
  // happen here, because once a file has a PagePlan it is a page.
  const htmlFiles = classified.filter((f) => f.role === 'html')
  const classification = classifyCollections(htmlFiles.map((f) => f.path))
  warnings.push(...classification.warnings)

  const entryPaths = new Set<string>()
  for (const collection of classification.collections) {
    for (const entry of collection.entries) entryPaths.add(entry.source)
  }

  const collections: CollectionCommitPlan[] = []
  const bytesByPath = new Map(htmlFiles.map((f) => [f.path, f.bytes]))

  for (const folder of classification.collections) {
    const entries: CollectionEntryCommit[] = []
    for (const entry of folder.entries) {
      const bytes = bytesByPath.get(entry.source)
      if (!bytes) continue
      const content = extractEntryContent(decodeUtf8(bytes))
      if (!content) {
        // No identifiable content region — leave it as a Page rather than
        // inventing a body that would duplicate the site chrome inside the post.
        warnings.push({
          kind: 'collection-layout',
          message:
            `"${entry.source}" has no <article>, <main> or content container, so it ` +
            `imports as a Page instead of a "${folder.slug}" entry.`,
          source: entry.source,
        })
        entryPaths.delete(entry.source)
        continue
      }
      entries.push({
        source: entry.source,
        slug: entry.slug,
        title: content.title || titleFromSlug(entry.slug),
        bodyHtml: content.bodyHtml,
        featuredImageSrc: content.featuredImageSrc,
        seoTitle: content.seoTitle,
        seoDescription: content.seoDescription,
      })
    }

    if (entries.length === 0) continue

    // Derive the template from the first entry that yielded content.
    const templateSourceEntry = entries[0]
    const templateBytes = bytesByPath.get(templateSourceEntry.source)
    const template = templateBytes
      ? makeEntryTemplatePlan(
          folder.slug,
          templateSourceEntry.source,
          decodeUtf8(templateBytes),
          fileMap,
        )
      : null

    if (template) {
      rawPagePlans.push(template.pagePlan)
      if (template.inlineCss.trim().length > 0) {
        inlineCssByPage.set(template.pagePlan.source, template.inlineCss)
      }
    } else {
      warnings.push({
        kind: 'collection-layout',
        message:
          `Could not derive an entry template for "${folder.slug}". The collection and its ` +
          `${entries.length} entries are still created, but entry URLs return 404 until a ` +
          `template targeting "${folder.slug}" exists.`,
        source: templateSourceEntry.source,
      })
    }

    collections.push({
      slug: folder.slug,
      name: folder.name,
      templatePageSource: template?.pagePlan.source ?? null,
      entries,
    })
  }

  for (const f of classified) {
    if (f.role !== 'html') continue
    // Entries are content, not pages — their body was lifted above.
    if (entryPaths.has(f.path)) continue
    const htmlSource = decodeUtf8(f.bytes)
    const { pagePlan, warnings: pageWarnings, inlineCss, externalLinkHrefs: pageExternalHrefs } = makeHtmlPagePlan(f.path, htmlSource, fileMap)
    for (const href of pageExternalHrefs) externalLinkHrefSet.add(href)
    warnings.push(...pageWarnings)
    rawPagePlans.push(pagePlan)
    if (inlineCss.trim().length > 0) inlineCssByPage.set(pagePlan.source, inlineCss)
    for (const pageScript of pagePlan.scripts) {
      const scriptPath = pageScript.path
      const existing = scriptsByPath.get(scriptPath)
      if (existing) {
        existing.pageSources.add(pagePlan.source)
        continue
      }

      const content = pageScript.kind === 'inline'
        ? pageScript.content
        : decodeExternalScript(fileMap, pageScript.path)
      if (content === null) continue
      const script = normalizeImportedScriptContent(content, pageScript.format)

      scriptsByPath.set(scriptPath, {
        path: scriptPath,
        content: script.content,
        format: pageScript.format,
        dependencies: script.dependencies,
        pageSources: new Set([pagePlan.source]),
        priority: nextScriptPriority,
      })
      nextScriptPriority += 1
    }
  }

  const scripts: ImportScript[] = [...scriptsByPath.values()].map((script) => ({
    ...script,
    pageSources: [...script.pageSources],
  }))
  return { rawPagePlans, collections, inlineCssByPage, scripts, warnings, externalLinkHrefs: [...externalLinkHrefSet] }
}

// ---------------------------------------------------------------------------
// Phase 2c — expand @imports of converted sheets into ordered CSS sources
// ---------------------------------------------------------------------------

interface CssExpansionResult {
  cssSourcesByPath: Map<string, string>
  orderedCssPaths: string[]
  /** Every CSS path any page uses (kept + converted + expanded @imports). */
  allLinkedCssPaths: Set<string>
  warnings: ImportWarning[]
  droppedAtRules: string[]
}

/**
 * Expand the converted top-level sheets' `@import` chains per page, mutating
 * each plan's `linkedCssPaths` to the expanded list, and return the deduped
 * CSS sources in first-seen order (= cascade order across pages).
 */
function expandConvertedCssSources(
  rawPagePlans: PagePlan[],
  fileMap: FileMap,
  keptStylesheetPaths: ReadonlySet<string>,
  usedCssPaths: Iterable<string>,
): CssExpansionResult {
  const warnings: ImportWarning[] = []
  const droppedAtRules: string[] = []
  const cssSourcesByPath = new Map<string, string>()
  const orderedCssPaths: string[] = []
  const allLinkedCssPaths = new Set<string>(usedCssPaths)

  for (const plan of rawPagePlans) {
    // Kept stylesheets bypass conversion entirely — only the converted sheets
    // join the page's cascade of parsed rules.
    const convertedTopLevel = plan.linkedCssPaths.filter((cssPath) => !keptStylesheetPaths.has(cssPath))
    const expanded = expandLinkedCssImports(convertedTopLevel, fileMap)
    warnings.push(...expanded.warnings)
    for (const w of expanded.warnings) {
      if (w.kind === 'dropped-at-rule' && w.source) droppedAtRules.push(w.source)
    }
    plan.linkedCssPaths = expanded.cssPaths
    for (const cssPath of expanded.cssPaths) allLinkedCssPaths.add(cssPath)
    for (const source of expanded.sources) {
      if (cssSourcesByPath.has(source.cssPath)) continue
      cssSourcesByPath.set(source.cssPath, source.cssSource)
      orderedCssPaths.push(source.cssPath)
    }
  }

  return { cssSourcesByPath, orderedCssPaths, allLinkedCssPaths, warnings, droppedAtRules }
}

// ---------------------------------------------------------------------------
// Phase 4b helper — make every selector class available to the class picker
// ---------------------------------------------------------------------------

const INVALID_CLASS_ATTRIBUTE_TOKEN_RE = /[\s\u007f]/u

/**
 * Complex selectors expose their rightmost class as their bindable class rule
 * (`.group:hover .group-hover\:block` binds `group-hover:block`). Ancestor and
 * dependency classes such as `group`, `peer`, or `dark` may never own a
 * declaration block of their own, but users still need to pick and assign
 * them. Add one bare registry class for every selector class name that has no
 * bindable rule in the incoming CSS or existing site.
 *
 * Bare entries add no CSS. They are assignment/index records; the publisher's
 * selector-dependency tree-shaker emits ambient fragments when their known
 * class dependencies are in use.
 */
function addSelectorDependencyClasses(
  cssFileResults: CssFileResult[],
  currentSite: SiteDocument,
): CssFileResult[] {
  const bindableNames = new Set(
    Object.values(currentSite.styleRules)
      .filter((rule) => rule.kind === 'class')
      .map((rule) => rule.name),
  )
  for (const file of cssFileResults) {
    for (const rule of file.rules) {
      if (rule.kind === 'class') bindableNames.add(rule.name)
    }
  }

  const firstSourceByMissingName = new Map<string, number>()
  for (let fileIndex = 0; fileIndex < cssFileResults.length; fileIndex += 1) {
    for (const rule of cssFileResults[fileIndex].rules) {
      if (rule.rawCss) continue
      for (const token of extractCssSelectorClasses(rule.selector)) {
        if (
          bindableNames.has(token.name)
          || firstSourceByMissingName.has(token.name)
          || INVALID_CLASS_ATTRIBUTE_TOKEN_RE.test(token.name)
        ) {
          continue
        }
        firstSourceByMissingName.set(token.name, fileIndex)
      }
    }
  }

  if (firstSourceByMissingName.size === 0) return cssFileResults

  const additionsByFile = new Map<number, string[]>()
  for (const [name, fileIndex] of firstSourceByMissingName) {
    const names = additionsByFile.get(fileIndex) ?? []
    names.push(name)
    additionsByFile.set(fileIndex, names)
  }

  return cssFileResults.map((file, fileIndex) => {
    const additions = additionsByFile.get(fileIndex)
    if (!additions?.length) return file
    const baseOrder = file.rules.length
    return {
      ...file,
      rules: [
        ...file.rules,
        ...additions.map((name, index) => ({
          name,
          kind: 'class' as const,
          selector: classKindSelector(name),
          order: baseOrder + index,
          styles: {},
          contextStyles: {},
        })),
      ],
    }
  })
}

// ---------------------------------------------------------------------------
// Decoding helpers
// ---------------------------------------------------------------------------

/** Decode UTF-8 bytes to a string. */
function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function decodeExternalScript(fileMap: FileMap, path: string): string | null {
  const file = fileMap.files[path]
  return file ? decodeUtf8(file.bytes) : null
}

function normalizeImportedScriptContent(
  content: string,
  format: ImportScript['format'],
): Pick<ImportScript, 'content' | 'dependencies'> {
  if (format !== 'module') return { content }
  const rewritten = rewriteNpmCdnModuleImports(content)
  return rewritten.dependencies.length > 0
    ? { content: rewritten.content, dependencies: rewritten.dependencies }
    : { content }
}
