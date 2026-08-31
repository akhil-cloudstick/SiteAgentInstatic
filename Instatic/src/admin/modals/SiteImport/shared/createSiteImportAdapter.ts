/**
 * createSiteImportAdapter — wires the Super Import pipeline to the editor
 * store and the CMS media upload endpoint.
 *
 * Upload: POST /cms/api/cms/media (same endpoint as the media workspace).
 * Commit: calls useEditorStore.getState().mutateAllPagesAndSite in one
 *         atomic Mutative recipe → single Cmd+Z undo step.
 */

import type { SiteImportAdapter, SiteImportTransaction } from '@core/siteImport'
import { installCmsGoogleFont } from '@core/persistence/cmsFonts'
import {
  createCmsMediaFolder,
  listCmsMediaFolders,
  setCmsMediaAssetFolders,
  uploadCmsMediaAsset,
  type CmsMediaFolder,
} from '@core/persistence/cmsMedia'
import {
  createCmsDataRow,
  createCmsDataTable,
  getCmsDataTableBySlug,
} from '@core/persistence/cmsData'
import { getErrorMessage } from '@core/utils/errorMessage'
import { useEditorStore } from '@site/store/store'

/**
 * Fields every imported collection entry gets.
 *
 * `body` is the post itself — it flows into the entry template's
 * `base.outlet` at render time, which is what makes one template serve every
 * entry. The SEO pair is included because the publisher now reads row-level SEO;
 * without these fields every post would share one site-wide title and
 * description.
 */
const COLLECTION_ENTRY_FIELDS = [
  { id: 'title', label: 'Title', type: 'text' as const, builtIn: true },
  { id: 'slug', label: 'Slug', type: 'text' as const, builtIn: true },
  { id: 'body', label: 'Body', type: 'richText' as const, format: 'html' as const, builtIn: true },
  { id: 'featuredMedia', label: 'Featured image', type: 'media' as const, mediaKind: 'image' as const },
  { id: 'seoTitle', label: 'SEO title', type: 'text' as const },
  { id: 'seoDescription', label: 'SEO description', type: 'longText' as const },
]

