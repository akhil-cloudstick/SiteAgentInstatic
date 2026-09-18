/**
 * Tenant SSO hand-off.
 *
 *   GET  /cms/api/cms/sso?token=<signed>          sign a hub person (or the machine) in
 *   POST /cms/api/cms/sso/people {token}          the control plane's people list
 *
 * When the SiteAgent control-plane runs this instance for a tenant it sets
 * INSTATIC_SSO_SECRET. When the secret is unset (plain self-hosted install)
 * both routes return null (inert).
 *
 * MMS Phase 1 (NEW-3): the hand-off names a PERSON and their role. They are
 * signed in as their own CMS account with that role, and nothing about the
 * session pre-satisfies step-up — a step-up-gated action asks for their hub
 * password (see handlers/cms/auth.ts). Only a machine hand-off (the MCP gateway,
 * the design studio's server-side staging) opens an owner session with
 * step-up, because an agent has no password to re-enter; the hub never mints
 * one. A GET is a safe method, so the CMS CSRF origin check does not apply —
 * the signed token is the authenticator.
 */
import type { DbClient } from '../../db/client'
import { createSessionToken, hashSessionToken, sessionExpiry } from '../../auth/tokens'
import { createSession } from '../../auth/sessions'
import { verifySsoToken, verifyPeopleSync, ssoSecret } from '../../auth/tenantSso'
import { parseHubContextFromSso } from '../../auth/hubContext'
import { findActiveOwner } from '../../repositories/users'
import { resolveHubAccount, syncHubPeople } from '../../repositories/hubUsers'
import { createAuditEvent } from '../../repositories/audit'
import { Type } from '@core/utils/typeboxHelpers'
import { jsonResponse, readValidatedBody, setCookieHeader } from '../../http'
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
  // Inert outside managed (control-plane) mode.
  if (!ssoSecret()) return null
  if (url.pathname === `${CMS_API_PREFIX}/sso/people` && req.method === 'POST') {
    return handlePeopleSync(req, db)
  }
  if (url.pathname !== `${CMS_API_PREFIX}/sso`) return null
  if (req.method !== 'GET') return null

  const payload = verifySsoToken(url.searchParams.get('token') ?? '')
  if (!payload) {
    return plainText('Sign-in link invalid or expired. Return to your hub and open the workspace again.', 401)
  }

  let userId: string
  let hubPersonId: string | null = null
  if (payload.person) {
    const account = await resolveHubAccount(db, payload.person)
    if (!account.ok) return plainText(account.message, account.status)
    userId = account.userId
    hubPersonId = payload.person.id
  } else {
    const owner = await findActiveOwner(db)
    if (!owner) return plainText('This workspace is not set up yet.', 409)
    userId = owner.id
  }

  const token = createSessionToken()
  const expiresAt = sessionExpiry()
  // The authorized scope the Hub opened us with (role, client, project, site,
  // originating surface, return URL). Stored on the session so the Product Hub
  // header row and `Back to Product Hub` survive reloads and soft navigation
  // without re-round-tripping the hub. Display only — authority comes from the
  // signed person above. `null` on a self-hosted install.
  const hubContext = parseHubContextFromSso(url)
  await createSession(db, {
    idHash: await hashSessionToken(token),
    userId,
    expiresAt,
    // The hub has authenticated the person; CMS-local MFA does not apply to a
    // hub sign-in. Step-up is a separate, per-action check and stays demanded.
    mfaPassedAt: new Date(),
    stepUpExpiresAt: payload.actor === 'machine' ? expiresAt : null,
    hubContext,
    hubPersonId,
    ...requestAuditContext(req),
  })
  await createAuditEvent(db, {
    actorUserId: userId,
    action: 'login.success',
    targetType: 'user',
    targetId: userId,
    metadata: payload.person
      ? { source: 'sso', hubPersonId, role: payload.person.role }
      : { source: 'sso', actor: 'machine' },
    ...requestAuditContext(req),
  })

  // Optional post-sign-in landing page (e.g. Share-to-CMS lands on the site editor).
  // Restricted to in-app /admin paths so this can't be turned into an open redirect.
  const requested = url.searchParams.get('redirect') ?? ''
  const dest =
    requested.startsWith('/cms') && !requested.startsWith('//') && !requested.includes('..')
      ? requested
      : '/cms'

  return setCookieHeader(
    new Response(null, { status: 302, headers: { location: dest } }),
    sessionCookie(req, token, expiresAt),
  )
}

const PeopleSyncBodySchema = Type.Object({ token: Type.String({ maxLength: 2_000_000 }) })

/**
 * The control plane's list of this project's people. Roles follow it; anyone
 * no longer on it (removed at the hub) is suspended and signed out, even if
 * they never sign in again. Server-to-server; the signed token is the
 * authenticator and carries the list itself.
 */
async function handlePeopleSync(req: Request, db: DbClient): Promise<Response> {
  const body = await readValidatedBody(req, PeopleSyncBodySchema, { maxBytes: 2_000_000 })
  const sync = verifyPeopleSync(body?.token ?? '')
  if (!sync) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
  const result = await syncHubPeople(db, sync.people)
  return jsonResponse({ ok: true, ...result })
}
