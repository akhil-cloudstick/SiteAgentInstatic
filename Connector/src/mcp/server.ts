/**
 * Connector MCP server — Streamable HTTP.
 *
 * Mirrors the shape of Instatic's own MCP endpoint (bearer auth, Origin
 * validation, stateless-legacy fallback) so the two behave the same way to a
 * client, but exposes Connector tooling rather than CMS content.
 *
 * This surface is full-access: read, create, edit, delete, publish, and
 * clean-site import. Two safeguards carry the weight, since the tools
 * themselves no longer refuse anything:
 *
 *   - every call is written to the activity log with its outcome, and the
 *     irreversible ones are tagged REPLACE / PUBLISH / DELETE so they can be
 *     found by grep alone;
 *   - the destructive import requires a confirmation naming its target, so a
 *     phrase copied from one conversation cannot authorize a wipe elsewhere.
 */

import { Server } from '@modelcontextprotocol/server'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { CONNECTOR_TOOLS } from './tools'
import { WRITE_TOOLS } from './writeTools'
import { CRUD_TOOLS } from './crudTools'
import { IMPORT_TOOLS } from './importTools'
import { ADMIN_TOOLS } from './adminTools'
import { TEMPLATE_TOOLS } from './templateTools'
import { authorize, unauthorized } from './auth'
import { originAllowed, originRejected } from './origin'
import { logActivity, callerFingerprint } from '../audit/log'
import { resolveExport, EXPORT_DOWNLOAD_PREFIX } from './exportStore'
import { saveUpload, UPLOAD_ROUTE, type UploadKind } from './uploadStore'
import { setToolSurface } from './toolSurface'
import { describeArgIssues, validateToolArguments } from './validateArgs'
import { withRequestContext } from './requestContext'
import { readFileSync, statSync } from 'node:fs'

export const MCP_ENDPOINT_PATH = '/mcp'

/**
 * `/exports/<exportId>` serves a whole archive in one piece.
 *
 * The inline `part` mechanism works and stays, but it was built for a caller
 * that can hold the bytes. An AI agent cannot: a 39.5 MB archive is ~53 MB of
 * base64, roughly 13 million tokens, and even a 2 MB site exceeds a single
 * context. `deliver: "path"` is no help either — it names a file on this host,
 * on a share the caller cannot mount.
 *
 * So the archive gets an address. Same port, same bearer token, same Tailscale
 * route the caller already reaches `/mcp` on, which is what makes it reachable
 * without anyone configuring anything.
 */
export { EXPORT_DOWNLOAD_PREFIX }

/**
 * Which part of the connector a tool belongs to. Logged so an auditor can scan
 * for "everything anyone did to approvals" without knowing tool names.
 */
function sectionOf(toolName: string): string {
  // Uppercase for the irreversible ones, so `grep` over the log surfaces every
  // live-affecting action without anyone needing to know tool names.
  if (toolName.includes('replace')) return 'REPLACE'
  if (toolName.includes('publish')) return 'PUBLISH'
  if (toolName.includes('delete')) return 'DELETE'
  if (toolName.includes('row') || toolName.includes('table')) return 'content'
  if (toolName.includes('import') || toolName.includes('export')) return 'content'
  if (toolName.includes('connect') || toolName.includes('target')) return 'session'
  if (toolName.includes('approval')) return 'approval'
  if (toolName.includes('hash')) return 'hashing'
  if (toolName.includes('doctor') || toolName.includes('environment')) return 'environment'
  return 'tools'
}

/**
 * A one-phrase detail for the log. Deliberately records SHAPE, never content:
 * how many rows, not which rows. The log must stay safe to read and to keep.
 */
