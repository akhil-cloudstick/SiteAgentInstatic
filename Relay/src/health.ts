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
 * `live` is true when Access and roles are configured and the relay holds a
 * real 32-byte Ed25519 owner key. It deliberately does NOT claim that any given
 * property can be approved: that depends on the approver registry, which this
 * route does not read because health must never touch storage. `/api/approvers`
 * answers that question, and needs no login either.
 */

import { APPROVERS_PATH } from './approvers'
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

export async function health(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'Use GET.' }), { status: 405, headers: HEADERS })
  }
  const fingerprint = await ownerKeyFingerprint(env)
  const body = {
    live: readConfig(env).ok && fingerprint !== null,
    version: RELAY_VERSION,
    ownerKeyFingerprint: fingerprint,
    // Not the approvers themselves — a pointer to where they are.
    //
    // This field used to publish a property → fingerprint map read out of an
    // environment variable. Once approvers moved into the registry that map
    // became a second copy that could disagree with the one actually deciding
    // approvals, which is the exact failure R6 exists to remove. The registry
    // route needs no credential either, so nothing is lost by sending a reader
    // one step further to the answer that is true.
    approverRegistry: APPROVERS_PATH,
  }
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status: 200, headers: HEADERS })
}
