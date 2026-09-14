/**
 * Write-capable tools.
 *
 * These reach a real CMS, so three rules apply that the read-only tools did not
 * need:
 *
 * 1. **No credentials in arguments.** The target and its login are configured on
 *    the server. A caller triggers actions against it; a caller never supplies a
 *    secret, because a secret passed as a tool argument has already travelled
 *    through the client and any transcript it keeps.
 *
 * 2. **Import stages, it does not publish.** Imported rows land without an active
 *    version, so nothing becomes publicly visible. That is what makes the result
 *    reviewable before it is live, and recoverable when it is wrong.
 *
 * 3. **`replace` is refused here.** It deletes every row, every non-system table,
 *    all media folders and all redirects before reinserting. It is valid only
 *    against a target verified empty, behind a step-up challenge — that belongs
 *    in a deliberate CLI run, not a conversational tool call.
 */

import type { ConnectorTool, ToolResult } from './tools'
import { connect, requireSession, connectedTargets, disconnect } from '../http/store'
import { describeTargets, targetNames } from '../http/config'
import { refreshManagedTargets, managedTargetsError } from '../http/managedTargets'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { previewBundle, importBundle, exportBundle } from '../http/client'
import { ensureExportDir, resolveExport, EXPORT_DOWNLOAD_PREFIX } from './exportStore'
import { resolveBundleSource } from './bundleSource'
import { callerRootUrl } from './requestContext'

const ok = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})

const fail = (message: string, detail?: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: message, detail }, null, 2) }],
  isError: true,
})

async function guarded(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn()
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
}

/** The manifest path inside a site bundle — the JSON everything else is derived from. */
const MANIFEST_PATH = '.instatic/site-bundle.json'

/** Media bytes live under this prefix inside a bundle archive. */
const MEDIA_PREFIX = 'media/'

/**
 * Whether an archive actually carries media, judged by its entries.
 *
 * This is how `includeMedia` is answered for an archive being re-read: the
 * request cannot say, because `includeMedia` is ignored on a continuation, and
 * the archive itself is the only thing that knows.
 */
function archiveHasMedia(entries: string[]): boolean {
  return entries.some((e) => e.startsWith(MEDIA_PREFIX))
}

/**
 * A fetchable address for an archive, or undefined when there is no caller to
 * address it to.
 *
 * Undefined rather than a loopback fallback: a URL pointing at 127.0.0.1 is
 * read as "the download is broken" by whoever tries it from another machine,
 * which is worse than the field simply not being there.
 */
function exportDownloadUrl(exportId: string): string | undefined {
  // Root, not origin: behind the gateway we are mounted at `/connector-mcp`,
  // and a URL built from the origin alone names a path the gateway does not
  // route — a real file, 404. Measured by the studio.
  const root = callerRootUrl()
  return root ? `${root}${EXPORT_DOWNLOAD_PREFIX}${encodeURIComponent(exportId)}` : undefined
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')
}