function summarize(
  toolName: string,
  args: Record<string, unknown>,
  result: { isError?: boolean; content: { text: string }[] },
): string {
  if (result.isError) {
    const text = result.content[0]?.text ?? ''
    try {
      const parsed = JSON.parse(text) as { error?: string }
      return parsed.error ?? 'error'
    } catch {
      return 'error'
    }
  }
  const gatedTools = [
    'connector_import_replace',
    'connector_import_archive',
    'connector_publish_site',
    'connector_publish_row',
    'connector_set_row_status',
    'connector_delete_row',
    'connector_delete_rows',
    'connector_publish_rows',
  ]
  if (gatedTools.includes(toolName)) {
    // Which GO authorized it. The nonce is not a secret; it is what ties this
    // line to the relay ticket and the GO ledger.
    const go = args.go as { ticketId?: unknown; nonce?: unknown } | undefined
    return go && typeof go === 'object'
      ? `go ticket=${String(go.ticketId)} nonce=${String(go.nonce)}`
      : 'ungated'
  }
  if (toolName === 'connector_hash_rows') {
    const rows = Array.isArray(args.rows) ? args.rows.length : 0
    return `rows=${rows}`
  }
  if (toolName === 'connector_doctor') {
    try {
      const r = JSON.parse(result.content[0]?.text ?? '{}') as {
        nodeCount?: number
        styleRuleCount?: number
      }
      return `nodes=${r.nodeCount ?? '?'} rules=${r.styleRuleCount ?? '?'}`
    } catch {
      return ''
    }
  }
  if (toolName === 'connector_verify_approval') return 'approval verified'
  if (toolName === 'connector_import_draft') {
    try {
      const r = JSON.parse(result.content[0]?.text ?? '{}') as {
        strategy?: string
        rowsInserted?: number
        rowsReplaced?: number
      }
      return 'strategy=' + (r.strategy ?? '?') +
        ' inserted=' + (r.rowsInserted ?? '?') +
        ' replaced=' + (r.rowsReplaced ?? '?')
    } catch {
      return ''
    }
  }
  if (toolName === 'connector_preview_import') {
    try {
      const r = JSON.parse(result.content[0]?.text ?? '{}') as { totals?: { rows?: number } }
      return 'preview rows=' + (r.totals?.rows ?? '?')
    } catch {
      return ''
    }
  }
  if (toolName === 'connector_connect') return 'session opened'
  return ''
}

export function buildConnectorMcpServer(caller = 'client'): Server {
  const server = new Server(
    { name: 'mms-connector', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  const ALL_TOOLS = [
    ...CONNECTOR_TOOLS,
    ...WRITE_TOOLS,
    ...CRUD_TOOLS,
    ...IMPORT_TOOLS,
    ...ADMIN_TOOLS,
    ...TEMPLATE_TOOLS,
  ]
  const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]))
  // Recorded here because this is the only place that knows the full surface.
  // `connector_environment` reports it so a client can tell a cached tools/list
  // from the current one — see toolSurface.ts.
  setToolSurface(ALL_TOOLS)

  server.setRequestHandler('tools/list', async () => ({
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }))

  server.setRequestHandler('tools/call', async (request: {
    params: { name: string; arguments?: Record<string, unknown> }
  }) => {
    const tool = byName.get(request.params.name)
    if (!tool) {
      logActivity({
        section: 'tools',
        action: 'unknown',
        outcome: 'FAILED',
        detail: `no such tool: ${request.params.name}`,
        caller,
      })
      return {
        content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      }
    }
    const args = request.params.arguments ?? {}
    // An argument the tool never declared is a caller error, and one that is
    // ignored instead of refused becomes a run that did something else.
    const issues = validateToolArguments(tool.inputSchema, args)
    if (issues.length > 0) {
      const message = describeArgIssues(tool.name, issues)
      logActivity({
        section: sectionOf(tool.name),
        action: tool.name.replace(/^connector_/, ''),
        outcome: 'FAILED',
        detail: issues.map((i) => `${i.path || '(root)'}: ${i.problem}`).join('; '),
        caller,
      })
      return { content: [{ type: 'text', text: JSON.stringify({ error: message, issues }, null, 2) }], isError: true }
    }

    const started = Date.now()
    try {
      const result = await tool.handler(args)
      logActivity({
        section: sectionOf(tool.name),
        action: tool.name.replace(/^connector_/, ''),
        outcome: result.isError ? 'FAILED' : 'ok',
        ms: Date.now() - started,
        detail: summarize(tool.name, args, result),
        caller,
      })
      return result
    } catch (err) {
      logActivity({
        section: sectionOf(tool.name),
        action: tool.name.replace(/^connector_/, ''),
        outcome: 'FAILED',
        ms: Date.now() - started,
        detail: err instanceof Error ? err.message : String(err),
        caller,
      })
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { error: err instanceof Error ? err.message : String(err) },
              null,
              2,
            ),
          },
        ],
        isError: true,
      }
    }
  })

  return server
}

