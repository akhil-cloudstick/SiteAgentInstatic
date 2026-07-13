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
 * v1 scope: pages + style rules (the styling that lives in classes/ambient CSS).
 * Colour/font tokens, custom @font-face fonts, cross-page Visual Components, and
 * page scripts are follow-ups — they need the framework-token constructors + a
 * VC/data-row writer and are additive on top of this.
 */
import { nanoid } from 'nanoid'
import { createNode } from '@core/page-tree'
import type { Page, PageNode, SiteDocument } from '@core/page-tree'
import type { ImportPlan } from '@core/siteImport'
import type { SiteBundle } from '@core/data/bundleSchema'
import type { DataRow, DataTable } from '@core/data/schemas'
import { pageToCells } from '@core/data/pageFromRow'
import { indexStyleRulesByName, mergeImportedStyleRules, linkImportedClassNames } from './classLinking'

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
): SiteBundle {
  // Clone the shell (drop the SiteDocument-only collections) so the source stays
  // untouched until the atomic import commits.
  const { pages: _p, visualComponents: _vc, layouts: _l, ...shell } = structuredClone(currentSite)
  void _p; void _vc; void _l

  const byName = indexStyleRulesByName(shell.styleRules)
  // Register parsed CSS class/ambient rules FIRST, then resolve node class tokens.
  mergeImportedStyleRules(plan.styleRules, shell.styleRules, byName)

  // slug conflict → reuse the existing page id (upsert, no duplicate on re-push).
  const existingIdBySource = new Map<string, string>()
  for (const c of plan.conflicts.pages) existingIdBySource.set(c.source, c.existingPageId)

  const nowIso = new Date().toISOString()
  const rows: DataRow[] = []
  for (const pagePlan of plan.pages) {
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
    const id = existingIdBySource.get(pagePlan.source) ?? nanoid()
    const page: Page = { id, title: pagePlan.title, slug: pagePlan.slug, nodes, rootNodeId: body.id }
    rows.push(newRow(id, pagePlan.slug, pageToCells(page), nowIso))
  }

  return {
    schemaVersion: 1,
    exportedAt: nowIso,
    sourceSiteName: shell.name,
    site: shell,
    tables: [pagesTable],
    rows,
  }
}