export const WRITE_TOOLS: ConnectorTool[] = [
  {
    name: 'connector_target',
    description:
      'List every configured CMS target and which of them currently have an open session. ' +
      'Use this first when more than one tenant is configured — every other tool needs a target ' +
      'name. A site you created with connector_create_site appears here by itself once its ' +
      'provisioning finishes (~30-60s); call this again rather than asking anyone to configure ' +
      'it. Never returns credentials. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      // Refreshed on the way in, so a site provisioned moments ago is listed
      // the first time anyone looks for it rather than after a restart.
      await refreshManagedTargets()
      const error = managedTargetsError()
      return ok({
        targets: describeTargets(),
        connected: connectedTargets(),
        ...(error ? { managedTargetRefresh: `not available: ${error}` } : {}),
      })
    },
  },

  {
    name: 'connector_connect',
    description:
      'Open a session against the configured CMS using the credentials held on the server. ' +
      'Supply mfaCode only if the account requires one. Must be called before any import tool.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        mfaCode: { type: 'string', description: 'Only if the account has MFA enabled.' },
      },
      additionalProperties: false,
    },
    handler: async (args) =>
      guarded(async () => {
        const wanted = typeof args.target === 'string' ? args.target : undefined
        // A name we do not know may be a site provisioned since this process
        // started. Refresh before refusing, so "unknown target" means it really
        // does not exist rather than that we have not looked recently.
        if (wanted && !targetNames().includes(wanted)) await refreshManagedTargets(true)
        const name = await connect(
          wanted,
          typeof args.mfaCode === 'string' ? args.mfaCode : undefined,
        )
        return ok({ connected: name, allTargets: targetNames() })
      }),
  },

  {
    name: 'connector_disconnect',
    description:
      'Drop a CMS session. Pass a target to drop just that one; omit it to drop every session.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const dropped = disconnect(typeof args.target === 'string' ? args.target : undefined)
      return ok({ disconnected: dropped, stillConnected: connectedTargets() })
    },
  },

  {
    name: 'connector_preview_import',
    description:
      'Dry run. Reports what an import WOULD change — per-table counts of rows added and replaced, ' +
      'plus totals for media and redirects, and unknownFields. Writes nothing. Always run this ' +
      'before importing, because the counts are the only honest answer to "what is about to ' +
      'happen". Name the bundle with uploadId (POST it to /imports first — this is the route for ' +
      'a bundle of any size), or pass it inline, or give a path on the server. Exactly one.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        bundle: { type: 'object', description: 'A SiteBundle object, inline. Only practical for small bundles.' },
        uploadId: {
          type: 'string',
          description:
            'A bundle already POSTed to /imports. Preferred: a real bundle is megabytes, which is ' +
            'hundreds of thousands of tokens as an inline argument. Works for ZIP and JSON uploads.',
        },
        path: { type: 'string', description: 'A site-bundle .zip on the SERVER filesystem.' },
        strategy: {
          type: 'string',
          enum: ['replace', 'merge-add', 'merge-overwrite'],
          description:
            'Which import this is rehearsing, and worth naming explicitly. Pass "replace" when ' +
            'previewing for connector_import_replace: that strategy wipes the site first, so its ' +
            'diff is taken against an empty target and slug conflicts against soon-to-be-deleted ' +
            'rows do not apply. Pass a merge strategy when previewing for connector_import_draft. ' +
            'Omitting it rehearses the CMS default, which is "replace" — the destructive one, not ' +
            'the conservative one.',
        },
      },
      additionalProperties: false,
    },
    handler: async (args) =>
      guarded(async () => {
        const session = requireSession(typeof args.target === 'string' ? args.target : undefined)
        const source = resolveBundleSource({
          bundle: args.bundle,
          path: typeof args.path === 'string' ? args.path : undefined,
          uploadId: typeof args.uploadId === 'string' ? args.uploadId : undefined,
        })
        if (!source.ok) return fail(source.reason)

        const strategy =
          args.strategy === 'replace' || args.strategy === 'merge-add' || args.strategy === 'merge-overwrite'
            ? args.strategy
            : undefined
        const preview = await previewBundle(session, source.value.bundle, strategy)
        return ok({
          ...(preview as Record<string, unknown>),
          bundleSource: source.value.source,
          // Counted from the archive rather than the manifest: in a ZIP the
          // media bytes are separate entries, and the preview only ever sees
          // the manifest. Reported so the number is visible rather than absent.
          ...(source.value.archive ? { mediaFilesInArchive: source.value.mediaFilesInArchive } : {}),
        })
      }),
  },

  {
    name: 'connector_import_draft',
    description:
      'Import a SiteBundle into the CMS as DRAFT content. This writes. It does not publish: ' +
      'imported rows have no active version, so nothing becomes publicly visible until a separate ' +
      'release step runs. Strategy is merge-overwrite (update existing, add missing) or merge-add ' +
      '(add missing only, never overwrite). Neither carries redirects — redirect import exists only ' +
      'in the replace path, which is not available here.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        bundle: { type: 'object', description: 'A SiteBundle object.' },
        strategy: {
          type: 'string',
          enum: ['merge-overwrite', 'merge-add'],
          description: 'Defaults to merge-overwrite.',
        },
      },
      required: ['bundle'],
      additionalProperties: false,
    },
    handler: async (args) =>
      guarded(async () => {
        const strategy =
          args.strategy === 'merge-add' ? ('merge-add' as const) : ('merge-overwrite' as const)
        return ok(await importBundle(requireSession(typeof args.target === 'string' ? args.target : undefined), args.bundle, strategy))
      }),
  },

  {
    name: 'connector_export_bundle',
    description:
      'Download the current site as a bundle archive. Useful for capturing a canonical bundle ' +
      'shape, and for taking a content-level snapshot before an import. Note that a bundle export ' +
      'is NOT a rollback backup — it carries no version history, no published snapshot and no ' +
      'active-version pointers. Read-only. ' +
      'EVERY response carries downloadUrl: fetch that with the same bearer token to get the whole ' +
      'archive in one piece. Prefer it. Inline base64 is bounded by your context — a 40 MB archive ' +
      'is roughly 13 million tokens and cannot be received at all — whereas downloadUrl has no ' +
      'size limit and needs no reassembly. Use deliver="path" plus downloadUrl to skip the base64 ' +
      'entirely. Pass includeMedia=false for a content-only archive, which is dramatically smaller ' +
      'and is usually what a pre-import snapshot needs. If you do read inline, a large archive is ' +
      'split across parts rather than refused: the response reports parts, nextPart, exportId and ' +
      'a sha256 of the WHOLE archive — request part=1..parts passing exportId each time, ' +
      'concatenate the decoded bytes in order, and verify the hash before relying on it.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        includeMedia: {
          type: 'boolean',
          description:
            'Include media bytes. Defaults to true. Set false for a content-only archive — much ' +
            'smaller, and enough to reconstruct rows, tables and redirects.',
        },
        deliver: {
          type: 'string',
          enum: ['inline', 'path'],
          description:
            'inline (default) base64-encodes the archive into the response as well as writing it ' +
            'to disk. path writes it to disk only — use when you are running on the same host.',
        },
        part: {
          type: 'number',
          description:
            'Which part of the archive to return, 1-based. Defaults to 1. A large archive is split ' +
            'across parts; the response reports parts, nextPart, exportId and a sha256 of the whole ' +
            'archive. Concatenate the decoded parts in order and verify the hash before relying on it.',
        },
        exportId: {
          type: 'string',
          description:
            'Continue reading an export already taken, instead of taking a new one. REQUIRED for ' +
            'part 2 onwards: a zip embeds timestamps, so a fresh export differs byte-for-byte and ' +
            'its parts will not reassemble with earlier ones. Use the exportId the first response ' +
            'returned. When set, target and includeMedia are ignored.',
        },
      },
      additionalProperties: false,
    },
    handler: async (args) =>
      guarded(async () => {
        const name = typeof args.target === 'string' ? args.target : undefined
        const continuing = typeof args.exportId === 'string' && args.exportId.trim() !== ''
        const requested = typeof args.part === 'number' ? Math.trunc(args.part) : 1

        // FIRST, before anything is exported.
        //
        // This guard used to sit after the export, after the `deliver: "path"`
        // return and after the range check — so on the path route it was never
        // reached at all, and on the inline route a single-part archive hit the
        // range check first and reported the wrong cause. A part-2 request with
        // no exportId therefore minted a fresh archive and handed back a slice
        // of it, which is precisely the unreassemblable pairing the guard
        // exists to prevent. Reported by the studio, reproduced three times.
        //
        // The ordering is the whole fix: a check that runs after the expensive,
        // state-creating step has already let the thing happen.
        if (requested > 1 && !continuing) {
          return fail(
            `part ${requested} needs the exportId of the archive part 1 came from. Without it this ` +
              'call would take a NEW export — a zip embeds timestamps, so its bytes differ and the ' +
              'parts will not reassemble. Request part 1 first, then pass the exportId it returns. ' +
              'No export was taken for this call.',
          )
        }

        const includeMediaRequested = args.includeMedia !== false
        const dir = ensureExportDir()

        // Continuing a multi-part read serves the ARCHIVE ALREADY WRITTEN, and
        // must never re-export. A zip embeds timestamps, so two exports of an
        // unchanged site differ byte-for-byte — measured, not assumed: the same
        // 2,053,204-byte site hashed 070105ee… and 44f736ba… on consecutive
        // runs. Re-exporting per part would hand back slices of different
        // archives that can never reassemble, and the whole-archive sha256
        // would change under the caller mid-read.
        let file: string
        let bytes: Uint8Array
        if (continuing) {
          const found = resolveExport((args.exportId as string).trim())
          if (!found.ok) return fail(found.reason)
          file = found.path
          bytes = new Uint8Array(readFileSync(file))
        } else {
          bytes = await exportBundle(requireSession(name), { includeMedia: includeMediaRequested })
          // Always written down: a path is useful on this host, and it is what
          // later parts are served from.
          file = resolve(dir, `site-bundle-${name ?? 'target'}-${stamp()}.zip`)
          writeFileSync(file, bytes)
        }
        const exportId = basename(file)
        const entries = Object.keys(unzipSync(bytes))

        // Read from the archive, never echoed from the request.
        //
        // `includeMedia` is ignored on a continuation, so echoing the argument
        // reported the parameter default — an archive taken with false read
        // back as true. This is provenance on the one artefact agreed to be the
        // only rollback material there is, so it has to describe the bytes in
        // hand rather than the call that fetched them. Same failure shape as
        // sha256Scope: a field that looks like it describes the artefact and
        // actually describes the request.
        const includeMedia = continuing ? archiveHasMedia(entries) : includeMediaRequested

        const base = {
          path: file,
          exportId,
          bytes: bytes.length,
          entryCount: entries.length,
          hasManifest: entries.includes(MANIFEST_PATH),
          includeMedia,
          includeMediaSource: continuing
            ? 'read from the archive contents'
            : 'as requested for this export',
          // The archive at an address the caller can actually fetch. Undefined
          // only outside a request context, where no caller-facing host exists
          // to name — better absent than pointing at this host's loopback.
          downloadUrl: exportDownloadUrl(exportId),
          note: 'content-level artefact, not a rollback backup',
        }

        if (args.deliver === 'path') return ok(base)

        // The path alone is useless to a caller on another machine — it names a
        // file on this host. Encoding the archive into the response is what makes
        // a pre-import snapshot something the sender can actually keep.
        //
        // Delivered in parts rather than under a size ceiling. A ceiling only
        // moves the cliff: measured on a real 398-page site, a content-only
        // archive is 5.2 MB and page trees compress at under 5x, so the next
        // site along lands back on "here is a path you cannot reach" at exactly
        // the moment a pre-import snapshot matters most.
        const totalParts = Math.max(1, Math.ceil(bytes.length / BUNDLE_PART_BYTES))
        if (requested < 1 || requested > totalParts) {
          return fail(`part ${requested} is out of range — this archive has ${totalParts} part(s).`, {
            ...base,
            parts: totalParts,
          })
        }
        const start = (requested - 1) * BUNDLE_PART_BYTES
        const slice = bytes.subarray(start, start + BUNDLE_PART_BYTES)

        return ok({
          ...base,
          delivered: 'inline',
          encoding: 'base64',
          // Hash of the WHOLE archive, not this part: the caller reassembles
          // from several responses and needs a way to prove it got them all,
          // in order, before trusting the result as rollback material.
          //
          // Scope is stated in the payload because the word "hash" hides two
          // different questions. This one answers "did the parts reassemble".
          // It cannot answer "has the content changed" — a zip embeds
          // timestamps, so an unchanged site re-exports to different bytes and
          // this digest moves with it. Anything binding an approval to content
          // must use `connector_hash_rows`, which digests canonical rows.
          sha256: createHash('sha256').update(bytes).digest('hex'),
          sha256Scope:
            'archive bytes — transfer integrity only. NOT a content identity: an unchanged site ' +
            're-exports to different bytes. Use connector_hash_rows for content identity.',
          parts: totalParts,
          part: requested,
          partBytes: slice.length,
          ...(requested < totalParts ? { nextPart: requested + 1 } : {}),
          ...(totalParts > 1
            ? {
                note:
                  `Archive split into ${totalParts} parts, ~${Math.round(
                    (bytes.length * 4) / 3 / 750,
                  ).toLocaleString()}k tokens in total if read inline. Fetching downloadUrl instead ` +
                  'is one request with no reassembly and no context cost — prefer it unless you ' +
                  `genuinely need the bytes in-band. To continue inline: exportId="${exportId}" ` +
                  `with part=2..${totalParts}. Passing exportId is what keeps every part from the ` +
                  'SAME archive. Concatenate the decoded bytes in order and check sha256.',
              }
            : {}),
          zipBase64: Buffer.from(slice).toString('base64'),
        })
      }),
  },

  {
    name: 'connector_export_manifest',
    description:
      'Export the site and return the bundle manifest itself — tables, rows, redirects — as JSON, ' +
      'rather than a zip on disk. This is the part worth diffing. Media bytes are omitted; use ' +
      'connector_export_bundle when the files are needed. Read-only. ' +
      'Rows come back as summaries by default, for the same reason connector_list_rows does: a ' +
      'page row carries its whole body, so a few hundred of them is tens of megabytes and a full ' +
      'manifest of a real site will not fit in one response. Ask for rows="full" only with a ' +
      'tableId and a small limit; use rows="none" when you only want the schema and counts.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        rows: {
          type: 'string',
          enum: ['none', 'summary', 'full'],
          description:
            'summary (default) omits row cells. none drops rows entirely and keeps tables + counts. ' +
            'full returns complete cells and can be very large.',
        },
        tableId: { type: 'string', description: 'Restrict rows to one table, e.g. pages. Tables and counts are unaffected.' },
        limit: {
          type: 'number',
          description:
            'Rows to return. Defaults to 200, capped at 1000, and further capped by a 4MB budget on the ' +
            'serialised rows — with rows="full" a page of large rows stops well short of the limit. ' +
            'When that happens the response carries nextOffset; resume from it.',
        },
        offset: { type: 'number', description: 'Rows to skip, for paging. Prefer the nextOffset the previous response returned.' },
      },
      additionalProperties: false,
    },
    handler: async (args) =>
      guarded(async () => {
        // Media bytes are pure weight here — the caller wants the manifest.
        const bytes = await exportBundle(
          requireSession(typeof args.target === 'string' ? args.target : undefined),
          { includeMedia: false },
        )
        const entry = unzipSync(bytes)[MANIFEST_PATH]
        if (!entry) {
          return fail(`Bundle contains no ${MANIFEST_PATH}`, Object.keys(unzipSync(bytes)))
        }
        const manifest = JSON.parse(strFromU8(entry)) as ExportedManifest
        return ok(
          projectManifest(manifest, {
            rows: args.rows === 'full' || args.rows === 'none' ? args.rows : 'summary',
            tableId: typeof args.tableId === 'string' ? args.tableId : undefined,
            limit: typeof args.limit === 'number' ? args.limit : undefined,
            offset: typeof args.offset === 'number' ? args.offset : undefined,
          }),
        )
      }),
  },
]

