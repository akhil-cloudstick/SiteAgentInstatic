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
import { RELAY_SHA256_PROP, resolveBundleSourceWithRelay } from './bundleSource'
import { resolveTarget } from '../http/config'
import { GO_INPUT_PROP } from '../go/message'
import { checkGo, describeGo, goRefusal, runUnderGo } from '../go/verify'
import { runGated } from './goTool'
import { saveUploadPart, UPLOAD_MAX_PARTS, UPLOAD_PART_MAX_BYTES } from './uploadStore'

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
const int = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) ? v : Number.NaN)

const targetProp = {
  type: 'string',
  description: 'Which configured CMS. Required when more than one is configured.',
} as const

/**
 * Standard base64 with padding — what `Buffer.from(bytes).toString('base64')`
 * produces. Checked in linear time on purpose: a part can be megabytes of
 * text, and a nested-quantifier regex over a string that size can fail for
 * reasons of its own and misreport a valid part as malformed.
 */
function isBase64(s: string): boolean {
  if (s.length === 0 || s.length % 4 !== 0) return false
  const padding = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0
  return !/[^A-Za-z0-9+/]/.test(s.slice(0, s.length - padding))
}

export const IMPORT_TOOLS: ConnectorTool[] = [
  {
    name: 'connector_upload_bundle_part',
    description:
      'Upload a bundle IN PARTS through this connection — connector_export_bundle in reverse — and get ' +
      'back an uploadId for connector_preview_import, connector_import_replace or ' +
      'connector_import_archive. For a SMALL bundle and a caller that can send tool arguments but not an ' +
      'HTTP request. For a real site, upload the bundle to the relay and pass relaySha256 to the import ' +
      'instead — nothing has to be typed through arguments. WRITES only to the upload store, never to a ' +
      'CMS. Split the bundle bytes into parts (a few hundred KB each is comfortable as base64) and call ' +
      'once per part with the SAME sha256 (of the whole bundle) and parts (the total), part = 1..parts, in ' +
      'any order. Each call reports which parts are still missing. The call that delivers the last part ' +
      'reassembles them, verifies the sha256, checks the bytes are a ZIP or JSON bundle, and returns ' +
      'uploadId. Resending a part with identical bytes is accepted; different bytes for a part already ' +
      'received are refused. An incomplete set is discarded after the upload retention period.',
    inputSchema: {
      type: 'object',
      properties: {
        sha256: {
          type: 'string',
          description: 'sha256 (64 hex) of the WHOLE bundle, identical on every part.',
        },
        parts: {
          type: 'number',
          description: `Total number of parts (1-${UPLOAD_MAX_PARTS}), identical on every part.`,
        },
        part: { type: 'number', description: 'Which part this call carries, 1-based.' },
        data: {
          type: 'string',
          description: `This part's bytes as standard base64, at most ${UPLOAD_PART_MAX_BYTES} bytes decoded.`,
        },
        kind: {
          type: 'string',
          enum: ['zip', 'json'],
          description: 'Optional. Checked against the reassembled bytes; detected from them when omitted.',
        },
      },
      required: ['sha256', 'parts', 'part', 'data'],
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const data = str(a.data).replace(/\s+/g, '')
        if (!isBase64(data)) {
          return fail('data must be non-empty standard base64 (with = padding). Nothing was stored.')
        }
        const result = saveUploadPart({
          sha256: str(a.sha256),
          parts: int(a.parts),
          part: int(a.part),
          data: new Uint8Array(Buffer.from(data, 'base64')),
          kind: a.kind === 'zip' || a.kind === 'json' ? a.kind : undefined,
        })
        if (!result.ok) return fail(result.reason)
        if (!result.done) {
          return ok({
            done: false,
            parts: result.parts,
            received: result.received.length,
            missing: result.missing.length > 50 ? [...result.missing.slice(0, 50), '…'] : result.missing,
            expiresAt: new Date(result.expiresAt).toISOString(),
          })
        }
        const { upload } = result
        return ok({
          done: true,
          uploadId: upload.uploadId,
          kind: upload.kind,
          bytes: upload.bytes,
          sha256: upload.sha256,
          parts: result.parts,
          expiresAt: new Date(upload.expiresAt).toISOString(),
          note:
            'Pass uploadId to connector_preview_import (dry run, writes nothing), then to ' +
            'connector_import_replace or connector_import_archive.',
        })
      }),
  },

  {
    name: 'connector_import_archive',
    description:
      'Import a site bundle ZIP. WRITES. Use merge-overwrite or merge-add for an additive import; ' +
      'use connector_import_replace for a clean-site load. A ZIP carries media files as well as ' +
      'content, which the JSON path cannot. Name it with relaySha256 (a bundle artefact on the relay), ' +
      'uploadId, or a path on the server — exactly one. On a gated target it also requires go — an ' +
      'owner-signed GO whose action is the strategy (merge-overwrite or merge-add) and whose sha256 ' +
      'is the hash of the archive bytes.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        relaySha256: RELAY_SHA256_PROP,
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
        go: GO_INPUT_PROP,
      },
      additionalProperties: false,
    },
    handler: async (a) =>
      guarded(async () => {
        const source = await resolveBundleSourceWithRelay({
          path: str(a.path) || undefined,
          uploadId: str(a.uploadId) || undefined,
          relaySha256: str(a.relaySha256) || undefined,
        })
        if (!source.ok) return fail(source.reason)
        const { archive, sha256 } = source.value
        if (!archive) {
          return fail('This tool imports a ZIP. For a JSON bundle use connector_import_replace.')
        }
        const strategy = a.strategy === 'merge-add' ? ('merge-add' as const) : ('merge-overwrite' as const)
        const session = requireSession(str(a.target))
        // The strategy IS the action: a GO for merge-add must not be spendable
        // on merge-overwrite, which replaces what merge-add would have kept.
        return runGated(a, strategy, { kind: 'bytes', sha256 }, () => importArchive(session, archive, strategy))
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
      'It is also the only import that carries redirects and media folders. Name the bundle with ' +
      'relaySha256 (a bundle artefact on the relay — the route for a real site), uploadId, path or ' +
      'an inline bundle — exactly one. Requires confirm to be exactly "REPLACE <target>", and runs a ' +
      'dry run first, returning the counts it is about to apply. On a gated target it also requires ' +
      'go — an owner-signed GO for import whose sha256 is the hash of the bundle bytes; an inline ' +
      'bundle cannot be bound to one and is refused there. A dry run (previewOnly) needs no GO.',
    inputSchema: {
      type: 'object',
      properties: {
        target: targetProp,
        relaySha256: RELAY_SHA256_PROP,
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
        go: GO_INPUT_PROP,
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

        const source = await resolveBundleSourceWithRelay({
          bundle: a.bundle,
          path: str(a.path) || undefined,
          uploadId: str(a.uploadId) || undefined,
          relaySha256: str(a.relaySha256) || undefined,
        })
        if (!source.ok) return fail(source.reason)
        const resolved = source.value

        // The owner's GO, checked against the target the write actually lands
        // on and the hash of the bytes actually transferred — and checked
        // before the dry run, so a refused call sends nothing to the CMS at
        // all. A dry run on its own needs no GO: it writes nothing.
        const gate = await checkGo({
          action: 'import',
          target: resolveTarget(target).name,
          go: a.go,
          binding: { kind: 'bytes', sha256: resolved.sha256 },
        })
        if (!gate.ok && a.previewOnly !== true) return fail(goRefusal(gate.reason))

        // Dry run first, ALWAYS — including for archives, which used to refuse
        // previewOnly outright because the preview endpoint takes JSON. A ZIP
        // carries its manifest, so the dry run was always possible; the effect
        // of not doing it was that the one import that deletes everything was
        // also the one that could not be rehearsed.
        // Previewed AS a replace, so the counts describe the post-wipe state
        // this tool actually produces rather than a merge that never happens.
        const preview = await previewBundle(session, resolved.bundle, 'replace')
        const previewReport = {
          ...(preview as Record<string, unknown>),
          bundleSource: resolved.source,
          ...(resolved.sha256 ? { sha256: resolved.sha256 } : {}),
          ...(resolved.archive ? { mediaFilesInArchive: resolved.mediaFilesInArchive } : {}),
        }
        if (a.previewOnly === true || !gate.ok) {
          return ok({ previewOnly: true, preview: previewReport, go: describeGo(gate) })
        }

        // An archive goes in as an archive: it carries media bytes and media
        // folders that the manifest alone does not, and dropping them silently
        // would import a site missing its images.
        const run = await runUnderGo(gate, () =>
          resolved.archive
            ? importArchive(session, resolved.archive, 'replace')
            : importBundle(session, resolved.bundle, 'replace'),
        )
        if (!run.ok) return fail(goRefusal(run.reason))
        return ok({ preview: previewReport, result: run.result, ...(run.receipt ? { go: run.receipt } : {}) })
      }),
  },
]
