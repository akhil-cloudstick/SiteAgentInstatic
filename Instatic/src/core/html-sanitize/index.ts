/**
 * HTML and URL sanitisation leaf.
 *
 * Pure helpers shared by publisher, markdown rendering, module render helpers,
 * and server-side HTML injection code. This module deliberately depends on
 * nothing in the publisher so lower-level renderers can use the same escaping
 * rules without pulling in the whole publishing engine.
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
}

/**
 * HTML-escape the five characters that are dangerous in HTML text and
 * attribute contexts. Non-strings are stringified for module render helpers
 * that receive prop values as unknown.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch])
}

/**
 * Data-image URIs that are safe as an `<img>` / media element `src`. Raster
 * formats can't carry script, and `image/svg+xml` loaded via `<img>` renders in
 * the browser's *secure static mode* (scripting + external refs disabled) — so
 * it is safe in that context, but NOT as a navigable `href`, where an SVG opens
 * as a top-level document and its scripts run. Callers therefore opt in with
 * `allowDataImages` ONLY for image/media `src` contexts, never for links.
 */
const SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/

export interface SafeUrlOptions {
  /**
   * Permit safe `data:image/*` URIs. Set only for image/media `src` attributes
   * (`<img>`, `<video poster>`, `<source>`) — matches the publisher CSP's
   * `img-src 'self' data:` allowance. Never set for `href`/`action`.
   */
  allowDataImages?: boolean
}

/**
 * Return true when a URL is safe for href/src/action attributes.
 * Blocks javascript:, vbscript:, and data: schemes after the same tab/newline
 * normalisation browsers apply during URL parsing. With `allowDataImages`, safe
 * `data:image/*` URIs are permitted (image/media `src` contexts only).
 */
export function isSafeUrl(url: string, opts: SafeUrlOptions = {}): boolean {
  const normalized = url.replace(/[\t\n\r]/g, '').trim().toLowerCase()
  if (opts.allowDataImages && SAFE_DATA_IMAGE_RE.test(normalized)) return true
  return (
    !normalized.startsWith('javascript:') &&
    !normalized.startsWith('vbscript:') &&
    !normalized.startsWith('data:')
  )
}

/**
 * Validate a URL and HTML-escape it for safe interpolation into an attribute.
 * Unsafe values collapse to "#". Pass `allowDataImages` for image/media `src`.
 */
export function safeUrl(value: unknown, opts: SafeUrlOptions = {}): string {
  const str = String(value ?? '')
  if (!isSafeUrl(str, opts)) return '#'
  return escapeHtml(str)
}
