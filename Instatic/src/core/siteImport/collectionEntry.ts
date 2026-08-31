/**
 * collectionEntry — pull an entry's content out of a converted HTML page, and
 * derive the shared entry template from the same page.
 *
 * A collection entry is not a designed page. Its `body` cell is text, and the
 * design comes from ONE template whose `base.outlet` the body flows into
 * (see `effectiveNodeBindings` in `@core/templates/dynamicBindings`). So
 * splitting a folder of converted posts into a collection means answering two
 * questions per file:
 *
 *   1. which part of this page is the post, and which part is the chrome?
 *   2. what does the chrome look like, once the post is lifted out of it?
 *
 * Both are answered here, from the same parse:
 *
 *   `extractEntryContent`  → the post: title, body HTML, image, SEO
 *   `makeTemplateSource`   → the chrome: the same document with the post's
 *                            region replaced by a single outlet marker
 *
 * Deriving the template from a REAL entry rather than generating a blank one is
 * deliberate. The converted pages already carry the header, nav, footer and
 * article styling the build was accepted with; a generated title-and-outlet
 * template would publish 189 posts that look nothing like the delivery and put
 * the design work back on a person. Taking entry #1 and cutting its content out
 * keeps everything that surrounds the post exactly as delivered.
 *
 * The marker survives `importHtml` because safe authored attributes are
 * preserved as `props.htmlAttributes` (see `walkAndMap`), so the caller can
 * find the marked node in the built tree and swap it for `base.outlet`.
 */

import { parseHtml } from '@core/htmlImport/parseHtml'

/** Attribute the outlet placeholder carries through `importHtml`. */
export const OUTLET_MARKER_ATTR = 'aria-label'

/**
 * Value the placeholder carries in `aria-label`.
 *
 * ARIA attributes survive `walkAndMap` as `props.htmlAttributes`; `data-*` does
 * not, and an element with neither attributes the walker keeps nor any content
 * is pruned outright. So the marker is an ARIA-labelled element WITH text —
 * both properties are load bearing. A marker that survives neither leaves the
 * collection with no template, which is the 404-on-every-entry case.
 */
export const OUTLET_MARKER_VALUE = 'instatic-entry-outlet'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntryContent {
  /** `<h1>` text, else `<title>`, else the slug prettified by the caller. */
  title: string
  /** Inner HTML of the content region — becomes the entry's `body` cell. */
  bodyHtml: string
  /** `og:image` or the first image inside the content region, unresolved. */
  featuredImageSrc: string | null
  seoTitle: string | null
  seoDescription: string | null
}

// ---------------------------------------------------------------------------
// Content-region detection
// ---------------------------------------------------------------------------

/**
 * Selectors tried in order to find the region holding the post itself.
 *
 * An explicit opt-in wins outright, then the semantic elements the contract's
 * own cookbook produces. Everything here is a single region by definition —
 * `querySelector`, not `querySelectorAll` — because a post has one body.
 */
const CONTENT_SELECTORS = [
  '[data-instatic-content]',
  'article',
  'main',
  '[role="main"]',
  '.post-content',
  '.entry-content',
  '.article-content',
  '.prose',
] as const

/**
 * Find the element holding the post.
 *
 * Returns null when nothing matches, which is a real outcome rather than a
 * failure: a page with no discernible content region should stay a Page rather
 * than become an entry whose body is the whole document including its own nav.
 */
export function findContentRoot(doc: Document): Element | null {
  for (const selector of CONTENT_SELECTORS) {
    const found = doc.querySelector(selector)
    if (found && textLength(found) > 0) return found
  }
  return null
}

// ---------------------------------------------------------------------------
// Entry content
// ---------------------------------------------------------------------------

/**
 * Extract one entry's content from its converted HTML.
 *
 * Returns null when no content region can be identified — the caller then
 * leaves the file as a Page. Failing to a Page is always safe; guessing a body
 * is not, because a wrong guess silently duplicates the site chrome inside
 * every post and only shows up after publish.
 */
export function extractEntryContent(htmlSource: string): EntryContent | null {
  const doc = safeParse(htmlSource)
  if (!doc) return null

  const contentRoot = findContentRoot(doc)
  if (!contentRoot) return null

  // Title: the post's own heading beats the document title, which on a
  // converted page usually carries the site name as a suffix.
  const heading = contentRoot.querySelector('h1') ?? doc.querySelector('h1')
  const documentTitle = doc.querySelector('title')?.textContent?.trim() ?? ''
  const title = (heading?.textContent?.trim() || documentTitle || '').replace(/\s+/g, ' ')

  // Lift the body out. The heading is removed from the body when it became the
  // title, so the template can render the title itself without it appearing
  // twice on the published page.
  const working = contentRoot.cloneNode(true) as Element
  if (heading && contentRoot.contains(heading)) {
    const clonedHeading = working.querySelector('h1')
    if (clonedHeading && clonedHeading.textContent?.trim() === heading.textContent?.trim()) {
      clonedHeading.remove()
    }
  }

  const firstImage = working.querySelector('img')
  const featuredImageSrc =
    metaContent(doc, 'property', 'og:image') ??
    firstImage?.getAttribute('src') ??
    null

  return {
    title,
    bodyHtml: working.innerHTML.trim(),
    featuredImageSrc,
    seoTitle:
      metaContent(doc, 'property', 'og:title') ??
      (documentTitle || null),
    seoDescription:
      metaContent(doc, 'name', 'description') ??
      metaContent(doc, 'property', 'og:description'),
  }
}

// ---------------------------------------------------------------------------
// Template source
// ---------------------------------------------------------------------------

/**
 * Rewrite an entry's HTML into the collection's template: the same document
 * with the content region emptied and a single outlet marker put in its place.
 *
 * The marker is an empty `<div>` carrying `data-instatic-outlet`. It survives
 * `importHtml` as a `base.container` with that attribute in
 * `props.htmlAttributes`, so the plan stage can locate it and swap the node's
 * module for `base.outlet` — the hole every entry's body renders into.
 *
 * Returns null when the document has no identifiable content region, matching
 * `extractEntryContent` so the two never disagree about whether a file can be
 * an entry.
 */
export function makeTemplateSource(htmlSource: string): string | null {
  const doc = safeParse(htmlSource)
  if (!doc) return null

  const contentRoot = findContentRoot(doc)
  if (!contentRoot) return null

  // Keep the content root itself — it carries the article's width, padding and
  // typography classes. Only its CHILDREN are replaced, so the outlet inherits
  // the exact box the post used to occupy.
  contentRoot.innerHTML = ''
  const marker = doc.createElement('div')
  marker.setAttribute(OUTLET_MARKER_ATTR, OUTLET_MARKER_VALUE)
  marker.textContent = OUTLET_MARKER_VALUE
  contentRoot.appendChild(marker)

  const root = doc.documentElement
  return root ? root.outerHTML : null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function metaContent(doc: Document, attr: 'name' | 'property', value: string): string | null {
  const el = doc.querySelector(`meta[${attr}="${value}"]`)
  const content = el?.getAttribute('content')?.trim()
  return content ? content : null
}

function textLength(el: Element): number {
  return (el.textContent ?? '').trim().length
}

/**
 * Parse guarded by DOMParser availability.  is bundled for the
 * browser and must not statically import happy-dom, so a headless caller
 * without a DOM polyfill gets null and the file stays a Page rather than
 * throwing mid-import.
 */
function safeParse(htmlSource: string): Document | null {
  if (typeof DOMParser === 'undefined') return null
  try {
    return parseHtml(htmlSource)
  } catch {
    return null
  }
}
