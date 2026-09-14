/**
 * PageTemplateConfig — optional CMS template configuration on a Page.
 *
 * When present, the page is a template: it declares a `target` (everywhere, or
 * one/more post types) and matched content flows into its single `base.outlet`.
 * `priority` breaks ties when multiple templates compete at the same breadth
 * level. The resolver orders matching templates broadest → narrowest.
 *
 * Constraint #269: no imports from editor / editor-store here.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'

// ---------------------------------------------------------------------------
// TemplateTargetSchema
// ---------------------------------------------------------------------------

const TemplateTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal('everywhere') }),
  Type.Object({
    kind: Type.Literal('postTypes'),
    tableSlugs: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  }),
  /**
   * The site's 404 page. Never matched by route resolution — the public
   * router renders it (wrapped in the `everywhere` layout chain) whenever a
   * GET falls through every other route. Baked to `404.html` at publish time.
   */
  Type.Object({ kind: Type.Literal('notFound') }),
])
export type TemplateTarget = Static<typeof TemplateTargetSchema>

// ---------------------------------------------------------------------------
// PageTemplateConfigSchema
// ---------------------------------------------------------------------------

export const PageTemplateConfigSchema = Type.Object({
  enabled: Type.Literal(true),
  target: TemplateTargetSchema,
  /**
   * Falls back to 0 when missing or not a finite number —
   * handled in parsePageTemplate.
   */
  priority: Type.Number(),
})
export type PageTemplateConfig = Static<typeof PageTemplateConfigSchema>

// ---------------------------------------------------------------------------
// Tolerant parsing
// ---------------------------------------------------------------------------

/**
 * Read a stored `templateTarget` cell into a `TemplateTarget`.
 *
 * Accepts BOTH an object and a JSON string, because both are legitimately
 * stored shapes. The editor writes an object (`pageToCells`), but the `pages`
 * system table declares the field as `longText` — so a producer that honours
 * the declared field type serialises the target, while one that mirrors the
 * editor emits an object. Refusing the string made a conforming bundle import
 * cleanly and then 404 every entry: a target that fails to parse leaves
 * `page.template` unset, and the page never enters the matching chain.
 *
 * Exported so the admin grid and the MCP context tool read the cell the same
 * way the renderer does. Three readers disagreeing about the shape is how a
 * template ends up "missing" on one surface and present on another.
 */
export function parseTemplateTarget(raw: unknown): TemplateTarget | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return null
    try {
      // Deliberately a bare `JSON.parse` rather than `safeParseJson`: the
      // validation that matters is `parseTargetObject`, and routing the string
      // branch through TypeBox instead would make the two branches disagree —
      // `Value.Check` rejects a target whose `tableSlugs` holds one bad entry,
      // where the object branch filters it and keeps the rest. Two readers of
      // one cell that accept different inputs is the bug this function exists
      // to close, so both branches end in the same reader.
      //
      // One level only — a JSON string of a JSON string is a producer bug,
      // not a shape worth supporting.
      return parseTargetObject(JSON.parse(trimmed))
    } catch {
      // A `longText` cell holding prose rather than JSON. Not a template.
      return null
    }
  }
  return parseTargetObject(raw)
}

function parseTargetObject(raw: unknown): TemplateTarget | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.kind === 'everywhere') return { kind: 'everywhere' }
  if (r.kind === 'notFound') return { kind: 'notFound' }
  if (r.kind === 'postTypes') {
    const slugs = Array.isArray(r.tableSlugs)
      ? r.tableSlugs.filter((s): s is string => typeof s === 'string' && s.length > 0)
      : []
    return slugs.length > 0 ? { kind: 'postTypes', tableSlugs: slugs } : null
  }
  return null
}

/** Parse a PageTemplateConfig, providing a fallback for priority. */
export function parsePageTemplate(raw: unknown): PageTemplateConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.enabled !== true) return null
  const target = parseTemplateTarget(r.target)
  if (!target) return null
  const priority = typeof r.priority === 'number' && isFinite(r.priority) ? r.priority : 0
  return { enabled: true, target, priority }
}
