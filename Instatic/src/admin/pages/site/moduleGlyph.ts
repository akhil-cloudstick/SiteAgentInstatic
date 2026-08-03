/**
 * Font Awesome glyph for a page section, for the Page outline rows.
 *
 * The approved screen draws each section with a glyph that matches what the
 * section *is* (a burger for Header, an image for Hero, scissors for Services)
 * rather than the generic block icon the Layers tree shows. Module ids are the
 * strong signal; where a page is built from plain containers — which is the
 * common case for an imported site — the section's own name is the only thing
 * that distinguishes Header from Footer, so the label is the fallback.
 *
 * Unrecognised sections get the neutral square the reference uses for a
 * freshly inserted "New section", never a wrong-but-confident glyph.
 */

/** Module id → glyph, for modules whose identity is unambiguous. */
const BY_MODULE_ID: Record<string, string> = {
  'base.image': 'image',
  'base.text': 'align-left',
  'base.button': 'square',
  'base.form': 'envelope',
  'base.loop': 'repeat',
  'base.video': 'video',
  'base.divider': 'minus',
  'base.icon': 'star',
  'base.visual-component-ref': 'cube',
}

/** Name fragment → glyph, matched against the section's display name. */
const BY_NAME: ReadonlyArray<[RegExp, string]> = [
  [/head|nav|menu|top ?bar/i, 'bars'],
  [/hero|banner|masthead/i, 'image'],
  [/benefit|feature|why|value/i, 'star'],
  [/service|offer|treatment|pricing|plan/i, 'scissors'],
  [/testimonial|review|quote|client/i, 'quote-left'],
  [/contact|enquir|inquir|book|appointment/i, 'envelope'],
  [/foot/i, 'table-cells-large'],
  [/gallery|photo|image/i, 'images'],
  [/about|story|team/i, 'users'],
  [/faq|question/i, 'circle-question'],
  [/cta|call ?to ?action/i, 'bullhorn'],
]

export function moduleGlyph(moduleId: string, label: string): string {
  const byId = BY_MODULE_ID[moduleId]
  if (byId) return byId

  for (const [pattern, glyph] of BY_NAME) {
    if (pattern.test(label)) return glyph
  }
  return 'square'
}
