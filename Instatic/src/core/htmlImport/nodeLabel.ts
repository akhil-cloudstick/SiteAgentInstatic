/**
 * deriveNodeLabel — resolve the layer name for an imported element.
 *
 * Without this, every imported `<div>`/`<section>` becomes a `base.container`
 * with no `label`, so `getNodeDisplayName` falls back to the module registry
 * name and the Layers panel reads "Container" for the whole page. That is
 * unusable for a human scanning the tree — and actively dangerous for the AI
 * agent, which addresses nodes by name and cannot tell the hero from the
 * footer when forty rows share one label.
 *
 * The source HTML already carries the name; we just have to read it. Signals,
 * in priority order (first non-empty wins):
 *
 *   1. `data-layer="…"`  — explicit authored name, always wins
 *   2. first meaningful class — `class="hero"` → "Hero", `hero-title` → "Hero
 *      Title". Layout plumbing (`container`, `wrapper`, `row`), state hooks
 *      (`is-open`, `js-toggle`) and utility classes (`mt-4`) are skipped.
 *   3. `id`             — `<section id="products">` → "Products"
 *   4. `aria-label`     — `<nav aria-label="Primary">` → "Primary"
 *   5. semantic tag     — `<header>` → "Header", `<footer>` → "Footer"
 *
 * Returns `undefined` when the element carries no naming signal at all (a bare
 * `<div>`), which leaves the module name in place — an honest "Container" is
 * better than an invented one.
 *
 * This runs for every element the walker maps, not just top-level sections, so
 * nested blocks (`hero-actions`, `card-title`) are named too.
 */

/** Tags whose own name says more than the module name does. */
const SEMANTIC_TAG_LABELS: Record<string, string> = {
  header: 'Header',
  footer: 'Footer',
  nav: 'Nav',
  main: 'Main',
  aside: 'Aside',
  section: 'Section',
  article: 'Article',
  form: 'Form',
  figure: 'Figure',
  figcaption: 'Caption',
  ul: 'List',
  ol: 'List',
  li: 'List item',
  table: 'Table',
}

/**
 * Class names that describe layout plumbing rather than what the block *is*.
 * `class="container hero"` must resolve to "Hero", not "Container" — the very
 * label this module exists to get rid of.
 */
const GENERIC_CLASS_NAMES = new Set([
  'container',
  'wrapper',
  'wrap',
  'inner',
  'outer',
  'row',
  'col',
  'column',
  'columns',
  'grid',
  'flex',
  'box',
  'block',
  'content',
  'item',
  'items',
  'group',
  'stack',
  'holder',
  'section',
  'div',
  'main',
  'body',
  'area',
  'panel',
  'left',
  'right',
  'top',
  'bottom',
  'center',
  'centre',
  'middle',
  'clearfix',
  'active',
  'open',
  'closed',
  'show',
  'hide',
  'hidden',
  'visible',
  'small',
  'large',
  'dark',
  'light',
  'full',
  'half',
])

/** Behavior / state / utility hooks — never the block's identity. */
const NON_NAME_CLASS_PATTERNS: ReadonlyArray<RegExp> = [
  /^(is|has|js|u|no)-/i, // state + behavior hooks: is-open, js-toggle, u-hidden
  /^_/, // private/utility convention
  /\d/, // utility scales: mt-4, text-5xl, col-6, gap-2
  /[:/[\]]/, // utility variants: md:flex, w-1/2, [mask]
]

const MAX_LABEL_LENGTH = 40

/**
 * "hero-title" / "hero__title" / "heroTitle" → "Hero Title".
 * Returns '' when nothing printable survives.
 */
function humanize(raw: string): string {
  const spaced = raw
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  if (!spaced) return ''
  const titled = spaced
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
  return titled.length > MAX_LABEL_LENGTH ? titled.slice(0, MAX_LABEL_LENGTH).trim() : titled
}

/** True when the class name names the block rather than styling or state. */
function isMeaningfulClassName(name: string): boolean {
  if (name.length < 2) return false
  if (GENERIC_CLASS_NAMES.has(name.toLowerCase())) return false
  return !NON_NAME_CLASS_PATTERNS.some((pattern) => pattern.test(name))
}

function attrValue(el: Element, name: string): string {
  return (el.getAttribute(name) ?? '').trim()
}

export function deriveNodeLabel(el: Element): string | undefined {
  const explicit = humanize(attrValue(el, 'data-layer'))
  if (explicit) return explicit

  for (const className of Array.from(el.classList)) {
    if (!isMeaningfulClassName(className)) continue
    const fromClass = humanize(className)
    if (fromClass) return fromClass
  }

  const fromId = humanize(attrValue(el, 'id'))
  if (fromId) return fromId

  // aria-label is human prose already — title-casing it would mangle a real
  // sentence, so only the length cap applies.
  const ariaLabel = attrValue(el, 'aria-label').replace(/\s+/g, ' ')
  if (ariaLabel) {
    return ariaLabel.length > MAX_LABEL_LENGTH
      ? ariaLabel.slice(0, MAX_LABEL_LENGTH).trim()
      : ariaLabel
  }

  return SEMANTIC_TAG_LABELS[el.tagName.toLowerCase()]
}
