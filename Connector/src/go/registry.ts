/**
 * The approver registry, as the checking side reads it (MMSBUILD R6).
 *
 * "The registry is the only place this mapping lives, and both ends read the
 * same registry" (PRD §5.3). Until now this side kept its own copy of the map
 * in a file committed to git, and a human comparing fingerprints was the only
 * thing keeping the two in step. This reads the registry itself.
 *
 * ── Why there is a cache, and why it expires ──────────────────────────────
 *
 * Two requirements pull in opposite directions:
 *
 *   R10 — this side must verify an approval "with the issuing side
 *   unreachable". A checker that stops working when the relay has a bad
 *   minute is a checker that will be turned off.
 *
 *   §5.3 — rotation "takes effect immediately: approvals signed by the retired
 *   identity stop being accepted the moment the new one is registered". A cache
 *   that outlives a rotation honours a key its owner has already retired.
 *
 * A GO cannot live longer than four hours — the relay refuses to sign one that
 * does. So a cached registry younger than that cannot be hiding a rotation that
 * matters: any approval the retired key could have signed has expired anyway.
 * The cache is refreshed every few minutes, survives a restart on disk, and is
 * REFUSED once it passes the age a GO could reach. A short relay outage changes
 * nothing; a long one closes the gate rather than trusting a stale answer.
 *
 * That is the whole of it: fresh enough to be right, old enough to be useful,
 * and closed when it is neither.
 */

import { createHash, createPublicKey, type KeyObject } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// The relay's address is already named once, for fetching artefacts by hash.
// The registry lives on that same relay, so this reads the same setting rather
// than inventing a second name for one address.
import { RELAY_URL_ENV } from '../http/relay'

export { RELAY_URL_ENV }
export const REGISTRY_CACHE_ENV = 'MMS_CONNECTOR_APPROVER_CACHE'

/** Re-read the registry this often. Short: a rotation should land in minutes. */
const REFRESH_MS = 5 * 60_000
/**
 * Refuse a cache older than this. Matches the relay's own ceiling on how long a
 * GO may live (`GO_MAX_TTL_HOURS`), which is what makes a stale-but-accepted
 * window impossible rather than merely unlikely.
 */
const MAX_AGE_MS = 4 * 60 * 60_000
const FETCH_TIMEOUT_MS = 5_000

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export interface RegistryApprover {
  property: string
  level: 'project' | 'business'
  covers?: string[]
  publicKey: string
  fingerprint: string
  effectiveFrom: string
}

interface CachedRegistry {
  at: string
  approvers: RegistryApprover[]
}

export type RegistryLoad =
  | { ok: true; approvers: RegistryApprover[]; at: string; fromCache: boolean }
  | { ok: false; reason: string }

let memory: { fetchedAtMs: number; body: CachedRegistry } | null = null

export function registryCachePath(): string {
  const configured = process.env[REGISTRY_CACHE_ENV]?.trim()
  return configured ? resolve(configured) : resolve(import.meta.dir, '../../.approver-cache.json')
}

function relayUrl(): string | null {
  const raw = process.env[RELAY_URL_ENV]?.trim()
  return raw ? raw.replace(/\/$/, '') : null
}

function readDiskCache(): { fetchedAtMs: number; body: CachedRegistry } | null {
  const file = registryCachePath()
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as CachedRegistry
    if (!parsed || !Array.isArray(parsed.approvers) || typeof parsed.at !== 'string') return null
    const fetchedAtMs = Date.parse(parsed.at)
    return Number.isFinite(fetchedAtMs) ? { fetchedAtMs, body: parsed } : null
  } catch {
    // A corrupt cache is no cache. It is never treated as an empty registry,
    // because "nobody may approve anything" and "I could not read the file"
    // must not look the same.
    return null
  }
}

