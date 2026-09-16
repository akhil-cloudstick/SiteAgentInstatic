/**
 * Who is calling — from the Cloudflare Access assertion, verified here.
 *
 * Access sits in front of the Worker, but the Worker does not trust that it
 * did: every request's `Cf-Access-Jwt-Assertion` is verified against the team's
 * signing keys, audience, issuer and expiry. A request that reaches the Worker
 * some other way (a misconfigured policy, an unprotected route) carries no
 * valid assertion and is refused.
 *
 * The identities, and nothing else: the owner's email; the builder emails, or
 * the builder's service tokens for its tooling; and the validator's service
 * token (Access puts a token's ID in `common_name`). Access itself is not the
 * control on GO — the relay is in the builder's account, so the builder
 * administers Access and could add identities. The owner's signature is the
 * control; this only decides who may read and write.
 */

import { base64ToBytes } from './go'
import type { Actor } from './types'

export interface AccessConfig {
  /** e.g. `yourteam.cloudflareaccess.com` */
  teamDomain: string
  aud: string
  ownerEmail: string
  builderEmails: string[]
  /** Service token IDs for builder tooling — opening tickets and uploading artefacts without a browser. */
  builderTokenIds: string[]
  validatorTokenId: string
}

export type AuthResult = { ok: true; actor: Actor } | { ok: false; reason: string }

const KEY_TTL_MS = 10 * 60_000
let cachedKeys: { teamDomain: string; fetchedAt: number; keys: Map<string, CryptoKey> } | null = null

export function resetAccessKeyCache(): void {
  cachedKeys = null
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  return base64ToBytes(padded)
}

async function accessKeys(
  teamDomain: string,
  fetchImpl: typeof fetch,
  now: number,
  force: boolean,
): Promise<Map<string, CryptoKey>> {
  if (!force && cachedKeys && cachedKeys.teamDomain === teamDomain && now - cachedKeys.fetchedAt < KEY_TTL_MS) {
    return cachedKeys.keys
  }
  const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`)
  if (!res.ok) throw new Error(`Access certs answered HTTP ${res.status}`)
  const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] }
  const keys = new Map<string, CryptoKey>()
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid) continue
    keys.set(
      jwk.kid,
      await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']),
    )
  }
  cachedKeys = { teamDomain, fetchedAt: now, keys }
  return keys
}

const denied = (reason: string): AuthResult => ({ ok: false, reason })

export async function authenticate(
  req: Request,
  cfg: AccessConfig,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<AuthResult> {
  const token = req.headers.get('cf-access-jwt-assertion')
  if (!token) return denied('No Cloudflare Access assertion on the request.')

  const parts = token.split('.')
  if (parts.length !== 3) return denied('The Access assertion is not a JWT.')
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string]

  let header: { alg?: unknown; kid?: unknown }
  let payload: Record<string, unknown>
  try {
    const decoder = new TextDecoder()
    header = JSON.parse(decoder.decode(base64UrlToBytes(rawHeader))) as typeof header
    payload = JSON.parse(decoder.decode(base64UrlToBytes(rawPayload))) as Record<string, unknown>
  } catch {
    return denied('The Access assertion could not be decoded.')
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    return denied('The Access assertion is not RS256 with a key id.')
  }

  let key: CryptoKey | undefined
  try {
    key = (await accessKeys(cfg.teamDomain, fetchImpl, now, false)).get(header.kid)
    // A key rotation shows up as an unknown kid; refetch once before refusing.
    if (!key) key = (await accessKeys(cfg.teamDomain, fetchImpl, now, true)).get(header.kid)
  } catch {
    return denied('Could not fetch the Access signing keys.')
  }
  if (!key) return denied('The Access assertion is signed by an unknown key.')

  const signed = new TextEncoder().encode(`${rawHeader}.${rawPayload}`)
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlToBytes(rawSignature), signed)
  if (!valid) return denied('The Access assertion signature is invalid.')

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!audiences.includes(cfg.aud)) return denied('The Access assertion is for a different application.')
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return denied('The Access assertion has expired.')
  if (payload.iss !== `https://${cfg.teamDomain}`) return denied('The Access assertion has the wrong issuer.')

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
  const commonName = typeof payload.common_name === 'string' ? payload.common_name : ''

  if (email && email === cfg.ownerEmail) return { ok: true, actor: { role: 'owner', subject: email } }
  if (email && cfg.builderEmails.includes(email)) return { ok: true, actor: { role: 'builder', subject: email } }
  if (!email && commonName) {
    if (commonName === cfg.validatorTokenId) {
      return { ok: true, actor: { role: 'validator', subject: `service:${commonName}` } }
    }
    if (cfg.builderTokenIds.includes(commonName)) {
      return { ok: true, actor: { role: 'builder', subject: `service:${commonName}` } }
    }
  }
  return denied('This identity has no role on the relay.')
}