/** Handle one HTTP request. Returns null when the path is not ours. */
export async function handleMcpRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url)

  if (url.pathname === '/health') {
    return new Response(JSON.stringify({ ok: true, service: 'mms-connector-mcp' }), {
      headers: { 'content-type': 'application/json' },
    })
  }

  const isDownload = url.pathname.startsWith(EXPORT_DOWNLOAD_PREFIX)
  const isUpload = url.pathname === UPLOAD_ROUTE || url.pathname === `${UPLOAD_ROUTE}/`
  if (url.pathname !== MCP_ENDPOINT_PATH && !isDownload && !isUpload) return null

  // Order matters: Origin before auth, so a rebinding attempt is rejected
  // without the token ever being compared.
  const presented = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null
  const caller = callerFingerprint(presented)

  if (!originAllowed(req)) {
    logActivity({
      section: 'auth',
      action: 'origin-check',
      outcome: 'DENIED',
      detail: `origin ${req.headers.get('origin') ?? '(none)'}`,
      caller,
    })
    return originRejected(req)
  }
  if (!authorize(req)) {
    logActivity({
      section: 'auth',
      action: 'token-check',
      outcome: 'DENIED',
      detail: presented ? 'invalid token' : 'no token presented',
      caller,
    })
    return unauthorized()
  }

  if (isDownload) return serveExport(req, url, caller)
  if (isUpload) return receiveUpload(req, url, caller)

  const handler = createMcpHandler(() => buildConnectorMcpServer(caller), {
    legacy: 'stateless',
    onerror: (err: unknown) => console.error('[connector:mcp] transport error:', err),
  })

  // The whole call runs inside the request context so any tool that returns a
  // URL can address it back to wherever this caller reached us from.
  return withRequestContext(req, () => handler.fetch(req))
}

/**
 * Serve one exported archive whole.
 *
 * Behind the same bearer token as `/mcp` — the archive is a full copy of a
 * site's content, so it is exactly as sensitive as the tools that produced it.
 * Authorisation has already run by the time this is called.
 */