// ---------------------------------------------------------------------------
// Manifest projection
// ---------------------------------------------------------------------------

/**
 * Archive bytes per response part.
 *
 * Base64 inflates by a third, so this lands each response around 5.3 MB. The
 * archive is split rather than refused: measured on a real 398-page site a
 * content-only export is 5.2 MB zipped and page trees compress at under 5x, so
 * any single ceiling large enough for today is one site away from being too
 * small — and the failure lands on the pre-import snapshot, which is the one
 * moment the caller cannot afford to be handed an unreachable path.
 */
const BUNDLE_PART_BYTES = 4_000_000

const MANIFEST_ROW_LIMIT_DEFAULT = 200
const MANIFEST_ROW_LIMIT_MAX = 1000

/**
 * Ceiling on the serialised size of the rows in one response.
 *
 * A row count is not a size: 200 summaries are a few hundred KB and 200 full
 * page rows are tens of megabytes, which is the payload that killed the session
 * this projection exists to protect. A caller asking for `rows: "full"` with a
 * generous limit would otherwise walk straight back into the original bug — so
 * the byte budget, not the row count, is the real guard.
 */
const MANIFEST_ROW_BYTE_BUDGET = 4_000_000

interface ExportedManifestRow {
  id?: unknown
  tableId?: unknown
  slug?: unknown
  status?: unknown
  cells?: Record<string, unknown>
}

