/**
 * Full-access tools: read, create, edit, delete, publish.
 *
 * Every one of these reaches a live CMS. Two are irreversible in ways the tool
 * name does not convey, so they say so in their own descriptions rather than
 * relying on the caller having read a document:
 *
 *   - `connector_delete_row` removes content. There is no undo.
 *   - `connector_publish_row` and `connector_publish_site` make content public
 *     immediately, and the row handlers expose no previous-version activation
 *     route — so "unpublish" retracts the route, it does not restore prior
 *     content.
 *
 * Everything here is written to the activity log with its outcome, so an
 * unexpected change can be traced to the call that made it.
 */

import type { ConnectorTool, ToolResult } from './tools'
import { requireSession } from '../http/store'
import {
  listTables,
  listRows,
  getRow,
  createRow,
  updateRow,
  deleteRow,
  setRowStatus,
  publishRow,
  publishSite,
  publishStatus,
  withTableSlug,
} from '../http/rows'
import { GO_INPUT_PROP } from '../go/message'
import { currentRowsDigest, runGated, siteDigestReport } from './goTool'
import { currentDraftBundle, preflightRefusal, projectPublish } from './publishProjection'

const ok = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})

const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
  isError: true,
})

/**
 * Compare the routes the pre-flight predicted against the routes the publish
 * actually baked, and say so in the response (AC-C11.3).
 *
 * Until the bake reported its own routes, "the routes it predicted exist after
 * import" could only be checked by a person opening the site — the same
 * dependency R11 exists to remove. The comparison is reported rather than
 * enforced: it is evidence about a publish that has already happened, and the
 * disagreement worth acting on is a `missing` route, which means the prediction
 * promised a page the site does not have.
 */