function serveExport(req: Request, url: URL, caller: string): Response {
  const id = decodeURIComponent(url.pathname.slice(EXPORT_DOWNLOAD_PREFIX.length))
  const found = resolveExport(id)
  if (!found.ok) {
    logActivity({
      section: 'content',
      action: 'export-download',
      outcome: 'FAILED',
      detail: found.reason,
      caller,
    })
    return new Response(JSON.stringify({ error: found.reason }), {
      status: id && /^[A-Za-z0-9._-]+$/.test(id) ? 404 : 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const size = statSync(found.path).size
  logActivity({
    section: 'content',
    action: 'export-download',
    outcome: 'ok',
    detail: `${id} (${size} bytes)`,
    caller,
  })

  // HEAD lets a caller confirm the size before committing to the transfer,
  // which is the difference between a failed 40 MB download and a decision.
  if (req.method === 'HEAD') {
    return new Response(null, {
      headers: {
        'content-type': 'application/zip',
        'content-length': String(size),
        'content-disposition': `attachment; filename="${id}"`,
      },
    })
  }

  // Compressed on the wire when the caller accepts it.
  //
  // The archive itself is a STORED zip — deliberately, because media is already
  // compressed and stored entries let the CMS stream an export without holding
  // it in memory. The cost is that the manifest, which is one large JSON text
  // blob, ships uncompressed: measured on a 398-page site, 39,490,566 bytes of
  // JSON in a 39,490,716-byte archive, which deflates to 7.46 MB — 5.3x.
  //
  // Transport compression collects that 5.3x without touching the archive
  // format, so import stays byte-identical to what it has always parsed. It is
  // streamed rather than buffered so a large archive does not cost a 40 MB
  // allocation, and content-length is omitted because the compressed size is
  // not known until the last chunk.
  const acceptsGzip = /\bgzip\b/i.test(req.headers.get('accept-encoding') ?? '')
  if (acceptsGzip) {
    return new Response(Bun.file(found.path).stream().pipeThrough(new CompressionStream('gzip')), {
      headers: {
        'content-type': 'application/zip',
        'content-encoding': 'gzip',
        'content-disposition': `attachment; filename="${id}"`,
        // The decompressed size, so a caller can check what it got against
        // what the tool reported without trusting the transfer.
        'x-archive-bytes': String(size),
      },
    })
  }

  return new Response(readFileSync(found.path), {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(size),
      'content-disposition': `attachment; filename="${id}"`,
    },
  })
}

/**
 * Receive one bundle and hold it for an import to name.
 *
 * The inbound mirror of `/exports/`, and behind the same bearer token: the two
 * directions carry the same thing — a whole copy of a site — so they warrant
 * the same guard rather than a second credential to distribute.
 *
 * Authorisation has already run by the time this is called.
 */
async function receiveUpload(req: Request, url: URL, caller: string): Promise<Response> {
  const reject = (status: number, error: string): Response => {
    logActivity({ section: 'content', action: 'import-upload', outcome: 'FAILED', detail: error, caller })
    return new Response(JSON.stringify({ error }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (req.method !== 'POST') {
    return reject(405, `Use POST to ${UPLOAD_ROUTE}. Received ${req.method}.`)
  }

  // Decompressed here, explicitly. A server does not get this for free the way
  // an HTTP client does on the response side, and a bundle manifest deflates
  // about 5x — so declining it would leave most of the transfer on the table
  // for the one payload big enough to have prompted this route.
  const encoding = (req.headers.get('content-encoding') ?? '').toLowerCase().trim()
  let bytes: Uint8Array
  try {
    if (encoding === 'gzip' || encoding === 'deflate') {
      const format = encoding === 'gzip' ? 'gzip' : 'deflate'
      const stream = req.body?.pipeThrough(new DecompressionStream(format))
      if (!stream) return reject(400, 'Empty body — send the bundle as the request body.')
      bytes = new Uint8Array(await new Response(stream).arrayBuffer())
    } else if (encoding && encoding !== 'identity') {
      return reject(415, `Unsupported content-encoding "${encoding}". Use gzip, deflate, or none.`)
    } else {
      bytes = new Uint8Array(await req.arrayBuffer())
    }
  } catch (err) {
    return reject(
      400,
      `Could not read the request body${encoding ? ` (content-encoding: ${encoding})` : ''}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (bytes.length === 0) return reject(400, 'Empty body — send the bundle as the request body.')

  // ZIP unless it declares JSON, then confirmed against the bytes. A bundle
  // named wrongly would otherwise be stored as one kind and fail later inside
  // an import, where the cause is much harder to see than it is here.
  const contentType = (req.headers.get('content-type') ?? '').toLowerCase()
  const declared: UploadKind = contentType.includes('json') ? 'json' : 'zip'
  const looksZip = bytes[0] === 0x50 && bytes[1] === 0x4b // "PK"
  if (declared === 'zip' && !looksZip) {
    return reject(
      400,
      'Body is not a ZIP archive (no PK signature). Send a site-bundle .zip, or set ' +
        'content-type: application/json to upload a SiteBundle as JSON.',
    )
  }
  if (declared === 'json' && looksZip) {
    return reject(400, 'Body is a ZIP but content-type says JSON. Send content-type: application/zip.')
  }
  if (declared === 'json') {
    try {
      JSON.parse(new TextDecoder().decode(bytes))
    } catch (err) {
      return reject(400, `Body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Verified before storing, so a corrupted transfer is refused rather than
  // kept and discovered by an import already replacing a site's contents.
  const expectedSha256 = url.searchParams.get('sha256') ?? req.headers.get('x-bundle-sha256') ?? undefined
  const stored = saveUpload(bytes, declared, { expectedSha256: expectedSha256 ?? undefined })
  if (!stored.ok) return reject(422, stored.reason)

  const { upload } = stored
  logActivity({
    section: 'content',
    action: 'import-upload',
    outcome: 'ok',
    detail: `${upload.uploadId} (${upload.bytes} bytes, ${upload.kind})`,
    caller,
  })

  return new Response(
    JSON.stringify({
      uploadId: upload.uploadId,
      bytes: upload.bytes,
      sha256: upload.sha256,
      kind: upload.kind,
      expiresAt: new Date(upload.expiresAt).toISOString(),
      note:
        'Pass uploadId to connector_preview_import (dry run, writes nothing) and then to ' +
        'connector_import_replace or connector_import_archive.',
    }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  )
}
