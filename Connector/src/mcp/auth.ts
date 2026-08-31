/**
 * Bearer-token auth for the Connector MCP server.
 *
 * Deliberately simple and deliberately not a user system. This server exposes
 * migration tooling, not content — the identity that matters is "may this caller
 * drive the connector", and that is one shared secret per deployment held by the
 * operator.
 *
 * The token is read from the environment, never from a file in the repo and
 * never from an argument: CLI arguments land in shell history and in the process
 * list on a shared box.
 */

import { timingSafeEqual } from 'node:crypto'

export const TOKEN_ENV_VAR = 'MMS_CONNECTOR_MCP_TOKEN'

export class MissingTokenError extends Error {
  override readonly name = 'MissingTokenError'
}

export function requiredToken(): string {
  const token = process.env[TOKEN_ENV_VAR]?.trim()
  if (!token) {
    throw new MissingTokenError(
      `${TOKEN_ENV_VAR} is not set. Refusing to start an unauthenticated MCP server — ` +
        `it would be reachable by anything that can route to this port.`,
    )
  }
  if (token.length < 32) {
    throw new MissingTokenError(
      `${TOKEN_ENV_VAR} is shorter than 32 characters. Generate one with: ` +
        `bun -e "console.log(crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,''))"`,
    )
  }
  return token
}

/** Constant-time compare, so a wrong token cannot be recovered by timing the response. */
export function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function authorize(req: Request): boolean {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return false
  return tokenMatches(header.slice('Bearer '.length).trim(), requiredToken())
}

export function unauthorized(): Response {
  return new Response(
    JSON.stringify({ error: 'unauthorized', message: 'Bearer token missing or invalid.' }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )
}
