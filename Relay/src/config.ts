/**
 * Worker environment → relay configuration. Fail-closed: any missing Access or
 * role setting keeps the whole relay shut with a 503 naming what is missing,
 * rather than running with a hole in who-may-do-what.
 *
 * `OWNER_PUBLIC_KEY` is the one exception. Without it the relay still carries
 * tickets and evidence; it simply cannot record a GO, and every page says so.
 */

import type { AccessConfig } from './auth'
import type { RelayConfig } from './deps'
import type { D1Database, R2Bucket } from './worker-types'

export interface Env {
  RELAY_DB: D1Database
  RELAY_ARTEFACTS: R2Bucket
  OWNER_PUBLIC_KEY?: string
  /**
   * JSON object: property name → base64 raw Ed25519 public key of that
   * property's approver, e.g. {"sheeltron":"<base64>"}. Unparseable JSON keeps
   * the relay shut rather than silently approving properties with the platform
   * key.
   */
  PROPERTY_APPROVERS?: string
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  ROLE_OWNER_EMAIL?: string
  ROLE_BUILDER_EMAILS?: string
  /** Optional: service token IDs that act as the builder, for tooling. */
  ROLE_BUILDER_TOKEN_IDS?: string
  ROLE_VALIDATOR_TOKEN_ID?: string
  STALL_MINUTES?: string
  GO_MAX_TTL_HOURS?: string
  NOTIFY_WEBHOOK_URL?: string
  PUBLIC_URL?: string
}

export type ConfigRead =
  | { ok: true; relay: RelayConfig; access: AccessConfig; webhookUrl: string; publicUrl: string }
  | { ok: false; problems: string[] }

/** Partner plan D4: a GO lives at most four hours. */
const GO_TTL_CEILING_HOURS = 4

const list = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export function readConfig(env: Env): ConfigRead {
  const problems: string[] = []
  const value = (name: keyof Env): string => {
    const v = env[name]
    return typeof v === 'string' ? v.trim() : ''
  }
  const required = (name: keyof Env): string => {
    const v = value(name)
    if (!v) problems.push(`${name} is not set`)
    return v
  }

  const teamDomain = required('ACCESS_TEAM_DOMAIN')
  const aud = required('ACCESS_AUD')
  const ownerEmail = required('ROLE_OWNER_EMAIL').toLowerCase()
  const builderEmails = list(required('ROLE_BUILDER_EMAILS')).map((e) => e.toLowerCase())
  const builderTokenIds = list(value('ROLE_BUILDER_TOKEN_IDS'))
  const validatorTokenId = required('ROLE_VALIDATOR_TOKEN_ID')
  if (ownerEmail && builderEmails.includes(ownerEmail)) {
    problems.push('ROLE_OWNER_EMAIL also appears in ROLE_BUILDER_EMAILS — one identity cannot hold both roles')
  }
  if (validatorTokenId && builderTokenIds.includes(validatorTokenId)) {
    problems.push('ROLE_VALIDATOR_TOKEN_ID also appears in ROLE_BUILDER_TOKEN_IDS — one token cannot hold both roles')
  }

  const stallMinutes = value('STALL_MINUTES') ? Number(value('STALL_MINUTES')) : 30
  if (!Number.isFinite(stallMinutes) || stallMinutes <= 0) problems.push('STALL_MINUTES must be a positive number')

  const goMaxTtlHours = value('GO_MAX_TTL_HOURS') ? Number(value('GO_MAX_TTL_HOURS')) : GO_TTL_CEILING_HOURS
  if (!Number.isFinite(goMaxTtlHours) || goMaxTtlHours <= 0 || goMaxTtlHours > GO_TTL_CEILING_HOURS) {
    problems.push(`GO_MAX_TTL_HOURS must be greater than 0 and at most ${GO_TTL_CEILING_HOURS}`)
  }

  // Fail-closed on a malformed map: a typo here must not leave properties
  // approvable by the platform key, which is the one outcome this setting
  // exists to prevent.
  const propertyApprovers: Record<string, string> = {}
  const rawApprovers = value('PROPERTY_APPROVERS')
  if (rawApprovers) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawApprovers)
    } catch {
      problems.push('PROPERTY_APPROVERS is not valid JSON')
    }
    if (parsed !== undefined) {
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        problems.push('PROPERTY_APPROVERS must be a JSON object of property name → base64 public key')
      } else {
        for (const [property, key] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof key !== 'string' || !key.trim()) {
            problems.push(`PROPERTY_APPROVERS["${property}"] must be a base64 public key`)
            continue
          }
          propertyApprovers[property.trim()] = key.trim()
        }
      }
    }
  }

  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    relay: { ownerPublicKey: value('OWNER_PUBLIC_KEY'), propertyApprovers, stallMinutes, goMaxTtlHours },
    access: { teamDomain, aud, ownerEmail, builderEmails, builderTokenIds, validatorTokenId },
    webhookUrl: value('NOTIFY_WEBHOOK_URL'),
    publicUrl: value('PUBLIC_URL').replace(/\/$/, ''),
  }
}
