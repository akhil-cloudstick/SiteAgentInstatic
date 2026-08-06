/**
 * Materialise a module's declarative `defaultChildren` into real tree nodes.
 *
 * A container inserted from a picker used to arrive as an empty shell — one
 * childless row with no hint of what belongs inside. `ModuleDefinition.
 * defaultChildren` declares a starter subtree; this turns that declaration
 * into `PageNode`s.
 *
 * IMPORTANT — the caller must run this INSIDE the same `mutateActiveTree`
 * recipe that inserts the parent. Splitting the writes puts the parent and
 * its children in different history patches, so a single undo reverts only
 * the parent and leaves the children orphaned in the persisted node map
 * forever. `insertComponentRef` carries the same warning for slot instances.
 */

import { registry } from '@core/module-engine'
import type { ModuleDefaultChild } from '@core/module-engine'
import { createNode, insertNode } from './mutations'
import type { NodeTree } from './treeSchema'
import type { PageNode } from './pageNode'

/**
 * Defensive ceiling on starter-subtree nesting. First-party declarations are
 * one or two levels deep; this only stops a malformed declaration from hanging
 * the editor. Note that a declared child's OWN `defaultChildren` is never
 * expanded — only the literal declaration is materialised — so a cycle is
 * impossible by construction and this cap is belt-and-braces.
 */
const MAX_DEFAULT_CHILD_DEPTH = 6

/**
 * Modules a starter subtree may never mint.
 *
 * - `base.outlet` is capped at one per document; the invariant is enforced by
 *   the caller for the inserted node itself, and a starter child must not slip
 *   past it.
 * - `base.visual-component-ref` and `base.slot-instance` need
 *   `syncSlotInstances` to build their managed children; a bare `createNode`
 *   would produce a structurally invalid ref.
 */
const NEVER_SEEDED = new Set(['base.outlet', 'base.visual-component-ref', 'base.slot-instance'])

/**
 * Create the nodes described by `specs` and attach them under `parent`.
 *
 * Mutates `tree.nodes` and `parent.children` directly (safe on a Mutative
 * draft). Unknown module ids are skipped rather than throwing — a starter
 * subtree is a convenience, never a reason to fail the author's insert.
 *
 * Returns the ids of every node created, in creation order.
 */
export function materializeDefaultChildren(
  tree: NodeTree<PageNode>,
  parent: PageNode,
  specs: readonly ModuleDefaultChild[] | undefined,
  depth = 0,
): string[] {
  if (!specs || specs.length === 0) return []
  if (depth >= MAX_DEFAULT_CHILD_DEPTH) return []

  const created: string[] = []

  for (const spec of specs) {
    if (NEVER_SEEDED.has(spec.moduleId)) continue
    const definition = registry.get(spec.moduleId)
    if (!definition) continue

    const node = createNode(spec.moduleId, {
      ...definition.defaults,
      ...spec.props,
    })
    // `createNode` takes only (moduleId, defaults), so the label is applied
    // after construction — same as the HTML importer's `walkAndMap`.
    if (spec.label) node.label = spec.label

    // Routed through the pure mutation rather than hand-wiring
    // `children`/`parentId`, so the duplicate-id and missing-parent throws
    // still apply and the parentId invariant is maintained in one place.
    insertNode(tree, node, parent.id)
    created.push(node.id)

    // Only recurse into modules that actually accept children — a leaf with
    // declared children would produce nodes the publisher never renders.
    if (definition.canHaveChildren) {
      created.push(...materializeDefaultChildren(tree, node, spec.children, depth + 1))
    }
  }

  return created
}
