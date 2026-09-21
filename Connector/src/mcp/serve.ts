/**
 * `serve` — run the Connector MCP server over HTTP.
 *
 * Binds to 127.0.0.1 by default. Remote access is expected to come from
 * Tailscale, which routes to the loopback listener; binding to 0.0.0.0 would
 * additionally expose the port to whatever else can reach this machine, so it
 * has to be asked for explicitly.
 */

import { handleMcpRequest, MCP_ENDPOINT_PATH } from './server'
import { requiredToken, TOKEN_ENV_VAR } from './auth'
import { ORIGIN_ENV_VAR } from './origin'
import { startPushSweeper } from './pushTools'

export interface ServeOptions {
  port: number
  host: string
}

export function serveMcp(options: ServeOptions): { port: number; stop: () => void } {
  // Fail before listening rather than after — a server that starts and then
  // rejects everything looks like a network problem.
  requiredToken()

  const server = Bun.serve({
    port: options.port,
    hostname: options.host,
    fetch: async (req) => (await handleMcpRequest(req)) ?? new Response('Not found', { status: 404 }),
  })

  console.log(`mms-connector MCP listening on http://${options.host}:${server.port}`)
  console.log(`  endpoint : ${MCP_ENDPOINT_PATH}`)
  console.log(`  health   : /health`)
  console.log(`  auth     : Bearer, from ${TOKEN_ENV_VAR}`)
  console.log(`  origins  : ${process.env[ORIGIN_ENV_VAR] ?? '(localhost only)'}`)

  // A push parked on an owner's signature resumes by itself once that signature
  // exists (R13). Without this, somebody has to come back and nudge it, which
  // is the round trip the milestone counts.
  const sweeper = startPushSweeper()
  console.log(`  pushes   : parked runs resume automatically`)

  return {
    port: server.port,
    stop: () => {
      sweeper.stop()
      server.stop()
    },
  }
}
