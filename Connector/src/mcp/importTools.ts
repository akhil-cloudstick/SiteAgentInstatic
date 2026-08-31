/**
 * Import tools, including the destructive one.
 *
 * `replace` is separated into its own tool rather than offered as a strategy
 * value on the ordinary import. That is deliberate: a strategy enum makes the
 * difference between "add these pages" and "delete the entire site first" a
 * one-word edit in an argument an assistant assembles. A separate tool with a
 * typed confirmation cannot be reached by accident.
 *
 * `replace` is also the only strategy that carries redirects and media folders.
 * The merge strategies skip both silently, which is why a redirect map cannot
 * ride along with a merge import.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ConnectorTool, ToolResult } from './tools'
import { requireSession } from '../http/store'
import { previewBundle, importBundle, importArchive } from '../http/client'

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

export const IMPORT_TOOLS: ConnectorTool[] = [
  {
    name: 'connector_import_archive',
    description:
      'Import a site bundle ZIP from a local path. WRITES. Use merge-overwrite or merge-add for ' +
      'an additive import; use connector_import_replace for a clean-site load. A ZIP carries ' +
      'media files as well as content, which the JSON path cannot.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        path: { type: 'string', description: 'Absolute path to a site-bundle .zip on the server.' },
        strategy: {
          type: 'string',
          enum: ['merge-overwrite', 'merge-add'],
          description: 'Defaults to merge-overwrite. For replace, use connector_import_replace.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const bytes = new Uint8Array(readFileSync(resolve(str(a.path))))
        const strategy = a.strategy === 'merge-add' ? ('merge-add' as const) : ('merge-overwrite' as const)
        return ok(await importArchive(requireSession(str(a.target)), bytes, strategy))
      }),
  },

  {
    name: 'connector_import_replace',
    description:
      'CLEAN-SITE IMPORT. Deletes EVERY row, every non-system table, all media folders and all ' +
      'redirects on the target, then inserts the bundle. NOT REVERSIBLE — there is no undo and no ' +
      'trash. This is the right tool for loading a freshly generated site onto an empty or ' +
      'disposable target, and the wrong tool for updating a site that has content worth keeping. ' +
      'It is also the only import that carries redirects and media folders. Requires confirm to ' +
      'be exactly "REPLACE <target>", and runs a dry run first, returning the counts it is about ' +
      'to apply.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        bundle: { type: 'object', description: 'A SiteBundle object.' },
        path: { type: 'string', description: 'Or an absolute path to a site-bundle .zip.' },
        confirm: {
          type: 'string',
          description: 'Must be exactly "REPLACE <target>", e.g. "REPLACE staging".',
        },
        previewOnly: {
          type: 'boolean',
          description: 'Run the dry run and stop. Use this first — it writes nothing.',
        },
      },
      required: ['confirm'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const target = str(a.target)
        const session = requireSession(target)

        // The confirmation names the target, so a phrase copied from one
        // conversation cannot authorize a replace on a different site.
        const expected = `REPLACE ${target}`
        if (str(a.confirm) !== expected) {
          return fail(
            `Refused. To replace this target, confirm must be exactly "${expected}". ` +
              `This deletes every row on "${target}" and cannot be undone.`,
          )
        }

        const hasBundle = a.bundle !== undefined && a.bundle !== null
        const hasPath = str(a.path).length > 0
        if (hasBundle === hasPath) {
          return fail('Provide exactly one of bundle or path.')
        }

        // Dry run first, always — the counts are the only honest answer to
        // "what is about to happen", and they are cheap.
        if (hasBundle) {
          const preview = await previewBundle(session, a.bundle)
          if (a.previewOnly === true) return ok({ previewOnly: true, preview })
          const result = await importBundle(session, a.bundle, 'replace')
          return ok({ preview, result })
        }

        const bytes = new Uint8Array(readFileSync(resolve(str(a.path))))
        if (a.previewOnly === true) {
          return fail(
            'previewOnly is not available for a ZIP import — the preview endpoint takes JSON. ' +
              'Use connector_export_manifest or pass the bundle as JSON to preview it.',
          )
        }
        return ok(await importArchive(session, bytes, 'replace'))
      }),
  },
]
