/**
 * detectGlobalSections — cross-page semantic section deduplication.
 *
 * After the import pipeline processes each HTML page independently, Astro has
 * already baked the same `<nav>` / `<header>` / `<footer>` HTML into every
 * `dist/*.html` file. This phase finds those duplicate sections, normalises
 * away the build-time active-state class each page bakes in, and returns a
 * list of `GlobalSectionCandidate`s that `commitImportPlan` promotes to
 * VisualComponents.
 *
 * Hash algorithm: djb2 over a deterministic recursive serialisation of the
 * node tree (using moduleId + props + sorted classIds + child structure). Node
 * IDs are intentionally excluded from the hash — two pages will have different
 * nanoid node IDs for structurally identical nav trees.
 */

import type { PageNode } from '@core/page-tree'
import type { ImportFragment } from '@core/htmlImport'
import type { GlobalSectionCandidate, PagePlan, SharedBlockCandidate } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GLOBAL_SECTION_TAGS = new Set(['nav', 'header', 'footer'])

/** Authored marker that opts a block into becoming one shared Visual Component. */
const SHARED_BLOCK_ATTRIBUTE = 'data-shared'

/** Class names that indicate a per-page active/current state. Stripped before
 * comparison so two pages with the same nav (but different active items) hash
 * identically and are recognised as the same shared section. */
const ACTIVE_STATE_CLASS_NAMES = new Set([
  'active',
  'nav-link-active',
  'is-active',
  'current',
  'current-page',
  'selected',
])

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan all page plans for top-level `<nav>`, `<header>`, and `<footer>`
 * sections that appear structurally identical (after active-state class
 * normalisation) across two or more pages.
 *
 * Returns only candidates that appear in ≥2 pages — single-page sections
 * don't need to be promoted to shared components.
 */
export function detectGlobalSections(pagePlans: PagePlan[]): GlobalSectionCandidate[] {
  const byKey = new Map<string, GlobalSectionCandidate>()

  for (const plan of pagePlans) {
    for (const rootId of plan.nodeFragment.rootIds) {
      const node = plan.nodeFragment.nodes[rootId]
      if (!node || node.moduleId !== 'base.container') continue
      const tag = typeof node.props.tag === 'string' ? node.props.tag : ''
      if (!GLOBAL_SECTION_TAGS.has(tag)) continue

      const { fragment, hasActiveLinks } = extractNormalizedSection(rootId, plan.nodeFragment)
      const hash = hashFragment(fragment, plan.source)
      const key = `${tag}:${hash}`

      const existing = byKey.get(key)
      if (existing) {
        existing.pageSources.push(plan.source)
        existing.rootIdByPageSource[plan.source] = rootId
      } else {
        byKey.set(key, {
          tag,
          hash,
          pageSources: [plan.source],
          rootIdByPageSource: { [plan.source]: rootId },
          representativeFragment: fragment,
          hasActiveLinks,
        })
      }
    }
  }

  return [...byKey.values()].filter((c) => c.pageSources.length >= 2)
}

/**
 * Blocks the design tool explicitly marked as shared, via `data-shared="name"`.
 *
 * `detectGlobalSections` above only ever promotes a top-level nav/header/footer,
 * and moves it into the everywhere layout. This covers the other half: any block
 * the author declares shared — a CTA band, a repeated card, a contact strip —
 * wherever it sits in the tree. Each group becomes ONE Visual Component and each
 * occurrence is replaced IN PLACE by a reference, so the canvas still shows the
 * block exactly where it belongs and editing it once updates every page.
 *
 * Grouping is by `(name, structural hash)`, so a marked block only merges with
 * copies that are genuinely identical — the same rule the shared chrome uses.
 * Two occurrences are enough, whether they are on two pages or twice on one.
 */
export function detectSharedBlocks(pagePlans: PagePlan[]): SharedBlockCandidate[] {
  const byKey = new Map<string, SharedBlockCandidate>()

  for (const plan of pagePlans) {
    for (const nodeId of Object.keys(plan.nodeFragment.nodes)) {
      const node = plan.nodeFragment.nodes[nodeId]
      if (!node) continue
      const name = sharedBlockName(node)
      if (!name) continue

      const { fragment } = extractNormalizedSection(nodeId, plan.nodeFragment)
      const key = `${name}:${hashFragment(fragment, plan.source)}`

      const existing = byKey.get(key)
      if (existing) {
        existing.occurrences.push({ pageSource: plan.source, nodeId })
      } else {
        byKey.set(key, {
          name,
          occurrences: [{ pageSource: plan.source, nodeId }],
          representativeFragment: fragment,
        })
      }
    }
  }

  return [...byKey.values()].filter((c) => c.occurrences.length >= 2)
}

