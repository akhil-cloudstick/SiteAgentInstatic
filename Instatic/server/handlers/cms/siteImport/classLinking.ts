/**
 * Server-side class name→id linking for the headless Super Import (Share to CMS).
 *
 * A server-owned copy of the pure algorithm in
 * `src/admin/pages/site/store/slices/site/importLinking.ts` — the browser store
 * uses that copy inside its Immer producer; the server can't import from
 * `src/admin`, and this logic is pure (nanoid + @core/page-tree only), so it is
 * duplicated here rather than reaching across the app boundary. Keep the two in
 * sync (or hoist both to `@core/siteImport` in a later refactor).
 */
import { nanoid } from 'nanoid'
import { classKindSelector } from '@core/page-tree'
import type { StyleRule } from '@core/page-tree'
import type { NewStyleRule } from '@core/siteImport'

/** Index a StyleRule registry by class name → id (first id wins). */
export function indexStyleRulesByName(rules: Record<string, StyleRule>): Map<string, string> {
  const byName = new Map<string, string>()
  for (const cls of Object.values(rules)) {
    if (cls.kind === 'class' && !byName.has(cls.name)) byName.set(cls.name, cls.id)
  }
  return byName
}

/**
 * Convert class *names* stamped on a fragment node into real registry class
 * *ids*. Unknown names auto-create a bare (style-less) class so the token still
 * renders and is editable. Mutates `rules` + `byName`.
 */
export function linkImportedClassNames(
  classNames: readonly string[] | undefined,
  rules: Record<string, StyleRule>,
  byName: Map<string, string>,
): string[] {
  if (!classNames?.length) return []
  const ids: string[] = []
  for (const name of classNames) {
    if (name.length === 0) continue
    let id = byName.get(name)
    if (!id) {
      const now = Date.now()
      let maxOrder = -1
      for (const c of Object.values(rules)) {
        if (typeof c.order === 'number' && c.order > maxOrder) maxOrder = c.order
      }
      const cls: StyleRule = {
        id: nanoid(),
        name,
        kind: 'class',
        selector: classKindSelector(name),
        order: maxOrder + 1,
        styles: {},
        contextStyles: {},
        createdAt: now,
        updatedAt: now,
      }
      rules[cls.id] = cls
      byName.set(name, cls.id)
      id = cls.id
    }
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * Merge `NewStyleRule[]` parsed from imported CSS into the live registry,
 * minting real `StyleRule`s (id + cascade order + timestamps). First-wins:
 * an existing class name / ambient selector is kept. Mutates `siteRules` + `byName`.
 * Must run BEFORE `linkImportedClassNames`.
 */
export function mergeImportedStyleRules(
  rules: readonly NewStyleRule[],
  siteRules: Record<string, StyleRule>,
  byName: Map<string, string>,
): void {
  if (rules.length === 0) return
  let maxOrder = -1
  const ambientSelectors = new Set<string>()
  for (const r of Object.values(siteRules)) {
    if (typeof r.order === 'number' && r.order > maxOrder) maxOrder = r.order
    if (r.kind === 'ambient') ambientSelectors.add(r.selector)
  }
  const now = Date.now()
  for (const rule of rules) {
    if (rule.kind === 'class') {
      if (byName.has(rule.name)) continue
    } else if (ambientSelectors.has(rule.selector)) {
      continue
    }
    const id = nanoid()
    const newRule: StyleRule = { ...rule, id, order: (maxOrder += 1), createdAt: now, updatedAt: now }
    siteRules[id] = newRule
    if (rule.kind === 'class') byName.set(rule.name, id)
    else ambientSelectors.add(rule.selector)
  }
}
