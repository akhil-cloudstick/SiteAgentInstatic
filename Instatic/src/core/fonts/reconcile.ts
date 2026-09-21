/**
 * Keeping a site's fonts across a design replace (MMSBUILD R12, AC-C12.2).
 *
 * A "Share to CMS" replaces the design, and blanking the design blanks the font
 * registry with it (`blankImportedDesign`). That blanking is deliberate and must
 * stay: without it a re-share accumulates stale fonts and style rules from
 * previous shares, and the site stops being an exact match for the design it
 * came from.
 *
 * What the blank also did, though, was lose fonts the NEW design still uses. The
 * importer reinstalls families whose `@font-face` the shared CSS declares, so
 * the common case survives; a family the design only REFERENCES — bound to a
 * token, or installed out of band by the connector — has its registry entry
 * deleted while its `font-family` declarations stay in the CSS. The result is a
 * correct push that lands unstyled in exactly the place nobody checks.
 *
 * The fix is reconciliation rather than preservation. AC-C12.2 allows either
 * "preserve or reinstall"; preserving everything would put the stale fonts
 * straight back. So an entry returns only when the new design actually refers to
 * its family, which satisfies the criterion without reopening the accumulation
 * the blank exists to prevent.
 *
 * The font FILES are never deleted by any of this — they live in media, and a
 * blank only drops the registry rows that point at them. So this restores
 * metadata, not bytes, and a restored entry points at files that are still
 * there.
 */

import type { FontEntry, FontToken, SiteFontsSettings } from './schemas'

/** Enough of a site document to find font references in. Deliberately loose. */
interface SiteLike {
  styleRules?: Record<string, unknown> | undefined
  files?: { type?: string | undefined; content?: string | undefined }[] | undefined
  settings?: { fonts?: SiteFontsSettings | undefined } | undefined
}

/** Compare families the way CSS does: case-insensitively, ignoring quotes. */
export function normalizeFamily(family: string): string {
  return family.replace(/["']/g, '').trim().toLowerCase()
}

/** Every family named in one CSS `font-family` value, e.g. `"Inter", sans-serif`. */
function familiesInStack(value: string): string[] {
  return value
    .split(',')
    .map((part) => normalizeFamily(part))
    .filter((part) => part.length > 0)
}

function collectFromStyleBag(bag: unknown, into: Set<string>): void {
  if (!bag || typeof bag !== 'object') return
  const fontFamily = (bag as { fontFamily?: unknown }).fontFamily
  if (typeof fontFamily === 'string') for (const f of familiesInStack(fontFamily)) into.add(f)
}

/**
 * Which font families the design as imported actually refers to.
 *
 * Three places a reference can live, and all three matter because each is the
 * only home for a different real case:
 *
 *   - a style rule's own `fontFamily` (the editor's own styling);
 *   - a rule's responsive/state variants in `contextStyles` (a family used only
 *     at one breakpoint is still used);
 *   - raw CSS in the site's own stylesheet files, which is where a design that
 *     was written by hand rather than in the editor keeps its typography.
 *
 * A family named ONLY as a fallback (`"Inter", Helvetica`) counts as referenced
 * here. That is deliberate: matching CSS's own reading costs an occasional
 * unnecessary entry, while being cleverer risks dropping a family the site
 * genuinely falls back to.
 */
export function familiesReferencedBy(site: SiteLike): Set<string> {
  const found = new Set<string>()

  for (const rule of Object.values(site.styleRules ?? {})) {
    if (!rule || typeof rule !== 'object') continue
    const r = rule as { styles?: unknown; contextStyles?: unknown }
    collectFromStyleBag(r.styles, found)
    if (r.contextStyles && typeof r.contextStyles === 'object') {
      for (const context of Object.values(r.contextStyles as Record<string, unknown>)) {
        collectFromStyleBag(context, found)
      }
    }
  }

  for (const file of site.files ?? []) {
    const content = typeof file?.content === 'string' ? file.content : ''
    if (!content) continue
    // Both the declarations that USE a family and the @font-face blocks that
    // define one: a design shipping its own webfont names it only in the latter.
    for (const match of content.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
      for (const f of familiesInStack(match[1] ?? '')) found.add(f)
    }
  }

  return found
}

export interface FontReconciliation {
  fonts: SiteFontsSettings
  /** Families carried over from before the replace, for the import report. */
  restored: string[]
  /** Families that were dropped because the new design does not use them. */
  dropped: string[]
}

/**
 * Merge the pre-replace font registry into the imported one.
 *
 * Whatever the import installed wins: it is the current design's own copy of
 * that family, with that design's variants and subsets. Entries only come back
 * for a family the import did NOT install and the new design still names.
 *
 * Tokens come back on the same rule, and only when their family survives —
 * a token pointing at a `familyId` that no longer exists resolves to its bare
 * fallback stack, which is the unstyled result this whole function exists to
 * prevent.
 */
export function reconcileFonts(
  previous: SiteFontsSettings | null | undefined,
  imported: SiteLike,
): FontReconciliation {
  const importedFonts: SiteFontsSettings = imported.settings?.fonts ?? { items: [] }
  const previousItems = previous?.items ?? []
  if (previousItems.length === 0) {
    return { fonts: importedFonts, restored: [], dropped: [] }
  }

  const referenced = familiesReferencedBy(imported)
  const alreadyInstalled = new Set((importedFonts.items ?? []).map((item) => normalizeFamily(item.family)))

  const restoredItems: FontEntry[] = []
  const restored: string[] = []
  const dropped: string[] = []
  for (const item of previousItems) {
    const family = normalizeFamily(item.family)
    if (alreadyInstalled.has(family)) continue
    if (!referenced.has(family)) {
      dropped.push(item.family)
      continue
    }
    restoredItems.push(item)
    restored.push(item.family)
  }

  const keptIds = new Set([...(importedFonts.items ?? []), ...restoredItems].map((item) => item.id))
  const importedTokens = importedFonts.tokens ?? []
  const takenVariables = new Set(importedTokens.map((token) => token.variable))
  const restoredTokens: FontToken[] = (previous?.tokens ?? []).filter(
    (token) => keptIds.has(token.familyId ?? '') && !takenVariables.has(token.variable),
  )

  const tokens = [...importedTokens, ...restoredTokens]
  return {
    fonts: {
      items: [...(importedFonts.items ?? []), ...restoredItems],
      ...(tokens.length > 0 ? { tokens } : {}),
    },
    restored,
    dropped,
  }
}