function writeDiskCache(body: CachedRegistry): void {
  try {
    const file = registryCachePath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  } catch (err) {
    // Losing the cache costs a fetch, never a decision.
    console.warn(`[go] could not write the approver cache: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function fetchRegistry(base: string): Promise<CachedRegistry | null> {
  try {
    const res = await fetch(`${base}/api/approvers`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return null
    const body = (await res.json()) as CachedRegistry
    return body && Array.isArray(body.approvers) ? body : null
  } catch {
    return null
  }
}

/**
 * The live registry, or a refusal. Never an empty list standing in for either
 * — an empty registry means nobody may approve anything, and a failed read
 * must not be able to say that.
 */
export async function loadApprovers(now = Date.now()): Promise<RegistryLoad> {
  const base = relayUrl()
  if (!base) {
    return {
      ok: false,
      reason:
        `${RELAY_URL_ENV} is not set, so the approver registry cannot be read and no gated action can run.`,
    }
  }

  const cached = memory ?? readDiskCache()
  const fresh = cached && now - cached.fetchedAtMs < REFRESH_MS
  if (fresh) return { ok: true, approvers: cached!.body.approvers, at: cached!.body.at, fromCache: true }

  const fetched = await fetchRegistry(base)
  if (fetched) {
    memory = { fetchedAtMs: now, body: fetched }
    writeDiskCache(fetched)
    return { ok: true, approvers: fetched.approvers, at: fetched.at, fromCache: false }
  }

  // The relay did not answer. A recent copy still decides correctly, because a
  // GO cannot outlive the window it covers.
  if (cached && now - cached.fetchedAtMs < MAX_AGE_MS) {
    memory = cached
    return { ok: true, approvers: cached.body.approvers, at: cached.body.at, fromCache: true }
  }

  const age = cached ? `${Math.round((now - cached.fetchedAtMs) / 60_000)} minutes old` : 'no copy at all'
  return {
    ok: false,
    reason:
      `The approver registry at ${base} could not be read and the local copy is ${age}, ` +
      'so no gated action can run. A registry older than a GO can live cannot be trusted to know about a rotation.',
  }
}

/** Drop the in-memory copy. Tests, and anything that must re-read at once. */
export function forgetApprovers(): void {
  memory = null
}

export function keyFromBase64(b64: string): { key: KeyObject; raw: Uint8Array } | undefined {
  const raw = Buffer.from(b64.trim(), 'base64')
  if (raw.length !== 32) return undefined
  try {
    return {
      key: createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' }),
      raw,
    }
  } catch {
    return undefined
  }
}

export const fingerprintOf = (raw: Uint8Array): string =>
  createHash('sha256').update(raw).digest('hex').slice(0, 16)

/**
 * Whose signature approves this property — the same rule the relay applies
 * when it issues (`Relay/src/app.ts` approverFor):
 *
 *   1. the property's own approver;
 *   2. otherwise a business-level approver that EXPLICITLY names it;
 *   3. otherwise refuse.
 *
 * There is no step 4. A property nobody has registered an approver for is
 * refused, never handed to a platform-wide key: "a fallback that widens scope
 * on error is a master key by another name" (PRD §5.3).
 */
export function approverFromRegistry(
  approvers: RegistryApprover[],
  target: string,
):
  | { ok: true; key: KeyObject; fingerprint: string; scope: 'property' | 'business' }
  | { ok: false; problem: string } {
  const own = approvers.find((a) => a.level === 'project' && a.property === target)
  if (own) {
    const parsed = keyFromBase64(own.publicKey)
    return parsed
      ? { ok: true, key: parsed.key, fingerprint: fingerprintOf(parsed.raw), scope: 'property' }
      : { ok: false, problem: `the approver registered for "${target}" is not a usable Ed25519 public key` }
  }

  const delegated = approvers.find((a) => a.level === 'business' && (a.covers ?? []).includes(target))
  if (delegated) {
    const parsed = keyFromBase64(delegated.publicKey)
    return parsed
      ? { ok: true, key: parsed.key, fingerprint: fingerprintOf(parsed.raw), scope: 'business' }
      : {
          ok: false,
          problem: `the approver registered for "${delegated.property}", which covers "${target}", is not a usable Ed25519 public key`,
        }
  }

  return { ok: false, problem: `no approver is registered for "${target}"` }
}
