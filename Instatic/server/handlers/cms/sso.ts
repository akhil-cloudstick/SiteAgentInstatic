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
  // already strongly authenticated the tenant, so BOTH MFA and step-up are marked
  // satisfied for the session lifetime. Without the step-up grant, step-up-gated
  // actions (Publish, destructive ops) would prompt for a local CMS password the
  // SSO user doesn't have — the hub is the identity provider, so re-auth here is
  // both redundant and impossible.
  const token = createSessionToken()
  const expiresAt = sessionExpiry()
  await createSession(db, {
    idHash: await hashSessionToken(token),
    userId: owner.id,
    expiresAt,
    mfaPassedAt: new Date(),
    stepUpExpiresAt: expiresAt,
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

  // Optional post-sign-in landing page (e.g. Share-to-CMS lands on the site editor).
  // Restricted to in-app /admin paths so this can't be turned into an open redirect.
  const requested = url.searchParams.get('redirect') ?? ''
  const dest =
    requested.startsWith('/admin') && !requested.startsWith('//') && !requested.includes('..')
      ? requested
      : '/admin'

  return setCookieHeader(
    new Response(null, { status: 302, headers: { location: dest } }),
    sessionCookie(req, token, expiresAt),
  )
}
