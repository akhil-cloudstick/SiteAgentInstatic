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
import type { GlobalSectionCandidate, PagePlan } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GLOBAL_SECTION_TAGS = new Set(['nav', 'header', 'footer'])

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
      const hash = hashFragment(fragment)
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
 */
function hashFragment(fragment: ImportFragment): string {
  const rootId = fragment.rootIds[0]
  if (!rootId) return ''
  const serialized = serializeTree(rootId, fragment.nodes)
  return djb2(JSON.stringify(serialized))
}

function serializeTree(nodeId: string, nodes: Record<string, PageNode>): unknown {
  const node = nodes[nodeId]
  if (!node) return null
  return {
    m: node.moduleId,
    p: stableStringify(node.props),
    c: [...node.classIds].sort(),
    ch: (node.children ?? []).map((id) => serializeTree(id, nodes)),
  }
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
