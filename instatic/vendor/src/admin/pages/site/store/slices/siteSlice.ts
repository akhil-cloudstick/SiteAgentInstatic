/**
 * siteSlice — orchestrator for the SiteDocument-owning slice.
 *
 * Implementation lives under `./site/` (one file per domain). This file just
 * wires the helpers + action factories together and re-exports the public
 * `SiteSlice` interface so the augmentation of `EditorStore` happens in a
 * single place.
 *
 * Domain layout:
 *   - `./site/types`            — SiteSlice interface + patch types + helpers contract
 *   - `./site/defaults`         — createDefaultSiteDocument + MAX_HISTORY
 *   - `./site/helpers`          — buildSiteHelpers (mutate* + patch-based history) + depthInTree
 *   - `./site/undoRedoActions`  — undo / redo
 *   - `./site/lifecycleActions` — createSite / loadSite / clearSite / updateSiteName
 *   - `./site/pageActions`      — page CRUD + template conversions
 *   - `./site/explorerActions`  — Site Explorer folder/order organization
 *   - `./site/nodeActions`      — the 11 named tree mutations + multi-select variants + dynamic bindings
 *   - `./site/breakpointActions`— breakpoint CRUD
 *   - `./site/settingsActions`  — site-level settings patch
 *   - `./site/fontActions`      — font library CRUD
 *   - `./site/framework/*`      — color / typography / spacing / preferences / preview / class reconciliation
 */

import type { EditorStoreSliceCreator } from '@site/store/types'
import { buildSiteHelpers } from './site/helpers'
import { createUndoRedoActions } from './site/undoRedoActions'
import { createLifecycleActions } from './site/lifecycleActions'
import { createPageActions } from './site/pageActions'
import { createExplorerActions } from './site/explorerActions'
import { createNodeActions } from './site/nodeActions'
import { createBreakpointActions } from './site/breakpointActions'
import { createSettingsActions } from './site/settingsActions'
import { createFontActions } from './site/fontActions'
import { createFrameworkColorActions } from './site/framework/colors'
import { createFrameworkTypographyActions } from './site/framework/typography'
import { createFrameworkSpacingActions } from './site/framework/spacing'
import { createFrameworkPreferencesActions } from './site/framework/preferences'
import { createFrameworkPreviewActions } from './site/framework/preview'
import type { SiteSlice } from './site/types'

// Re-export the public slice type for store wiring.


// Contribute this slice's fields to the combined `EditorStore` type via TS
// module augmentation. See `../types.ts` for why we use this pattern.
declare module '@site/store/types' {
  interface EditorStore extends SiteSlice {}
}

export const createSiteSlice: EditorStoreSliceCreator<SiteSlice> = (set, get) => {
  // Build the closure-shared mutation helpers once. Every action factory
  // receives this same object — so there is exactly one
  // `mutateActiveTree` / `mutateSite` per slice instance.
  const helpers = buildSiteHelpers(set, get)

  return {
    // ─── Owned state ─────────────────────────────────────────────────────────
    site: null,

    // Undo / redo history — Mutative patch-pair stacks (see HistoryEntry).
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    _historyCoalesceKey: null,

    // mutateAllPagesAndSite is the public entry point for the Super Import
    // wizard — one Cmd+Z reverts the entire import.
    mutateAllPagesAndSite: helpers.mutateAllPagesAndSite,

    deduplicateStyleRules() {
      let removed = 0
      helpers.mutateSite((site) => {
        // Count total CSS declarations in a rule (styles + all contextStyles breakpoints).
        // We keep the richest copy — the one with the most actual declarations.
        // This matters because linkImportedClassNames can auto-create an EMPTY
        // placeholder rule (kind:'class', no styles) before commitStyleRules adds
        // the real rule with declarations; lowest-order would keep the empty one.
        const styleCount = (r: { styles?: Record<string, unknown>; contextStyles?: Record<string, unknown> }) => {
          let n = Object.keys(r.styles ?? {}).length
          for (const ctx of Object.values(r.contextStyles ?? {})) {
            n += Object.keys(ctx ?? {}).length
          }
          return n
        }

        // Group duplicates by key (class name or ambient selector).
        const classGroups = new Map<string, typeof site.styleRules[string][]>()
        const ambientGroups = new Map<string, typeof site.styleRules[string][]>()
        for (const r of Object.values(site.styleRules)) {
          const key = r.kind === 'class' ? r.name : r.selector
          const map = r.kind === 'class' ? classGroups : ambientGroups
          const arr = map.get(key) ?? []
          arr.push(r)
          map.set(key, arr)
        }

        const idRemap = new Map<string, string>()

        const pickSurvivor = (group: typeof site.styleRules[string][]) => {
          // Pick the rule with the most CSS declarations; tiebreak by lowest order.
          return group.reduce((best, r) => {
            const bc = styleCount(best)
            const rc = styleCount(r)
            if (rc > bc) return r
            if (rc === bc && (r.order ?? 0) < (best.order ?? 0)) return r
            return best
          })
        }

        for (const group of [...classGroups.values(), ...ambientGroups.values()]) {
          if (group.length <= 1) continue
          const survivor = pickSurvivor(group)
          for (const r of group) {
            if (r.id !== survivor.id) idRemap.set(r.id, survivor.id)
          }
        }

        if (idRemap.size === 0) return false

        const remapIds = (ids: string[]) => ids.map((id) => idRemap.get(id) ?? id)
        for (const page of site.pages) {
          for (const node of Object.values(page.nodes)) {
            if (node.classIds?.length) node.classIds = remapIds(node.classIds)
          }
        }
        for (const vc of site.visualComponents ?? []) {
          for (const node of Object.values(vc.tree.nodes)) {
            if (node.classIds?.length) node.classIds = remapIds(node.classIds)
          }
        }
        for (const id of idRemap.keys()) {
          delete site.styleRules[id]
          removed++
        }
        return true
      })
      return removed
    },

    // ─── Action surface ──────────────────────────────────────────────────────
    ...createUndoRedoActions(helpers),
    ...createLifecycleActions(helpers),
    ...createPageActions(helpers),
    ...createExplorerActions(helpers),
    ...createNodeActions(helpers),
    ...createBreakpointActions(helpers),
    ...createSettingsActions(helpers),
    ...createFontActions(helpers),
    ...createFrameworkColorActions(helpers),
    ...createFrameworkTypographyActions(helpers),
    ...createFrameworkSpacingActions(helpers),
    ...createFrameworkPreferencesActions(helpers),
    ...createFrameworkPreviewActions(helpers),
  }
}
