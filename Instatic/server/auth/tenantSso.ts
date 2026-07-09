/**
 * Tenant SSO token verification (managed / control-plane mode only).
 *
 * When the SiteAgent control-plane runs this instance for a tenant it sets
 * INSTATIC_SSO_SECRET (a shared HMAC secret) and INSTATIC_TENANT_SLUG. The hub
 * redirects the tenant to `/admin/api/cms/sso?token=<signed>`; this module
 * verifies that token. The format mirrors the control-plane's signValue():
 *   base64url(JSON incl. `exp` in ms) + "." + base64url(HMAC-SHA256(base64url part)).
 * When the secret is unset (a plain self-hosted install) verification always
 * fails, so the SSO route stays inert.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Static } from '@sinclair/typebox'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'

const SsoTokenSchema = Type.Object({
  sub: Type.String(),
  kind: Type.String(),
  target: Type.Optional(Type.String()),
  exp: Type.Number(),
})

type SsoToken = Static<typeof SsoTokenSchema>

export function ssoSecret(): string {
  return (process.env.INSTATIC_SSO_SECRET ?? '').trim()
}

export function verifySsoToken(token: string): SsoToken | null {
  const secret = ssoSecret()
  if (!secret || !token || !token.includes('.')) return null
  const idx = token.lastIndexOf('.')
  const b64 = token.slice(0, idx)
  const mac = token.slice(idx + 1)
  const expected = createHmac('sha256', secret).update(b64).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const parsed = safeParseValue(SsoTokenSchema, raw)
  if (!parsed.ok) return null
  const payload = parsed.value

  if (Date.now() > payload.exp) return null
  if (payload.kind !== 'sso' || payload.target !== 'instatic') return null
  const slug = (process.env.INSTATIC_TENANT_SLUG ?? '').trim()
  if (slug && payload.sub !== slug) return null
  return payload
}