function withRouteCheck(result: ToolResult, predicted: string[]): ToolResult {
  /**
   * Say the check did not run, rather than omitting it.
   *
   * All three ways out of this function used to return the publish result
   * untouched, so a caller reading "no `missing` routes" as "the routes agree"
   * read a check that never happened as a check that passed. The verification is
   * the point of AC-C11.3; silence is the one answer it must not give.
   */
  const notChecked = (why: string): ToolResult => {
    const first = result.content[0]
    if (!first || first.type !== 'text') return result
    try {
      return ok({ ...(JSON.parse(first.text) as Record<string, unknown>), routeCheck: { checked: false, why } })
    } catch {
      return result
    }
  }

  const first = result.content[0]
  if (!first || first.type !== 'text') return result
  try {
    const parsed = JSON.parse(first.text) as Record<string, unknown>
    // `runGated` wraps a gated result as { result, go, connector }.
    const body = (parsed.result ?? parsed) as Record<string, unknown>
    const baked = Array.isArray(body.bakedRoutes) ? (body.bakedRoutes as unknown[]).map(String) : null
    if (!baked) {
      return notChecked(
        'The publish did not report which routes it baked, so the predicted routes could not be ' +
          'compared against what actually landed. This is not a clean result — it is no result.',
      )
    }
    const bakedSet = new Set(baked)
    const predictedSet = new Set(predicted)
    return ok({
      ...parsed,
      routeCheck: {
        predicted: predicted.length,
        baked: baked.length,
        agrees: predicted.length === baked.length && predicted.every((p) => bakedSet.has(p)),
        /** Predicted but not baked — the prediction promised a page that is not there. */
        missing: predicted.filter((p) => !bakedSet.has(p)),
        /** Baked but not predicted — the site has pages the pre-flight did not foresee. */
        unexpected: baked.filter((b) => !predictedSet.has(b)),
      },
    })
  } catch (err) {
    return notChecked(
      `The publish response could not be read, so the route check did not run: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}

async function guarded(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn()
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export const CRUD_TOOLS: ConnectorTool[] = [
  {
    name: 'connector_list_tables',
    description:
      'List the content tables in the CMS — posts, pages, components, layouts and any custom ' +
      'tables — with their ids, kinds and field definitions. Read-only. Start here when you do ' +
      'not know a table id.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
      },
      additionalProperties: false,
    },
    handler: async (a) => guarded(async () => ok(await listTables(requireSession(str(a.target))))),
  },

  {
    name: 'connector_list_rows',
    description:
      'List rows in a table, paginated. Read-only. Returns summaries by default — id, slug, ' +
      'status, title and timestamps — because a full page row carries its entire body and a few ' +
      'hundred of them is gigabytes. Ask for fields="full" only when the body is actually needed, ' +
      'and keep the limit small when you do. Use connector_get_row for one row in full.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        tableId: { type: 'string', description: 'Table id or slug, e.g. posts, pages, components, layouts' },
        limit: { type: 'number', description: 'Rows per page. Defaults to 25, capped at 200.' },
        offset: { type: 'number', description: 'Rows to skip, for paging.' },
        fields: {
          type: 'string',
          enum: ['summary', 'full'],
          description:
            'summary (default) omits row bodies. full returns complete cells and can be very large.',
        },
      },
      required: ['tableId'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const session = requireSession(str(a.target))
        return ok(
          await withTableSlug(session, str(a.tableId), (tableId) =>
            listRows(session, tableId, {
              limit: typeof a.limit === 'number' ? a.limit : undefined,
              offset: typeof a.offset === 'number' ? a.offset : undefined,
              // Summary unless full is asked for by name. Defaulting the other way
              // is what made "list the posts" pull the whole site.
              fields: a.fields === 'full' ? 'full' : 'summary',
            }),
          ),
        )
      }),
  },

  {
    name: 'connector_get_row',
    description: 'Fetch one row in full, including all its field values. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        rowId: { type: 'string' },
      },
      required: ['rowId'],
      additionalProperties: false,
    },
    handler: async (a) => guarded(async () => ok(await getRow(requireSession(str(a.target)), str(a.rowId)))),
  },

  {
    name: 'connector_create_row',
    description:
      'Create a new row in a table — a post, page, component or layout. WRITES. The row is created ' +
      'as draft and is not publicly visible until published. `cells` holds the field values keyed ' +
      'by field id; use connector_list_tables to see which fields a table defines.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        tableId: { type: 'string' },
        slug: { type: 'string', description: 'URL slug. Generated from the title if omitted.' },
        cells: { type: 'object', description: 'Field values keyed by field id.' },
      },
      required: ['tableId'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const session = requireSession(str(a.target))
        return ok(
          await withTableSlug(session, str(a.tableId), (tableId) =>
            createRow(session, tableId, {
              slug: typeof a.slug === 'string' ? a.slug : undefined,
              cells: (a.cells as Record<string, unknown>) ?? {},
            }),
          ),
        )
      }),
  },

  {
    name: 'connector_update_row',
    description:
      'Update an existing row: change field values, or change its slug. WRITES. If the row is ' +
      'already published, the live version does NOT change until it is published again — the edit ' +
      'lands on the draft.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        rowId: { type: 'string' },
        slug: { type: 'string' },
        cells: { type: 'object', description: 'Field values to set, keyed by field id.' },
      },
      required: ['rowId'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () =>
        ok(
          await updateRow(requireSession(str(a.target)), str(a.rowId), {
            slug: typeof a.slug === 'string' ? a.slug : undefined,
            cells: (a.cells as Record<string, unknown>) ?? undefined,
          }),
        ),
      ),
  },

  {
    name: 'connector_delete_row',
    description:
      'DELETE a row. DESTRUCTIVE AND NOT REVERSIBLE — there is no undo and no trash. If the goal is ' +
      'to take a page off the site while keeping its content, use connector_set_row_status with ' +
      'unpublished instead: that retracts the public route and leaves the row intact. On a gated ' +
      'target it also requires go — an owner-signed GO for delete whose sha256 is ' +
      'connector_rows_digest of this row.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        rowId: { type: 'string' },
        go: GO_INPUT_PROP,
      },
      required: ['rowId'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const session = requireSession(str(a.target))
        const rowId = str(a.rowId)
        return runGated(a, 'delete', { kind: 'rows', session, rowIds: [rowId] }, () => deleteRow(session, rowId))
      }),
  },

  {
    name: 'connector_set_row_status',
    description:
      'Set a row to draft or unpublished. WRITES. Unpublishing retracts the public route while ' +
      'keeping the content — the reversible way to take something off the site. On a gated target ' +
      'it also requires go — an owner-signed GO for set-status-draft or set-status-unpublished ' +
      '(matching status) whose sha256 is connector_rows_digest of this row.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        rowId: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'unpublished'] },
        go: GO_INPUT_PROP,
      },
      required: ['rowId', 'status'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const session = requireSession(str(a.target))
        const rowId = str(a.rowId)
        const status = a.status === 'draft' ? ('draft' as const) : ('unpublished' as const)
        return runGated(a, `set-status-${status}`, { kind: 'rows', session, rowIds: [rowId] }, () =>
          setRowStatus(session, rowId, status),
        )
      }),
  },

  {
    name: 'connector_publish_row',
    description:
      'PUBLISH one row — it becomes publicly visible immediately. There is no previous-version ' +
      'rollback: unpublishing later retracts the route but does not restore earlier content. ' +
      'Confirm with the person asking before publishing anything you did not just create. On a ' +
      'gated target it also requires go — an owner-signed GO for publish-row whose sha256 is ' +
      'connector_rows_digest of this row, taken after its last edit.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        rowId: { type: 'string' },
        go: GO_INPUT_PROP,
      },
      required: ['rowId'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const session = requireSession(str(a.target))
        const rowId = str(a.rowId)
        return runGated(a, 'publish-row', { kind: 'rows', session, rowIds: [rowId] }, () => publishRow(session, rowId))
      }),
  },

  {
    name: 'connector_publish_site',
    description:
      'PUBLISH THE WHOLE SITE — builds the site snapshot and every page version, and takes the ' +
      'result live. This is the largest single action available here and affects every page at ' +
      'once. Requires a recent step-up authentication; if it fails with a step-up error, run ' +
      'connector_step_up first. On a gated target it also requires go — an owner-signed GO for ' +
      'publish whose sha256 is the bundle the most recent import under GO landed and whose ' +
      'contentDigest is the draft site hash (both from connector_site_digest). The CMS re-checks ' +
      'the draft hash itself after flushing in-flight edits, and refuses with 412 if it changed.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        go: GO_INPUT_PROP,
      },
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const session = requireSession(str(a.target))
        let predicted: string[] = []
        // The signed draft hash goes to the CMS as the publish precondition, so
        // an edit that lands after this check is still refused.
        const result = await runGated(
          a,
          'publish',
          { kind: 'site', session },
          (go) => publishSite(session, go?.contentDigest),
          {
            // R11 on the publish path. The import gate only ever sees a bundle,
            // and only a replace tells it the whole truth; a draft can also
            // reach this point through a merge import or through somebody
            // editing in the admin. This projects the draft as the CMS actually
            // holds it, so a site that would bake broken is stopped however its
            // content got there — and stopped before the approval is spent.
            before: async () => {
              const projection = projectPublish(await currentDraftBundle(session))
              predicted = projection.routes.map((r) => r.path)
              return preflightRefusal(projection, 'publish')
            },
          },
        )
        return result.isError ? result : withRouteCheck(result, predicted)
      }),
  },

  {
    name: 'connector_site_digest',
    description:
      'The two values a site-publish GO must name: sha256 — the bundle the most recent import under ' +
      'GO landed on this target — and contentDigest — the draft site hash as the CMS holds it now. ' +
      'Read-only. Take it after the between-steps check and immediately before the owner signs: any ' +
      'later change to the draft makes the publish refuse.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
      },
      additionalProperties: false,
    },
    handler: async (a) => guarded(async () => ok(await siteDigestReport(requireSession(str(a.target)), a))),
  },

  {
    name: 'connector_rows_digest',
    description:
      'The sha256 a GO must name for a row action (publish-row, set-status-draft, ' +
      'set-status-unpublished, delete): the rows digest of exactly these rows as the CMS holds them ' +
      'now — the same aggregate connector_hash_rows computes. Read-only. Take it after the last ' +
      'edit and immediately before the owner signs: any later change to these rows makes the GO ' +
      'refuse.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        rowIds: { type: 'array', items: { type: 'string' }, description: 'The rows the action will touch.' },
      },
      required: ['rowIds'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const rowIds = Array.isArray(a.rowIds) ? (a.rowIds as unknown[]).map(String) : []
        if (rowIds.length === 0) return fail('rowIds is empty.')
        return ok(await currentRowsDigest(requireSession(str(a.target)), rowIds))
      }),
  },

  {
    name: 'connector_publish_status',
    description:
      'Report whether the draft differs from what is currently published, and how many pages are ' +
      'live. Read-only. Worth checking before and after any publish.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
      },
      additionalProperties: false,
    },
    handler: async (a) => guarded(async () => ok(await publishStatus(requireSession(str(a.target))))),
  },
]
