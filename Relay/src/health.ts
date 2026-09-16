/**
 * `GET /api/health` — the one route that needs no login.
 *
 * For an outside status page: is the relay live, which build is running, and
 * which owner key it holds. The fingerprint is how a swapped key gets caught
 * without anyone logging in. It returns exactly those three fields and reads
 * nothing but configuration — no store, no tickets, no identities — which is
 * what makes it safe to leave open.
 *
 * Cloudflare Access sits in front of the whole relay, so this one path needs
 * its own Access application with a Bypass policy (README, "Deploy").
 *
 * `live` is true only when the relay would both serve requests and record a
 * GO: Access and roles configured, and an owner key present that is a real
 * 32-byte Ed25519 key.
 */

import { readConfig, type Env } from './config'
import { base64ToBytes, keyFingerprint } from './go'
import { RELAY_VERSION } from './version'

export const HEALTH_PATH = '/api/health'

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  // A status page on another origin reads it from the browser; the body is public by design.
  'access-control-allow-origin': '*',
  'x-content-type-options': 'nosniff',
}

async function fingerprintOf(key: string): Promise<string | null> {
  if (!key) return null
  try {
    return base64ToBytes(key).length === 32 ? await keyFingerprint(key) : null
  } catch {
    return null
  }
}

async function ownerKeyFingerprint(env: Env): Promise<string | null> {
  return fingerprintOf(env.OWNER_PUBLIC_KEY?.trim() ?? '')
}

/**
 * Per-property approver fingerprints, so the key a property is approved by can
 * be compared against the Connector's policy without logging in — the same
 * check the single owner fingerprint already allows for the default approver.
 */
async function propertyApproverFingerprints(env: Env): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const raw = env.PROPERTY_APPROVERS?.trim() ?? ''
  if (!raw) return out
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out
    for (const [property, key] of Object.entries(parsed)) {
      if (typeof key !== 'string') continue
      const fingerprint = await fingerprintOf(key.trim())
      if (fingerprint) out[property] = fingerprint
    }
  } catch {
    // Malformed: `readConfig` reports it and keeps the relay shut. Nothing to show.
  }
  return out
}

export async function health(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'Use GET.' }), { status: 405, headers: HEADERS })
  }
  const fingerprint = await ownerKeyFingerprint(env)
  const approvers = await propertyApproverFingerprints(env)
  const body = {
    // A relay that approves only named properties is live without a default key.
    live: readConfig(env).ok && (fingerprint !== null || Object.keys(approvers).length > 0),
    version: RELAY_VERSION,
    ownerKeyFingerprint: fingerprint,
    approvers,
  }
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status: 200, headers: HEADERS })
}