interface AdapterCallbacks {
  /** Stable id for the upload session (for logging). */
  sessionId: string
  /** Called before each asset upload begins. */
  onUploadStart?(asset: { path: string }): void
  /** Called after each asset upload completes. */
  onUploadComplete?(asset: { path: string; url: string }): void
  /** Called before the atomic store commit. */
  onCommitStart?(): void
  /** Called after the atomic store commit succeeds. */
  onCommitComplete?(): void
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

function dirSegments(path: string): string[] {
  // Drop the filename and any trailing/leading slashes; return an ordered list
  // of folder names from root → leaf. Empty for files at the bundle root.
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  if (!dir) return []
  return dir.split('/').filter((s) => s.length > 0)
}

/**
 * In-memory cache of folder ids keyed by their full slash-delimited path
 * (`'assets'`, `'assets/img'`, …). Folders the user already has from
 * previous imports / manual uploads are matched against this index so a
 * second wizard run doesn't duplicate the tree.
 */
function buildFolderIndex(folders: ReadonlyArray<CmsMediaFolder>): Map<string, string> {
  const byId = new Map<string, CmsMediaFolder>()
  for (const f of folders) byId.set(f.id, f)

  // Resolve each folder's full path by walking parents.
  const cache = new Map<string, string>()
  function fullPath(id: string): string {
    const seen = new Set<string>()
    const parts: string[] = []
    let current: string | null = id
    while (current && !seen.has(current)) {
      seen.add(current)
      const entry = byId.get(current)
      if (!entry) break
      parts.unshift(entry.name)
      current = entry.parentId
    }
    return parts.join('/')
  }

  for (const f of folders) cache.set(fullPath(f.id), f.id)
  return cache
}

export function createSiteImportAdapter(opts: AdapterCallbacks): SiteImportAdapter {
  // Folder index is loaded lazily on the first `uploadAsset` that needs a
  // non-root folder, so a session that uploads only root-level files (or one
  // file) makes zero folder API calls.
  let folderIndex: Map<string, string> | null = null
  let folderIndexPromise: Promise<Map<string, string>> | null = null

  async function ensureFolderIndex(): Promise<Map<string, string>> {
    if (folderIndex) return folderIndex
    if (!folderIndexPromise) {
      folderIndexPromise = (async () => {
        const idx = buildFolderIndex(await listCmsMediaFolders())
        folderIndex = idx
        return idx
      })()
    }
    return folderIndexPromise
  }

  /**
   * Ensure every folder segment of `segments` exists, creating them
   * parent-first when missing. Returns the leaf folder id (or null when
   * `segments` is empty, meaning the asset lives at the media root).
   *
   * Mutates the folder index cache so subsequent calls for the same path
   * are O(1).
   */
  async function ensureFolderPath(segments: string[]): Promise<string | null> {
    if (segments.length === 0) return null
    const index = await ensureFolderIndex()

    let parentId: string | null = null
    let cumulative = ''
    for (const segment of segments) {
      cumulative = cumulative ? `${cumulative}/${segment}` : segment
      const cached = index.get(cumulative)
      if (cached) {
        parentId = cached
        continue
      }
      const folder = await createCmsMediaFolder({ name: segment, parentId })
      index.set(cumulative, folder.id)
      parentId = folder.id
    }
    return parentId
  }

  async function assignAssetToFolder(assetId: string, folderId: string): Promise<void> {
    try {
      await setCmsMediaAssetFolders(assetId, { add: [folderId] })
    } catch (err) {
      // Surface as a non-fatal log: the asset uploaded fine, only the
      // folder placement failed. The user can drag it to the right folder
      // by hand afterwards.
      console.warn(
        `[siteImportAdapter] Asset ${assetId} placed at the media root; ${getErrorMessage(err, 'folder assignment failed')}.`,
      )
    }
  }

  return {
    installGoogleFont(font) {
      return installCmsGoogleFont(font)
    },

    /**
     * Create a collection's table and its entry rows.
     *
     * Collections live behind the CMS data API rather than in the site
     * document, so this runs as its own async step outside the store
     * transaction — see the doc on `SiteImportAdapter.createCollection`.
     */
    async createCollection(collection) {
      // Reuse an existing table with the same slug. A second import of the
      // same build must update the collection, not create `blog-2` beside it.
      const existing = await getCmsDataTableBySlug(collection.slug)
      const table =
        existing ??
        (await createCmsDataTable({
          name: collection.name,
          slug: collection.slug,
          // `postType` (not `data`) because entries need their own public URLs —
          // that routing is exactly what the folder layout asked for.
          kind: 'postType',
          fields: COLLECTION_ENTRY_FIELDS,
        }))

      const createdEntries: { rowId: string; slug: string; title: string }[] = []
      const failedEntries: { slug: string; message: string }[] = []

      for (const entry of collection.entries) {
        try {
          // Created as a DRAFT: an import never publishes. `featuredImageSrc`
          // has already been rewritten to a media URL by `applyAssetRewrites`.
          // The row's public slug is denormalised from `cells.slug` by the
          // repository, so it is set there and nowhere else.
          const row = await createCmsDataRow(table.id, {
            cells: {
              title: entry.title,
              slug: entry.slug,
              body: entry.bodyHtml,
              ...(entry.featuredImageSrc ? { featuredMedia: entry.featuredImageSrc } : {}),
              ...(entry.seoTitle ? { seoTitle: entry.seoTitle } : {}),
              ...(entry.seoDescription ? { seoDescription: entry.seoDescription } : {}),
            },
          })
          createdEntries.push({ rowId: row.id, slug: entry.slug, title: entry.title })
        } catch (err) {
          // One bad entry must not cost the other 188. Record and continue —
          // `commitImportPlan` turns each failure into a warning naming the slug.
          failedEntries.push({ slug: entry.slug, message: getErrorMessage(err, 'row create failed') })
        }
      }

      return {
        slug: collection.slug,
        name: collection.name,
        tableId: table.id,
        reusedExistingTable: existing !== null,
        createdEntries,
        failedEntries,
      }
    },

    async uploadAsset({ path, bytes, mimeType }) {
      opts.onUploadStart?.({ path })
      // bytes comes from fflate/File APIs — always backed by a plain ArrayBuffer.
      // TypeScript's BlobPart constraint excludes SharedArrayBuffer; the cast is safe.
      const blobData: ArrayBuffer = bytes.slice().buffer as ArrayBuffer
      const file = new File([blobData], basename(path), { type: mimeType })
      // Content-hash dedup: a re-import (manual re-run or Share to CMS
      // re-share) reuses an existing byte-identical asset instead of cloning
      // it — see `acceptUploadedMedia`'s `dedupeByContentHash` doc.
      const asset = await uploadCmsMediaAsset(file, { dedupeByContentHash: true })

      // Place the asset under a folder that mirrors its source bundle path.
      // Folder creation happens lazily here so a flat bundle (every asset at
      // the root) makes zero folder API calls. Failures inside
      // `ensureFolderPath` propagate up — the surrounding `commitImportPlan`
      // catches them per-asset and continues, so a folder API blip never
      // strands later uploads.
      const segments = dirSegments(path)
      if (segments.length > 0) {
        const folderId = await ensureFolderPath(segments)
        if (folderId) await assignAssetToFolder(asset.id, folderId)
      }

      opts.onUploadComplete?.({ path, url: asset.publicPath })
      return asset.publicPath
    },

    async commit(recipe) {
      opts.onCommitStart?.()
      const ok = useEditorStore.getState().mutateAllPagesAndSite((_site, helpers) => {
        const tx: SiteImportTransaction = {
          addPage: (input) => helpers.addPage(input),
          addStyleRule: (rule) => helpers.addStyleRule(rule),
          overwritePage: (id, input) => helpers.overwritePage(id, input),
          overwriteStyleRule: (id, rule) => helpers.overwriteStyleRule(id, rule),
          addConditions: (conditions) => helpers.addConditions(conditions),
          addFonts: (fonts) => helpers.addFonts(fonts),
          addInstalledFonts: (fonts) => helpers.addInstalledFonts(fonts),
          addFontTokens: (tokens) => helpers.addFontTokens(tokens),
          overwriteFontTokens: (items) => helpers.overwriteFontTokens(items),
          addColorTokens: (colors) => helpers.addColorTokens(colors),
          overwriteColorTokens: (items) => helpers.overwriteColorTokens(items),
          addScripts: (scripts) => helpers.addScripts(scripts),
          addStylesheets: (stylesheets) => helpers.addStylesheets(stylesheets),
          createVisualComponent: (input) => helpers.createVisualComponent(input),
          upsertEverywhereTemplate: (input) => helpers.upsertEverywhereTemplate(input),
        }
        recipe(tx)
        return true
      })
      if (!ok) {
        throw new Error('[siteImportAdapter] Commit failed: editor store rejected the mutation')
      }
      opts.onCommitComplete?.()
    },
  }
}
