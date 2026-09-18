/**
 * Tenant SSO token verification (managed / control-plane mode only).
 *
 * When the SiteAgent control-plane runs this instance for a tenant it sets
 * INSTATIC_SSO_SECRET (this project's own key — derived by the control plane
 * from its master key and the project slug, so it is useless for any other
 * project) and INSTATIC_TENANT_SLUG. The hub redirects a person to
 * `/cms/api/cms/sso?token=<signed>`; this module verifies that token. The
 * format mirrors the control-plane's signValue():
 *   base64url(JSON incl. `exp` in ms) + "." + base64url(HMAC-SHA256(base64url part)).
 * When the secret is unset (a plain self-hosted install) verification always
 * fails, so the SSO route stays inert.
 *
 * MMS Phase 1 (NEW-3): a hand-off names exactly one of
 *   - `person` — a person from the hub, with their own role (one of the four
 *     CMS roles). They are signed in as themselves, with no step-up.
 *   - `actor: 'machine'` — the control plane's MCP gateway or the design
 *     studio's server-side staging. Signed in as the owner, with step-up open,
 *     because an agent has no password to re-enter. The hub never mints these.
 * A token naming neither (the pre-Phase-1 shape) is refused.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Static } from '@sinclair/typebox'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'

export const HUB_ROLES = ['owner', 'admin', 'client', 'member'] as const
export type HubRoleId = (typeof HUB_ROLES)[number]

const HubPersonSchema = Type.Object({
  id: Type.String({ pattern: '^[0-9]+$' }),
  email: Type.Union([Type.String(), Type.Null()]),
  role: Type.Union(HUB_ROLES.map((r) => Type.Literal(r))),
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})

export type HubPerson = Static<typeof HubPersonSchema>

const SsoTokenSchema = Type.Object({
  sub: Type.String(),
  kind: Type.String(),
  target: Type.Optional(Type.String()),
  exp: Type.Number(),
  person: Type.Optional(HubPersonSchema),
  actor: Type.Optional(Type.Literal('machine')),
})

type SsoToken = Static<typeof SsoTokenSchema>

const PeopleSyncSchema = Type.Object({
  sub: Type.String(),
  kind: Type.Literal('people-sync'),
  exp: Type.Number(),
  people: Type.Array(
    Type.Object({
      email: Type.String(),
      role: Type.Union(HUB_ROLES.map((r) => Type.Literal(r))),
      status: Type.Union([Type.Literal('active'), Type.Literal('removed')]),
    }),
    { maxItems: 10_000 },
  ),
})

export type PeopleSync = Static<typeof PeopleSyncSchema>

export function ssoSecret(): string {
  return (process.env.INSTATIC_SSO_SECRET ?? '').trim()
}

function tenantSlug(): string {
  return (process.env.INSTATIC_TENANT_SLUG ?? '').trim()
}

function hmac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

/** The verified JSON payload of a token signed with this project's key, else null. */
function verifySigned(token: string): unknown {
  const secret = ssoSecret()
  if (!secret || !token || !token.includes('.')) return null
  const idx = token.lastIndexOf('.')
  const b64 = token.slice(0, idx)
  const a = Buffer.from(token.slice(idx + 1))
  const b = Buffer.from(hmac(secret, b64))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function forThisProject(payload: { sub: string; exp: number }): boolean {
  if (Date.now() > payload.exp) return false
  const slug = tenantSlug()
  return !slug || payload.sub === slug
}

export function verifySsoToken(token: string): SsoToken | null {
  const parsed = safeParseValue(SsoTokenSchema, verifySigned(token))
  if (!parsed.ok) return null
  const payload = parsed.value
  if (!forThisProject(payload)) return null
  if (payload.kind !== 'sso' || payload.target !== 'instatic') return null
  // Exactly one identity: a person, or the machine.
  if (Boolean(payload.person) === (payload.actor === 'machine')) return null
  return payload
}

/** The people list the control plane pushes after a change (see sso.ts). */
export function verifyPeopleSync(token: string): PeopleSync | null {
  const parsed = safeParseValue(PeopleSyncSchema, verifySigned(token))
  if (!parsed.ok || !forThisProject(parsed.value)) return null
  return parsed.value
}

/**
 * Sign a short-lived request to the control plane with this project's key.
 * Used for step-up: "is this the hub password of person N?".
 */
export function signProjectRequest(payload: Record<string, unknown>, ttlSec = 30): string | null {
  const secret = ssoSecret()
  const slug = tenantSlug()
  if (!secret || !slug) return null
  const b64 = Buffer.from(
    JSON.stringify({ ...payload, sub: slug, exp: Date.now() + ttlSec * 1000 }),
    'utf8',
  ).toString('base64url')
  return `${b64}.${hmac(secret, b64)}`
}

export function projectSlug(): string {
  return tenantSlug()
}
