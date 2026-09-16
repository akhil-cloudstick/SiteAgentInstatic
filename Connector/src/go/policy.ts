/**
 * Whose signature a GO needs, and which targets need one at all.
 *
 * `go-policy.json` next to the Connector (or wherever `MMS_CONNECTOR_GO_POLICY`
 * points):
 *
 *   { "ownerPublicKey": "<base64 raw Ed25519 key>", "ungated": ["sheeltron-staging"] }
 *
 * Fail-closed in the same direction as the target allowlist
 * (`Operator/control-plane/lib/connectorAllowlist.mjs`). A missing or unreadable
 * file does not mean "no gate configured"; it means nothing gated can run and
 * no target is known to be ungated. Forgetting the file costs the ability to
 * deploy, never the control. A readable file with no usable key still honours
 * `ungated` — that is a deliberate state, not a typo — and refuses the rest.
 *
 * Read on every gated call rather than cached, so a key installed or rotated
 * applies to the next call instead of the next restart. The two tools that read
 * it are the rarest calls the Connector serves.
 *
 * The key lives in a file the builder controls, so the builder could swap it.
 * That is why every gated response carries the key's fingerprint: a swap shows
 * up in the relay's record and in the owner's own detection.
 */

import { createHash, createPublicKey, type KeyObject } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const GO_POLICY_ENV = 'MMS_CONNECTOR_GO_POLICY'

/** SPKI DER header for an Ed25519 public key; the raw 32 bytes follow it. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export interface GoPolicy {
  /** Absent when the file names no usable key — gated targets then refuse. */
  ownerKey?: KeyObject
  ownerKeyFingerprint?: string
  /** Why `ownerKey` is absent, for the refusal message. */
  keyProblem?: string
  ungated: string[]
}

export type GoPolicyLoad = { ok: true; policy: GoPolicy } | { ok: false; reason: string }

export function goPolicyPath(): string {
  const configured = process.env[GO_POLICY_ENV]?.trim()
  return configured ? resolve(configured) : resolve(import.meta.dir, '../../go-policy.json')
}

/** First 16 hex of sha256 over the raw key — short enough to compare by eye. */
export function keyFingerprint(rawKey: Uint8Array): string {
  return createHash('sha256').update(rawKey).digest('hex').slice(0, 16)
}

export function ownerKeyFromBase64(b64: string): { key: KeyObject; raw: Uint8Array } | undefined {
  const raw = Buffer.from(b64.trim(), 'base64')
  if (raw.length !== 32) return undefined
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    })
    return { key, raw }
  } catch {
    return undefined
  }
}

export function loadGoPolicy(): GoPolicyLoad {
  const file = goPolicyPath()
  if (!existsSync(file)) {
    return { ok: false, reason: `No GO policy at ${file}, so no gated action can run.` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    // Loud, and still closed. A typo must not open anything — including the
    // `ungated` list, which is only trusted from a file that actually parsed.
    return {
      ok: false,
      reason:
        `${file} is not readable JSON (${err instanceof Error ? err.message : String(err)}), so no ` +
        'gated action can run and no target is treated as ungated.',
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: `${file} must hold a JSON object, so no gated action can run.` }
  }

  const p = parsed as { ownerPublicKey?: unknown; ungated?: unknown }
  const policy: GoPolicy = {
    ungated: Array.isArray(p.ungated) ? p.ungated.map((s) => String(s).trim()).filter(Boolean) : [],
  }

  const b64 = typeof p.ownerPublicKey === 'string' ? p.ownerPublicKey.trim() : ''
  const owner = b64 ? ownerKeyFromBase64(b64) : undefined
  if (owner) {
    policy.ownerKey = owner.key
    policy.ownerKeyFingerprint = keyFingerprint(owner.raw)
  } else {
    policy.keyProblem = b64
      ? 'an ownerPublicKey that is not a base64 raw 32-byte Ed25519 key'
      : 'no ownerPublicKey set'
  }
  return { ok: true, policy }
}
