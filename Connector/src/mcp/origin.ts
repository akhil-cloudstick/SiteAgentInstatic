/**
 * Origin validation for Streamable HTTP.
 *
 * MCP over HTTP requires Origin checking to prevent DNS rebinding: without it, a
 * page in the operator's browser could drive this server from any site they
 * visit. The SDK expects the host to make the policy decision.
 *
 * Tailscale Funnel is the specific complication here. The funnel terminates TLS
 * and rewrites Origin/Host to the public `*.ts.net` name, so a policy written
 * against the local bind address rejects every real request. Operator's
 * `pending.md` records this exact failure already biting Instatic's CSRF check,
 * which is why the allowlist is explicit rather than inferred from the listener.
 *
 * A request with NO Origin header is allowed: that is a CLI or server-to-server
 * caller, which is the normal case for an MCP client, and it cannot be a
 * browser rebinding attack because browsers always send Origin on cross-origin
 * requests.
 */

export const ORIGIN_ENV_VAR = 'MMS_CONNECTOR_ALLOWED_ORIGINS'

function configuredOrigins(): string[] {
  return (process.env[ORIGIN_ENV_VAR] ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

export function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true // CLI / server-to-server — see note above.

  const normalized = origin.replace(/\/$/, '')
  const allowed = configuredOrigins()

  if (allowed.includes(normalized)) return true

  // Localhost is always permitted so an operator can drive a locally-run server
  // from a local tool without configuring anything.
  try {
    const { hostname } = new URL(normalized)
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true
  } catch {
    return false
  }
  return false
}

export function originRejected(req: Request): Response {
  const origin = req.headers.get('origin') ?? '(none)'
  return new Response(
    JSON.stringify({
      error: 'forbidden_origin',
      message:
        `Origin ${origin} is not allowed. Add it to ${ORIGIN_ENV_VAR} (comma-separated). ` +
        `Behind a Tailscale funnel this must be the public https://<node>.<tailnet>.ts.net ` +
        `origin, not the local bind address — the funnel rewrites Origin and Host.`,
    }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  )
}
