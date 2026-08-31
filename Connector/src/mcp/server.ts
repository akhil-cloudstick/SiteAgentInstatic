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

export const MCP_ENDPOINT_PATH = '/mcp'

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
    const started = Date.now()
    try {
      const result = await tool.handler(request.params.arguments ?? {})
      logActivity({
        section: sectionOf(tool.name),
        action: tool.name.replace(/^connector_/, ''),
        outcome: result.isError ? 'FAILED' : 'ok',
        ms: Date.now() - started,
        detail: summarize(tool.name, request.params.arguments ?? {}, result),
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

  if (url.pathname !== MCP_ENDPOINT_PATH) return null

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

  const handler = createMcpHandler(() => buildConnectorMcpServer(caller), {
    legacy: 'stateless',
    onerror: (err: unknown) => console.error('[connector:mcp] transport error:', err),
  })

  return handler.fetch(req)
}
