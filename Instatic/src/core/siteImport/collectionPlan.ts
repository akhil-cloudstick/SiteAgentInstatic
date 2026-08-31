/**
 * collectionPlan — decide which imported HTML files are Pages and which are
 * collection entries, from the folder layout alone.
 *
 * The import contract asks build output to put each collection in its own
 * folder:
 *
 *   dist/
 *     index.html                        → Page   /
 *     about-us/index.html               → Page   /about-us
 *     blog/
 *       index.html                      → Page   /blog       (the listing)
 *       best-gpus-2026/index.html       → Entry  /blog/best-gpus-2026
 *
 * Until now nothing read that layout. Every `.html` file became a Page and
 * `deriveSlug` flattened the nesting into the slug string, so a correctly
 * structured build still landed 189 posts in the flat Pages list — the exact
 * problem the folder rule exists to prevent. This module is the missing half:
 * it reads the layout and reports the collections it implies.
 *
 * It is deliberately pure and path-only. No bytes are read, no HTML is parsed,
 * and nothing here decides how an entry's body is extracted — that belongs to
 * the plan stage. Keeping classification separate means the rule that decides
 * "Page or entry" is one small function that can be reasoned about and tested
 * against a directory listing, which is how the disagreements about a delivery
 * actually get settled.
 *
 * ── The rules, in the order they apply ──────────────────────────────────────
 *
 *   1. `<folder>/<slug>/index.html`  → entry `<slug>` of collection `<folder>`
 *   2. `<folder>/index.html`         → Page (the listing — NOT an entry)
 *   3. anything at the top level     → Page
 *   4. anything deeper than rule 1   → Page, with a warning
 *
 * A folder only becomes a collection when it holds at least one entry. A
 * `blog/` containing nothing but its listing page is just a Page, which is what
 * makes the fallback safe: a flat build imports exactly as it does today.
 */

import { normalizePageSlug } from '@core/page-tree'
import type { ImportWarning } from './types'

// ---------------------------------------------------------------------------
// Reserved folder names
// ---------------------------------------------------------------------------

/**
 * Folder names that must never become a collection.
 *
 * `posts`, `pages`, `components` and `layouts` are the four system tables. A
 * folder named after one of them cannot be created as a new collection — the
 * slug is taken — and `posts` in particular is the built-in whose body is rich
 * text, so a designed page cannot be routed into it. Files under a reserved
 * folder fall back to Pages, which is lossless: the content still imports, it
 * simply keeps the flat behaviour rather than failing the whole run.
 *
 * `assets`, `images`, `fonts`, `css` and `js` are asset directories. They hold
 * no HTML in a well-formed build, but a stray `images/gallery/index.html` would
 * otherwise invent a collection called "images".
 */
const RESERVED_COLLECTION_FOLDERS = new Set([
  'posts',
  'pages',
  'components',
  'layouts',
  'admin',
  'api',
  'assets',
  'images',
  'img',
  'media',
  'fonts',
  'css',
  'js',
  'scripts',
  'styles',
])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CollectionEntryPlan {
  /** FileMap key of the entry's HTML file. */
  source: string
  /**
   * Entry slug within the collection — the folder name, normalised.
   * `blog/best-gpus-2026/index.html` → `best-gpus-2026`.
   */
  slug: string
  /**
   * The public path the entry will resolve at once the collection's entry
   * template exists: `<collection>/<slug>`. Recorded so link rewriting can
   * point at the same URL the flat import would have produced — moving a post
   * into a collection must not change where it serves.
   */
  publicSlug: string
}

export interface CollectionFolderPlan {
  /** Folder name as it appeared in the build, normalised to a slug. */
  slug: string
  /** Display name for the created table (`blog` → `Blog`). */
  name: string
  /**
   * FileMap key of `<folder>/index.html` when the build ships a listing page.
   * It stays a Page — it is the archive, not an entry — so it also appears in
   * `pagePaths`. Recorded here only so the caller can tell a collection with a
   * listing from one without.
   */
  listingSource: string | null
  entries: CollectionEntryPlan[]
}

