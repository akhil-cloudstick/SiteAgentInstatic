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

import type { ConnectorTool, ToolResult } from './tools'
import { requireSession } from '../http/store'
import { previewBundle, importBundle, importArchive } from '../http/client'
import { resolveBundleSource } from './bundleSource'

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
      'Import a site bundle ZIP. WRITES. Use merge-overwrite or merge-add for an additive import; ' +
      'use connector_import_replace for a clean-site load. A ZIP carries media files as well as ' +
      'content, which the JSON path cannot. Name it with uploadId (POST it to /imports first) or ' +
      'with a path on the server — exactly one.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        uploadId: {
          type: 'string',
          description: 'A ZIP already POSTed to /imports. The route for a caller not on this host.',
        },
        path: { type: 'string', description: 'Or a site-bundle .zip on the SERVER filesystem.' },
        strategy: {
          type: 'string',
          enum: ['merge-overwrite', 'merge-add'],
          description: 'Defaults to merge-overwrite. For replace, use connector_import_replace.',
        },
      },
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const source = resolveBundleSource({
          path: str(a.path) || undefined,
          uploadId: str(a.uploadId) || undefined,
        })
        if (!source.ok) return fail(source.reason)
        if (!source.value.archive) {
          return fail('This tool imports a ZIP. For a JSON bundle use connector_import_replace.')
        }
        const strategy = a.strategy === 'merge-add' ? ('merge-add' as const) : ('merge-overwrite' as const)
        return ok(await importArchive(requireSession(str(a.target)), source.value.archive, strategy))
      }),
  },

  {
    name: 'connector_import_replace',
    description:
      'CLEAN-SITE IMPORT. Deletes EVERY row, every non-system table, all media folders and all ' +
      'redirects on the target, then inserts the bundle. NOT REVERSIBLE — there is no undo and no ' +
      'trash. ALSO CLEARS THE PUBLISHED VERSION: the site stops being published and its public ' +
      'URLs keep serving the last deployment until a new publish runs, with nothing in the admin ' +
      'saying so. Recoverable by republishing — unless publishing needs another party to approve, ' +
      'which is when it becomes an outage rather than a step. This is the right tool for loading a ' +
      'freshly generated site onto an empty or disposable target, and the wrong tool for updating ' +
      'a site that has content worth keeping. ' +
      'It is also the only import that carries redirects and media folders. Requires confirm to ' +
      'be exactly "REPLACE <target>", and runs a dry run first, returning the counts it is about ' +
      'to apply.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        bundle: { type: 'object', description: 'A SiteBundle object, inline. Only practical for small bundles.' },
        uploadId: {
          type: 'string',
          description:
            'A bundle already POSTed to /imports. Preferred for a real bundle: inline JSON of any ' +
            'realistic size is hundreds of thousands of tokens, and a server path is not writable ' +
            'by a remote caller. A ZIP upload imports media too.',
        },
        path: { type: 'string', description: 'Or a site-bundle .zip on the SERVER filesystem.' },
        confirm: {
          type: 'string',
          description: 'Must be exactly "REPLACE <target>", e.g. "REPLACE staging".',
        },
        previewOnly: {
          type: 'boolean',
          description:
            'Run the dry run and stop. Use this first — it writes nothing. Works for every source, ' +
            'archives included.',
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

        const source = resolveBundleSource({
          bundle: a.bundle,
          path: str(a.path) || undefined,
          uploadId: str(a.uploadId) || undefined,
        })
        if (!source.ok) return fail(source.reason)

        // Dry run first, ALWAYS — including for archives, which used to refuse
        // previewOnly outright because the preview endpoint takes JSON. A ZIP
        // carries its manifest, so the dry run was always possible; the effect
        // of not doing it was that the one import that deletes everything was
        // also the one that could not be rehearsed.
        // Previewed AS a replace, so the counts describe the post-wipe state
        // this tool actually produces rather than a merge that never happens.
        const preview = await previewBundle(session, source.value.bundle, 'replace')
        const previewReport = {
          ...(preview as Record<string, unknown>),
          bundleSource: source.value.source,
          ...(source.value.archive ? { mediaFilesInArchive: source.value.mediaFilesInArchive } : {}),
        }
        if (a.previewOnly === true) return ok({ previewOnly: true, preview: previewReport })

        // An archive goes in as an archive: it carries media bytes and media
        // folders that the manifest alone does not, and dropping them silently
        // would import a site missing its images.
        const result = source.value.archive
          ? await importArchive(session, source.value.archive, 'replace')
          : await importBundle(session, source.value.bundle, 'replace')
        return ok({ preview: previewReport, result })
      }),
  },
]
