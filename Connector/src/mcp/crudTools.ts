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
} from '../http/rows'

const ok = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})

const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
  isError: true,
})

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
        tableId: { type: 'string', description: 'e.g. posts, pages, components, layouts' },
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
      guarded(async () =>
        ok(
          await listRows(requireSession(str(a.target)), str(a.tableId), {
            limit: typeof a.limit === 'number' ? a.limit : undefined,
            offset: typeof a.offset === 'number' ? a.offset : undefined,
            // Summary unless full is asked for by name. Defaulting the other way
            // is what made "list the posts" pull the whole site.
            fields: a.fields === 'full' ? 'full' : 'summary',
          }),
        ),
      ),
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
      guarded(async () =>
        ok(
          await createRow(requireSession(str(a.target)), str(a.tableId), {
            slug: typeof a.slug === 'string' ? a.slug : undefined,
            cells: (a.cells as Record<string, unknown>) ?? {},
          }),
        ),
      ),
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
      'unpublished instead: that retracts the public route and leaves the row intact.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        rowId: { type: 'string' },
      },
      required: ['rowId'],
      additionalProperties: false,
    },
    handler: async (a) => guarded(async () => ok(await deleteRow(requireSession(str(a.target)), str(a.rowId)))),
  },

  {
    name: 'connector_set_row_status',
    description:
      'Set a row to draft or unpublished. WRITES. Unpublishing retracts the public route while ' +
      'keeping the content — the reversible way to take something off the site.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        rowId: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'unpublished'] },
      },
      required: ['rowId', 'status'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () =>
        ok(
          await setRowStatus(
            requireSession(str(a.target)),
            str(a.rowId),
            a.status === 'draft' ? 'draft' : 'unpublished',
          ),
        ),
      ),
  },

  {
    name: 'connector_publish_row',
    description:
      'PUBLISH one row — it becomes publicly visible immediately. There is no previous-version ' +
      'rollback: unpublishing later retracts the route but does not restore earlier content. ' +
      'Confirm with the person asking before publishing anything you did not just create.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
        rowId: { type: 'string' },
      },
      required: ['rowId'],
      additionalProperties: false,
    },
    handler: async (a) => guarded(async () => ok(await publishRow(requireSession(str(a.target)), str(a.rowId)))),
  },

  {
    name: 'connector_publish_site',
    description:
      'PUBLISH THE WHOLE SITE — builds the site snapshot and every page version, and takes the ' +
      'result live. This is the largest single action available here and affects every page at ' +
      'once. Requires a recent step-up authentication; if it fails with a step-up error, run ' +
      'connector_step_up first.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Which configured CMS. Required when more than one is configured.' },
      },
      additionalProperties: false,
    },
    handler: async (a) => guarded(async () => ok(await publishSite(requireSession(str(a.target))))),
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
