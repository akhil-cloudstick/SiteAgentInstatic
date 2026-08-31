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
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { previewBundle, importBundle, exportBundle } from '../http/client'

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

/** Where exported bundles land. Configurable so it can point at shared storage. */
const EXPORT_DIR_ENV = 'MMS_CONNECTOR_EXPORT_DIR'

/** The manifest path inside a site bundle — the JSON everything else is derived from. */
const MANIFEST_PATH = '.instatic/site-bundle.json'

function exportDir(): string {
  const configured = process.env[EXPORT_DIR_ENV]?.trim()
  return configured ? resolve(configured) : resolve(import.meta.dir, '../../exports')
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
      'name. Never returns credentials. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () =>
      ok({ targets: describeTargets(), connected: connectedTargets() }),
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
        const name = await connect(
          typeof args.target === 'string' ? args.target : undefined,
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
      'plus totals for media and redirects. Writes nothing. Always run this before importing, ' +
      'because the counts are the only honest answer to "what is about to happen".',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        bundle: { type: 'object', description: 'A SiteBundle object.' },
      },
      required: ['bundle'],
      additionalProperties: false,
    },
    handler: async (args) =>
      guarded(async () => ok(await previewBundle(requireSession(typeof args.target === 'string' ? args.target : undefined), args.bundle))),
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
      'Download the current site as a bundle archive and report its size. Useful for capturing a ' +
      'canonical bundle shape, and for taking a content-level snapshot before an import. Note that ' +
      'a bundle export is NOT a rollback backup — it carries no version history, no published ' +
      'snapshot and no active-version pointers. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
      },
      additionalProperties: false,
    },
    handler: async (args) =>
      guarded(async () => {
        const name = typeof args.target === 'string' ? args.target : undefined
        const bytes = await exportBundle(requireSession(name))
        // Reporting a byte count and discarding the body left nothing to open or
        // diff. Write it down and hand back the path.
        const dir = exportDir()
        mkdirSync(dir, { recursive: true })
        const file = resolve(dir, `site-bundle-${name ?? 'target'}-${stamp()}.zip`)
        writeFileSync(file, bytes)
        const entries = Object.keys(unzipSync(bytes))
        return ok({
          path: file,
          bytes: bytes.length,
          entryCount: entries.length,
          hasManifest: entries.includes(MANIFEST_PATH),
          note: 'content-level artefact, not a rollback backup',
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
        limit: { type: 'number', description: 'Rows to return. Defaults to 200, capped at 1000. Ignored when rows="none".' },
        offset: { type: 'number', description: 'Rows to skip, for paging.' },
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

const MANIFEST_ROW_LIMIT_DEFAULT = 200
const MANIFEST_ROW_LIMIT_MAX = 1000

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
  const page = matching.slice(offset, offset + limit)

  return {
    ...manifest,
    rows: projection.rows === 'full' ? page : page.map(summariseRow),
    counts,
    rowsReturned: page.length,
    rowsTruncated: matching.length - offset - page.length,
    ...(projection.rows === 'summary'
      ? { note: 'Row cells omitted. Re-request with rows="full" plus a tableId and a small limit.' }
      : {}),
  }
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
