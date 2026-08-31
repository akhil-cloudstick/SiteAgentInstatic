/**
 * Schema, media, bulk and session-elevation tools.
 *
 * Everything here existed in the CMS already and was simply unreachable through
 * the connector. The gaps were not theoretical: adding an SEO field meant
 * editing by hand, and removing several hundred rows meant several hundred
 * calls.
 */

import { readFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import type { ConnectorTool, ToolResult } from './tools'
import { requireSession } from '../http/store'
import { resolveTarget } from '../http/config'
import { deleteRow } from '../http/rows'
import {
  stepUp,
  getTable,
  createTable,
  addTableFields,
  uploadMedia,
  listMedia,
  type DataField,
} from '../http/admin'

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

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const targetProp = {
  type: 'string',
  description: 'Which configured CMS. Required when more than one is configured.',
} as const

/** Extension → MIME, for the handful of types a site actually uploads. */
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

/**
 * The SEO fields a site needs to keep its indexed URLs, none of which exist in
 * the stock schema. Shared here so `pages` and `posts` get an identical set —
 * two nearly-identical hand-written lists would drift.
 */
export const SEO_FIELDS: DataField[] = [
  { id: 'canonicalUrl', type: 'url', label: 'Canonical URL' },
  { id: 'ogTitle', type: 'text', label: 'Open Graph title' },
  { id: 'ogDescription', type: 'longText', label: 'Open Graph description' },
  { id: 'ogImage', type: 'media', label: 'Open Graph image' },
  { id: 'jsonLd', type: 'longText', label: 'JSON-LD structured data' },
]

export const ADMIN_TOOLS: ConnectorTool[] = [
  {
    name: 'connector_step_up',
    description:
      'Re-authenticate for a destructive or schema-changing operation. Required before a ' +
      'clean-site import, a full-site publish, and table or field changes. Uses the credential ' +
      'held on the server; supply mfaCode only if the account requires one. The session cookie ' +
      'rotates, which the connector handles.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        mfaCode: { type: 'string', description: 'Only if the account has MFA enabled.' },
      },
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const target = resolveTarget(str(a.target) || undefined)
        const session = requireSession(target.name)
        // The credential comes from server configuration, never from arguments.
        await stepUp(session, target.secret, str(a.mfaCode) || undefined)
        return ok({ steppedUp: target.name })
      }),
  },

  {
    name: 'connector_delete_rows',
    description:
      'Delete MANY rows in one call. DESTRUCTIVE AND NOT REVERSIBLE — no undo, no trash. ' +
      'Requires confirm to be exactly "DELETE <count> FROM <target>". Reports each row ' +
      'individually so a partial failure is visible rather than hidden. If the intent is to take ' +
      'pages off the site while keeping them, use connector_set_row_status with unpublished.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        rowIds: { type: 'array', items: { type: 'string' }, description: 'Row ids to delete.' },
        confirm: {
          type: 'string',
          description: 'Exactly "DELETE <count> FROM <target>", e.g. "DELETE 12 FROM staging".',
        },
      },
      required: ['rowIds', 'confirm'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const target = str(a.target)
        const rowIds = Array.isArray(a.rowIds) ? (a.rowIds as string[]) : []
        if (rowIds.length === 0) return fail('rowIds is empty.')

        // The count is in the phrase so a confirmation cannot be reused for a
        // larger batch than the one it was written for.
        const expected = `DELETE ${rowIds.length} FROM ${target}`
        if (str(a.confirm) !== expected) {
          return fail(
            `Refused. confirm must be exactly "${expected}". ` +
              `This permanently removes ${rowIds.length} row(s) from "${target}".`,
          )
        }

        const session = requireSession(target)
        const deleted: string[] = []
        const failed: { rowId: string; error: string }[] = []
        for (const rowId of rowIds) {
          try {
            await deleteRow(session, rowId)
            deleted.push(rowId)
          } catch (err) {
            // Keep going: stopping at the first failure leaves the caller
            // unable to tell which rows went and which stayed.
            failed.push({ rowId, error: err instanceof Error ? err.message : String(err) })
          }
        }
        return ok({ requested: rowIds.length, deleted: deleted.length, failed })
      }),
  },

  {
    name: 'connector_get_table',
    description:
      'Fetch one table with its complete field definitions. Read-only. Use before changing ' +
      'fields, so the change is made against what is actually there.',
    inputSchema: {
      type: 'object',
      properties: { target: targetProp, tableId: { type: 'string' } },
      required: ['tableId'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => ok(await getTable(requireSession(str(a.target)), str(a.tableId)))),
  },

  {
    name: 'connector_create_table',
    description:
      'Create a content table. WRITES, and changes the public URL surface, so it needs a recent ' +
      'connector_step_up. kind "postType" gives a routed collection whose entries have their own ' +
      'URLs — those entries return 404 until an entry template exists, so pair it with ' +
      'connector_create_entry_template. kind "data" is unrouted, which is what tags and ' +
      'categories want.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        name: { type: 'string' },
        slug: { type: 'string', description: 'Do not use "posts" — reserved.' },
        kind: { type: 'string', enum: ['data', 'postType'] },
        routeBase: { type: 'string', description: 'URL prefix for postType, e.g. /blog' },
        singularLabel: { type: 'string' },
        pluralLabel: { type: 'string' },
      },
      required: ['name', 'slug', 'kind'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () =>
        ok(
          await createTable(requireSession(str(a.target)), {
            name: str(a.name),
            slug: str(a.slug),
            kind: a.kind === 'postType' ? 'postType' : 'data',
            routeBase: str(a.routeBase) || undefined,
            singularLabel: str(a.singularLabel) || undefined,
            pluralLabel: str(a.pluralLabel) || undefined,
          }),
        ),
      ),
  },

  {
    name: 'connector_add_table_fields',
    description:
      'Add or update custom fields on a table. WRITES schema, so it needs a recent ' +
      'connector_step_up. Existing fields are preserved — the current field list is read and the ' +
      'new ones merged in, because the underlying update replaces the array wholesale. Built-in ' +
      'fields are protected by the server and cannot be removed.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        tableId: { type: 'string' },
        fields: {
          type: 'array',
          description: 'Field definitions: { id, type, label }.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: {
                type: 'string',
                description:
                  'text, longText, richText, number, boolean, date, dateTime, select, ' +
                  'multiSelect, url, email, media, relation, repeater',
              },
              label: { type: 'string' },
            },
            required: ['id', 'type', 'label'],
          },
        },
      },
      required: ['tableId', 'fields'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () =>
        ok(
          await addTableFields(
            requireSession(str(a.target)),
            str(a.tableId),
            (a.fields as DataField[]) ?? [],
          ),
        ),
      ),
  },

  {
    name: 'connector_add_seo_fields',
    description:
      'Add the standard SEO field set — canonical URL, Open Graph title, description and image, ' +
      'and JSON-LD — to a table in one call. WRITES schema; needs a recent connector_step_up. ' +
      'These fields do not exist in the stock schema, and without them a migrated site cannot ' +
      'keep its indexed URLs pointing where they did.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        tableId: { type: 'string', description: 'Usually pages or posts.' },
      },
      required: ['tableId'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () =>
        ok(await addTableFields(requireSession(str(a.target)), str(a.tableId), SEO_FIELDS)),
      ),
  },

  {
    name: 'connector_list_media',
    description: 'List media assets in the library. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { target: targetProp },
      additionalProperties: false,
    },
    handler: async (a) => guarded(async () => ok(await listMedia(requireSession(str(a.target))))),
  },

  {
    name: 'connector_upload_media',
    description:
      'Upload a file from a local path into the media library. WRITES. Returns the media id, ' +
      'which is what image and featured-image fields store.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        path: { type: 'string', description: 'Absolute path to the file on the server.' },
        fileName: { type: 'string', description: 'Optional override for the stored name.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const filePath = resolve(str(a.path))
        const bytes = new Uint8Array(readFileSync(filePath))
        const name = str(a.fileName) || basename(filePath)
        const mime = MIME[extname(name).toLowerCase()] ?? 'application/octet-stream'
        return ok(await uploadMedia(requireSession(str(a.target)), name, bytes, mime))
      }),
  },
]
