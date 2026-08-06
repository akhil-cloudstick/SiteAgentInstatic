/**
 * Shared tag vocabulary for the base.text module.
 *
 * Lives in its own non-component module so both the editor preview
 * (`TextEditor.tsx`, which must stay component-only for React Fast Refresh —
 * Constraint #309) and the registration/publisher path (`index.ts`) import
 * the same `normalizeTag` instead of each carrying a copy.
 */
type TextTag =
  | 'none'
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'span'
  | 'div'
  | 'small'
  | 'strong'
  | 'em'
  // `li` exists so a base.list child can be a real list item: <ul> may only
  // contain <li>, so without it a Text inside a List would emit invalid
  // markup (`<ul><p>…</p></ul>`).
  | 'li'

const TEXT_TAGS = new Set<TextTag>([
  'none',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'span',
  'div',
  'small',
  'strong',
  'em',
  'li',
])

export function normalizeTag(tag: unknown): TextTag {
  const value = String(tag || 'p').toLowerCase() as TextTag
  return TEXT_TAGS.has(value) ? value : 'p'
}
