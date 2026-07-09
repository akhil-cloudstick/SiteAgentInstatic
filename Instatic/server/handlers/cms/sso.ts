/**
 * Tenant SSO hand-off.
 *
 *   GET /admin/api/cms/sso?token=<signed>
 *
 * When the SiteAgent control-plane runs this instance for a tenant it sets
 * INSTATIC_SSO_SECRET. The tenant's hub redirects here with a short-lived signed
 * token; we verify it and mint an Owner session, then 302 to /admin. This gives
 * the tenant ONE hub login for both tools. A GET is a safe method, so the CMS
 * CSRF origin check does not apply — the signed token is the authenticator. When
 * the secret is unset (plain self-hosted install) the route returns null (inert).
 */
import type { DbClient } from '../../db/client'
import { createSessionToken, hashSessionToken, sessionExpiry } from '../../auth/tokens'
import { createSession } from '../../auth/sessions'
import { verifySsoToken, ssoSecret } from '../../auth/tenantSso'
import { findActiveOwner } from '../../repositories/users'
import { createAuditEvent } from '../../repositories/audit'
import { setCookieHeader } from '../../http'
import { CMS_API_PREFIX, requestAuditContext } from './shared'
import { sessionCookie } from './session'

function plainText(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

export async function handleSsoRoutes(req: Request, db: DbClient): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== `${CMS_API_PREFIX}/sso`) return null
  if (req.method !== 'GET') return null
  // Inert outside managed (control-plane) mode.
  if (!ssoSecret()) return null

  const payload = verifySsoToken(url.searchParams.get('token') ?? '')
  if (!payload) {
    return plainText('Sign-in link invalid or expired. Return to your hub and open the workspace again.', 401)
  }

  const owner = await findActiveOwner(db)
  if (!owner) {
    return plainText('This workspace is not set up yet.', 409)
  }

  // Mint an Owner session (same primitives the login handler uses). The hub has
  // already authenticated the tenant, so MFA is marked satisfied.
  const token = createSessionToken()
  const expiresAt = sessionExpiry()
  await createSession(db, {
    idHash: await hashSessionToken(token),
    userId: owner.id,
    expiresAt,
    mfaPassedAt: new Date(),
    ...requestAuditContext(req),
  })
  await createAuditEvent(db, {
    actorUserId: owner.id,
    action: 'login.success',
    targetType: 'user',
    targetId: owner.id,
    metadata: { source: 'sso' },
    ...requestAuditContext(req),
  })

  return setCookieHeader(
    new Response(null, { status: 302, headers: { location: '/admin' } }),
    sessionCookie(req, token, expiresAt),
  )
}