interface ExportedManifest {
  rows?: ExportedManifestRow[]
  tables?: unknown[]
  redirects?: unknown[]
  [key: string]: unknown
}

interface ManifestProjection {
  rows: 'none' | 'summary' | 'full'
  tableId?: string
  limit?: number
  offset?: number
}

/**
 * Narrow an exported manifest to something that fits in one tool response.
 *
 * The export itself is all-or-nothing — it returns every row with its full
 * cells, which for a few hundred page rows is tens of megabytes and large
 * enough to kill the session that asked. Projection happens here rather than
 * server-side because the bundle format is the export contract; what a *reader*
 * needs is a different question from what a re-import needs.
 *
 * `counts` is always reported, and `rowsTruncated` names what was dropped, so a
 * narrowed manifest can never be mistaken for a complete one.
 */
function projectManifest(manifest: ExportedManifest, projection: ManifestProjection): unknown {
  const allRows = Array.isArray(manifest.rows) ? manifest.rows : []
  const matching = projection.tableId
    ? allRows.filter((row) => row.tableId === projection.tableId)
    : allRows

  const counts = {
    tables: Array.isArray(manifest.tables) ? manifest.tables.length : 0,
    rows: allRows.length,
    rowsMatchingFilter: matching.length,
    redirects: Array.isArray(manifest.redirects) ? manifest.redirects.length : 0,
  }

  if (projection.rows === 'none') {
    const { rows: _rows, ...rest } = manifest
    return { ...rest, counts }
  }

  const offset = Math.max(0, projection.offset ?? 0)
  const limit = Math.min(Math.max(1, projection.limit ?? MANIFEST_ROW_LIMIT_DEFAULT), MANIFEST_ROW_LIMIT_MAX)
  const requested = matching.slice(offset, offset + limit)
  const projected = projection.rows === 'full' ? requested : requested.map(summariseRow)
  const { rows: page, stoppedForSize } = takeWithinByteBudget(projected)

  const nextOffset = offset + page.length
  const rowsTruncated = Math.max(0, matching.length - nextOffset)

  return {
    ...manifest,
    rows: page,
    counts,
    rowsReturned: page.length,
    rowsTruncated,
    // A caller paging through a large table needs the offset to resume from.
    // Deriving it from `offset + limit` is wrong whenever the byte budget cut
    // the page short, which is exactly when paging matters most.
    ...(rowsTruncated > 0 ? { nextOffset } : {}),
    ...(stoppedForSize
      ? {
          note:
            `Page cut short at ${MANIFEST_ROW_BYTE_BUDGET} bytes of rows, before the requested limit. ` +
            `Continue from offset ${nextOffset}.`,
        }
      : projection.rows === 'summary'
        ? { note: 'Row cells omitted. Re-request with rows="full" plus a tableId and a small limit.' }
        : {}),
  }
}

/**
 * Take rows until the serialised budget is spent.
 *
 * Always yields at least one row: a single row larger than the whole budget
 * still comes back, because an empty page is indistinguishable from "no more
 * rows" and would silently end a caller's paging loop early.
 */
function takeWithinByteBudget(rows: unknown[]): { rows: unknown[]; stoppedForSize: boolean } {
  const taken: unknown[] = []
  let bytes = 0

  for (const row of rows) {
    const size = JSON.stringify(row)?.length ?? 0
    if (taken.length > 0 && bytes + size > MANIFEST_ROW_BYTE_BUDGET) {
      return { rows: taken, stoppedForSize: true }
    }
    taken.push(row)
    bytes += size
  }
  return { rows: taken, stoppedForSize: false }
}

/** A row without its body: enough to diff ids, slugs and status across sites. */
function summariseRow(row: ExportedManifestRow): unknown {
  const title = row.cells?.title
  return {
    id: row.id,
    tableId: row.tableId,
    slug: row.slug,
    status: row.status,
    ...(typeof title === 'string' ? { title } : {}),
    cellKeys: Object.keys(row.cells ?? {}),
  }
}
