/**
 * Site workspace mode — the three approved states of the MMSBUILD Guided Site
 * Workspace, derived from existing store state rather than stored separately.
 *
 *   Live edit         → the single real-size editable frame
 *   Focus section     → the same frame, with one top-level section lit and its
 *                       siblings dimmed (an ephemeral presentation state)
 *   Responsive review → the multi-breakpoint design canvas
 *
 * There is deliberately no `mode` field in the store. `canvasView` and
 * `sectionFocusNodeId` already carry the whole truth, and a third field would
 * be a fourth way for them to disagree. Everything that needs the mode — the
 * shell's `data-site-mode`, the workspace toolbar, the outline panel headings,
 * the inspector headings — reads it through this selector.
 */
import type { EditorStore } from '@site/store/types'
import { getAncestors, type Page } from '@core/page-tree'

export type SiteWorkspaceMode = 'live' | 'focus' | 'review'

export function selectSiteWorkspaceMode(state: EditorStore): SiteWorkspaceMode {
  if (state.canvasView === 'design') return 'review'
  return state.sectionFocusNodeId === null ? 'live' : 'focus'
}

/**
 * The top-level sections of a page: the direct children of its root node.
 *
 * This is the exact set the reference's "Page outline" lists (Header, Hero,
 * Benefits, Services, …) and the set Section Focus can focus. Everything
 * deeper belongs to the full Layers tree in the Explorer panel.
 */
export function topLevelSectionIds(page: Page | null): string[] {
  if (!page) return []
  return page.nodes[page.rootNodeId]?.children ?? []
}

/**
 * Walk up from `nodeId` to the top-level section containing it, so focusing
 * works from a selection at any depth (select a button inside Hero → focus
 * Hero). Returns null when there is no selection or the node is the root
 * itself.
 */
export function resolveFocusSectionId(page: Page | null, nodeId: string | null): string | null {
  if (!page || !nodeId || nodeId === page.rootNodeId) return null

  const sections = new Set(topLevelSectionIds(page))
  if (sections.has(nodeId)) return nodeId

  // getAncestors returns the ancestor NODES, root-first. Exactly one of them
  // can be a top-level section, so the first match is the owner.
  for (const ancestor of getAncestors(page, nodeId)) {
    if (sections.has(ancestor.id)) return ancestor.id
  }
  return null
}
