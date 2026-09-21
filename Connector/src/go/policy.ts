/**
 * That a GO is required at all, and the local settings behind it.
 *
 * WHOSE signature approves a property no longer lives here — it moved to the
 * approver registry both ends read (`./registry.ts`, R6). This file used to
 * hold a second copy of that map, kept in step with the relay's by a human
 * comparing fingerprints; a property's approver is now looked up in one place.
 *
 * `go-policy.json` next to the Connector (or wherever `MMS_CONNECTOR_GO_POLICY`
 * points) is what remains:
 *
 *   {
 *     "ownerPublicKey": "<base64 raw Ed25519 key>",
 *     "targets": { "sheeltron": { "ownerPublicKey": "<base64 raw Ed25519 key>" } },
 *   }
 *
 * Both fields are read for backwards compatibility and are no longer consulted
 * when checking a GO. A `targets` entry whose
 * key is unusable refuses that target outright instead of falling back to the
 * default — a property whose approver is misconfigured must never become
 * approvable by the platform's own key.
 *
 * Fail-closed in the same direction as the target allowlist
 * (`Operator/control-plane/lib/connectorAllowlist.mjs`). A missing or unreadable
 * file does not mean "no gate configured"; it means nothing gated can run and
 * nothing gated can run. Forgetting the file costs the ability to deploy,
 * never the control.
 *
 * There is no exemption list. There used to be one, naming staging properties
 * that needed no approval; it was removed because "a staging project exempted
 * from the approval gate proves nothing" (PRD 5.4) — the loop being rehearsed
 * has to be the real one, and a mechanism that switches the gate off for a
 * property is one edit away from doing it for a live site.
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

/** One approver's key, or why the file yields none for it. */
export interface Approver {
  key?: KeyObject
  fingerprint?: string
  /** Why `key` is absent, for the refusal message. */
  problem?: string
}

export interface GoPolicy {
  /** Absent when the file names no usable key — gated targets then refuse. */
  ownerKey?: KeyObject
  ownerKeyFingerprint?: string
  /** Why `ownerKey` is absent, for the refusal message. */
  keyProblem?: string
  /** Per-property approvers, by resolved target name. */
  targets: Record<string, Approver>
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
    // file at all.
    return {
      ok: false,
      reason:
        `${file} is not readable JSON (${err instanceof Error ? err.message : String(err)}), so no ` +
        'gated action can run.',
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: `${file} must hold a JSON object, so no gated action can run.` }
  }

  const p = parsed as { ownerPublicKey?: unknown; targets?: unknown }
  const policy: GoPolicy = {
    targets: {},
  }

  const owner = readApprover(p.ownerPublicKey)
  if (owner.key) {
    policy.ownerKey = owner.key
    policy.ownerKeyFingerprint = owner.fingerprint
  } else {
    policy.keyProblem = owner.problem
  }

  if (p.targets && typeof p.targets === 'object' && !Array.isArray(p.targets)) {
    for (const [name, entry] of Object.entries(p.targets as Record<string, unknown>)) {
      const target = name.trim()
      if (!target) continue
      const key = entry && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as { ownerPublicKey?: unknown }).ownerPublicKey
        : entry
      policy.targets[target] = readApprover(key)
    }
  }
  return { ok: true, policy }
}

function readApprover(raw: unknown): Approver {
  const b64 = typeof raw === 'string' ? raw.trim() : ''
  const parsed = b64 ? ownerKeyFromBase64(b64) : undefined
  if (parsed) return { key: parsed.key, fingerprint: keyFingerprint(parsed.raw) }
  return {
    problem: b64
      ? 'an ownerPublicKey that is not a base64 raw 32-byte Ed25519 key'
      : 'no ownerPublicKey set',
  }
}

/**
 * Whose signature approves this property.
 *
 * A property with its own entry is approved by that key alone: an entry that
 * names an unusable key refuses, rather than quietly handing approval of a
 * client's site back to the platform's key.
 */
export function approverFor(
  policy: GoPolicy,
  target: string,
): { ok: true; key: KeyObject; fingerprint: string; scope: 'property' | 'default' } | { ok: false; problem: string } {
  const own = policy.targets[target]
  if (own) {
    return own.key && own.fingerprint
      ? { ok: true, key: own.key, fingerprint: own.fingerprint, scope: 'property' }
      : { ok: false, problem: `${own.problem} for "${target}"` }
  }
  return policy.ownerKey && policy.ownerKeyFingerprint
    ? { ok: true, key: policy.ownerKey, fingerprint: policy.ownerKeyFingerprint, scope: 'default' }
    : { ok: false, problem: policy.keyProblem ?? 'no ownerPublicKey set' }
}
