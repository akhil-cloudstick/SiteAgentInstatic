/**
 * Shared text-normalisation for the HTML importer.
 *
 * Source HTML is pretty-printed: an `<a>` or `<p>` often spans several lines
 * with leading indentation, so its `textContent` carries newlines and runs of
 * spaces (`"\n      instatic"`, `"The Club\n  is how…"`). The browser collapses
 * that whitespace when rendering, so storing it verbatim would surface stray
 * leading spaces / line breaks in the editor's text fields.
 *
 * `normalizeImportedText` mirrors the browser's whitespace collapsing: runs of
 * any whitespace become a single space, and the result is trimmed.
 *
 * Lives in its own module so both `rules.ts` (element → text/label props) and
 * `walkAndMap.ts` (bare text nodes) can share it without an import cycle.
 */
export function normalizeImportedText(raw: string, preserveEdges = false): string {
  const collapsed = raw.replace(/\s+/g, ' ')
  // Inline phrasing (span/strong/em/…) sits next to other inline content, so a
  // single leading/trailing space is SIGNIFICANT — trimming it merges words like
  // "delivery more" + "joyful" → "morejoyful". Keep the edge space for those; block
  // elements (h1–h6, p, …) still trim, where edge whitespace is insignificant.
  return preserveEdges ? collapsed : collapsed.trim()
}