/** The author's `data-shared` name, or '' when the node is not marked. */
function sharedBlockName(node: PageNode): string {
  const attrs = node.props?.htmlAttributes
  if (!attrs || typeof attrs !== 'object') return ''
  const raw = (attrs as Record<string, unknown>)[SHARED_BLOCK_ATTRIBUTE]
  return typeof raw === 'string' ? raw.trim() : ''
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract a sub-fragment rooted at `sectionRootId`, collecting all descendant
 * nodes and stripping known active-state class names from every node.
 *
 * Returns a new `ImportFragment` (shares no mutable state with the original)
 * plus a flag indicating whether any active-state classes were stripped.
 */
function extractNormalizedSection(
  sectionRootId: string,
  fragment: ImportFragment,
): { fragment: ImportFragment; hasActiveLinks: boolean } {
  let hasActiveLinks = false
  const extracted: Record<string, PageNode> = {}

  const queue = [sectionRootId]
  while (queue.length > 0) {
    const id = queue.shift()!
    const node = fragment.nodes[id]
    if (!node || id in extracted) continue

    const strippedClassIds: string[] = []
    for (const c of node.classIds) {
      if (ACTIVE_STATE_CLASS_NAMES.has(c)) {
        if (node.moduleId === 'base.link') hasActiveLinks = true
      } else {
        strippedClassIds.push(c)
      }
    }

    extracted[id] = { ...node, classIds: strippedClassIds }
    for (const childId of node.children ?? []) queue.push(childId)
  }

  return {
    fragment: { nodes: extracted, rootIds: [sectionRootId] },
    hasActiveLinks,
  }
}

/**
 * Hash a normalised sub-fragment by recursively serialising its tree
 * structure. Node IDs are replaced by subtree position, so two structurally
 * identical trees with different IDs hash to the same value.
 *
 * `pageSource` is the page the section came from; it canonicalises same-page
 * anchor links (see `canonicalizeLinkProps`) so a nav whose links are
 * context-scoped per page still hashes identically across pages.
 */
function hashFragment(fragment: ImportFragment, pageSource: string): string {
  const rootId = fragment.rootIds[0]
  if (!rootId) return ''
  const serialized = serializeTree(rootId, fragment.nodes, pageSource)
  return djb2(JSON.stringify(serialized))
}

function serializeTree(nodeId: string, nodes: Record<string, PageNode>, pageSource: string): unknown {
  const node = nodes[nodeId]
  if (!node) return null
  return {
    m: node.moduleId,
    p: stableStringify(canonicalizeLinkProps(node, pageSource)),
    c: [...node.classIds].sort(),
    ch: (node.children ?? []).map((id) => serializeTree(id, nodes, pageSource)),
  }
}

/**
 * A same-page anchor link (`href="#mugs"` baked into shop.html) points at the
 * same target as the cross-page form other pages use to reach it
 * (`href="shop.html#mugs"`). SSGs emit whichever is shorter per page, so an
 * otherwise-identical shared nav/footer would hash differently page-to-page and
 * never be recognised as one shared section. Canonicalise the same-page form to
 * the cross-page form for hashing only (the stored fragment is untouched).
 */
function canonicalizeLinkProps(node: PageNode, pageSource: string): Record<string, unknown> {
  const href = node.props?.href
  if (
    node.moduleId === 'base.link' &&
    typeof href === 'string' &&
    href.length > 1 &&
    href.startsWith('#')
  ) {
    return { ...node.props, href: `${pageSource}${href}` }
  }
  return node.props
}

function stableStringify(obj: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = obj[k]
        return acc
      }, {}),
  )
}

/** djb2 hash — fast, deterministic, no crypto import needed. */
function djb2(str: string): string {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i)
    h >>>= 0
  }
  return h.toString(36)
}
