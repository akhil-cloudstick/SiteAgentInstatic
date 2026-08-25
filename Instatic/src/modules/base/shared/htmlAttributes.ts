import type { PropertyControl } from '@core/module-engine'
import {
  normalizeHtmlAttributeName,
  sanitizeRenderableHtmlAttribute,
} from '@core/htmlAttributes'
import { escapeHtml } from '@modules/base/utils/escape'

export const HtmlAttributesPropSchemaOptions = { default: {} } as const

export function htmlAttributesControl(): PropertyControl {
  return {
    type: 'group',
    label: 'HTML attributes',
    hidden: true,
    children: {},
  }
}

function normalizeHtmlAttributes(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const attrs: Record<string, string> = {}
  for (const [rawName, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rawValue !== 'string') continue
    const name = normalizeHtmlAttributeName(rawName)
    const safeValue = sanitizeRenderableHtmlAttribute(name, rawValue)
    if (safeValue === null) continue
    attrs[name] = safeValue
  }
  return attrs
}

export function htmlAttributesAttr(value: unknown): string {
  const attrs = normalizeHtmlAttributes(value)
  return Object.entries(attrs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, attrValue]) => ` ${name}="${escapeHtml(attrValue)}"`)
    .join('')
}

/**
 * HTML boolean attributes: presence alone means true, so the authored value is
 * either empty (`hidden=""`) or the attribute's own name (`hidden="hidden"`).
 * The importer harvests that verbatim as a string, which the publisher's string
 * emit renders correctly — but React types these as booleans and DROPS a falsy
 * value, so `hidden=""` silently disappears in the editor canvas.
 *
 * That asymmetry makes imported pages uneditable: a page that parks its
 * overlays behind `hidden` (nav scrim, drawer scrim, dialogs) renders them LIVE
 * on the canvas, and a `position: fixed; inset: 0` scrim then sits over the
 * whole document swallowing every click — so every selection resolves to that
 * overlay instead of the element under the cursor. Map presence → `true` so
 * React keeps the attribute and the canvas matches the published page.
 */
const HTML_BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls',
  'default', 'defer', 'disabled', 'formnovalidate', 'hidden', 'inert', 'ismap',
  'itemscope', 'loop', 'multiple', 'muted', 'nomodule', 'novalidate', 'open',
  'playsinline', 'readonly', 'required', 'reversed', 'selected',
])

function isBooleanAttributePresence(name: string, value: string): boolean {
  return (
    HTML_BOOLEAN_ATTRIBUTES.has(name) &&
    (value === '' || value.toLowerCase() === name)
  )
}

export function htmlAttributesForReact(value: unknown): Record<string, string | boolean> {
  const attrs = normalizeHtmlAttributes(value)
  const reactAttrs: Record<string, string | boolean> = {}
  for (const [name, attrValue] of Object.entries(attrs)) {
    reactAttrs[name] = isBooleanAttributePresence(name, attrValue) ? true : attrValue
  }
  return reactAttrs
}

/**
 * Same normalisation for the imperative `setAttribute` paths (the iframe
 * `<body>`), where a boolean attribute is expressed by setting it to the empty
 * string rather than by a `true` value.
 */
export function htmlAttributesForDom(value: unknown): Record<string, string> {
  return normalizeHtmlAttributes(value)
}