export interface CollectionClassification {
  /** HTML paths that import as Pages, exactly as before. */
  pagePaths: string[]
  /** Collections implied by the folder layout. Empty for a flat build. */
  collections: CollectionFolderPlan[]
  warnings: ImportWarning[]
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Split HTML paths into Pages and collection entries.
 *
 * `htmlPaths` are FileMap keys. Order is preserved within each bucket so the
 * committed order matches the delivered order, which keeps import diffs
 * readable across revisions of the same build.
 */
export function classifyCollections(htmlPaths: readonly string[]): CollectionClassification {
  const pagePaths: string[] = []
  const warnings: ImportWarning[] = []

  /** folder slug → accumulating plan. Insertion-ordered. */
  const folders = new Map<string, CollectionFolderPlan>()
  /** folder slug → entry paths, held until we know the folder qualifies. */
  const candidateEntries = new Map<string, CollectionEntryPlan[]>()

  for (const path of htmlPaths) {
    const segments = splitPath(path)

    // Rule 3 — root `index.html` and any top-level file are Pages.
    if (segments.length <= 1) {
      pagePaths.push(path)
      continue
    }

    const isIndex = segments[segments.length - 1].toLowerCase() === 'index.html'

    // `<slug>.html` at any depth is not the nested form the contract asks for.
    // Rule 2 also lands here for `<folder>/index.html`.
    if (!isIndex) {
      if (segments.length > 2) {
        warnings.push(nestedWarning(path))
      }
      pagePaths.push(path)
      continue
    }

    // `<folder>/index.html` — Rule 2. A listing page, never an entry.
    if (segments.length === 2) {
      pagePaths.push(path)
      const folderSlug = normalizePageSlug(segments[0])
      if (folderSlug && !RESERVED_COLLECTION_FOLDERS.has(folderSlug)) {
        ensureFolder(folders, folderSlug).listingSource = path
      }
      continue
    }

    // `<folder>/<slug>/index.html` — Rule 1, the only entry shape.
    if (segments.length === 3) {
      const rawFolder = segments[0]
      const folderSlug = normalizePageSlug(rawFolder)
      const entrySlug = normalizePageSlug(segments[1])

      if (!folderSlug || !entrySlug) {
        pagePaths.push(path)
        continue
      }

      if (RESERVED_COLLECTION_FOLDERS.has(folderSlug)) {
        warnings.push(reservedWarning(path, folderSlug))
        pagePaths.push(path)
        continue
      }

      const entries = candidateEntries.get(folderSlug) ?? []
      entries.push({
        source: path,
        slug: entrySlug,
        publicSlug: `${folderSlug}/${entrySlug}`,
      })
      candidateEntries.set(folderSlug, entries)
      ensureFolder(folders, folderSlug)
      continue
    }

    // Rule 4 — deeper than one level. Import it rather than drop it, but say so.
    warnings.push(nestedWarning(path))
    pagePaths.push(path)
  }

  // A folder qualifies as a collection only if it actually holds entries. A
  // `blog/` with nothing but its listing page is a Page and nothing more —
  // this is what makes a flat build (rev 6 shape) import exactly as before.
  const collections: CollectionFolderPlan[] = []
  for (const [slug, folder] of folders) {
    const entries = candidateEntries.get(slug)
    if (!entries || entries.length === 0) continue
    folder.entries = entries
    collections.push(folder)
  }

  return { pagePaths, collections, warnings }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitPath(path: string): string[] {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
}

function ensureFolder(
  folders: Map<string, CollectionFolderPlan>,
  slug: string,
): CollectionFolderPlan {
  const existing = folders.get(slug)
  if (existing) return existing
  const created: CollectionFolderPlan = {
    slug,
    name: titleize(slug),
    listingSource: null,
    entries: [],
  }
  folders.set(slug, created)
  return created
}

/** `blog` → `Blog`, `case-studies` → `Case Studies`. */
function titleize(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function nestedWarning(path: string): ImportWarning {
  return {
    kind: 'collection-layout',
    message:
      `"${path}" is deeper than one level below its folder, so it imports as a Page ` +
      `rather than a collection entry. Collection entries must be exactly ` +
      `<collection>/<slug>/index.html.`,
    source: path,
  }
}

function reservedWarning(path: string, folderSlug: string): ImportWarning {
  return {
    kind: 'collection-layout',
    message:
      `"${folderSlug}/" is a reserved name, so "${path}" imports as a Page rather than ` +
      `a collection entry. Rename the folder — blog/, news/ and guides/ are all free.`,
    source: path,
  }
}
