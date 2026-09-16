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

async function ownerKeyFingerprint(env: Env): Promise<string | null> {
  const key = env.OWNER_PUBLIC_KEY?.trim() ?? ''
  if (!key) return null
  try {
    return base64ToBytes(key).length === 32 ? await keyFingerprint(key) : null
  } catch {
    return null
  }
}

export async function health(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'Use GET.' }), { status: 405, headers: HEADERS })
  }
  const fingerprint = await ownerKeyFingerprint(env)
  const body = {
    live: readConfig(env).ok && fingerprint !== null,
    version: RELAY_VERSION,
    ownerKeyFingerprint: fingerprint,
  }
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status: 200, headers: HEADERS })
}
