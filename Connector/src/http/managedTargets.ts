/**
 * Sites created through the connector become reachable by the connector.
 *
 * Two changes that were individually right collided. `connector_create_site`
 * was added so the studio stops waiting on us to provision each client; target
 * derivation became an explicit allowlist after an internal tenant appeared on
 * an external partner's target list. Together they produced a site that can be
 * created and then not used — the dependency moved from "ask the dev to create
 * it" to "ask the dev to allowlist it", which costs the caller exactly the same
 * and is worse for being unexpected.
 *
 * This closes it without giving the allowlist back. The rule is ownership, not
 * a list: a tenant provisioned THROUGH this connector is flagged
 * `connector_managed` in the registry, and only those are auto-enrolled. A
 * tenant we create ourselves stays invisible no matter how many are added,
 * which is the exposure the allowlist existed to prevent. So the safe default
 * and the convenient one stop being in tension.
 *
 * Refresh is pull-on-demand rather than a restart because `parseTargets()`
 * re-reads `MMS_TARGETS` on every call — the process can learn a new target
 * mid-life. Nothing here is cached longer than a few seconds, so a site becomes
 * addressable as soon as its provisioning finishes.
 */

import { TARGETS_ENV } from './config'

const CONTROL_PLANE_URL_ENV = 'MMS_CONTROL_PLANE_URL'
const TOKEN_ENV = 'MMS_CONNECTOR_MCP_TOKEN'

/**
 * How long a refresh result is reused.
 *
 * Short, because the thing being waited on is a 30-60s provisioning saga and a
 * caller polling `connector_target` should see the site the moment it is ready.
 * Non-zero, because a tool chain can call this several times in one turn and
 * the control plane should not field a request per tool.
 */
const REFRESH_TTL_MS = 5_000

let lastRefreshAt = 0
let lastError: string | undefined

function controlPlaneUrl(): string {
  return (process.env[CONTROL_PLANE_URL_ENV] ?? 'http://127.0.0.1:4400').replace(/\/+$/, '')
}

interface ManagedTarget {
  url?: string
  email?: string
  secret?: string
}

/**
 * Merge connector-managed targets into the live target map.
 *
 * Merged UNDER what is already configured, never over it: an operator-set entry
 * in `MMS_TARGETS` is a deliberate decision — a corrected port, a different
 * account — and a background refresh silently replacing it would be a
 * configuration change nobody made.
 *
 * Failure is deliberately quiet. This runs opportunistically inside unrelated
 * tool calls, and the control plane being briefly unreachable should degrade to
 * "the new site is not addressable yet", not turn `connector_target` into an
 * error. The reason is kept and reported by `connector_target` so the state is
 * still visible when someone looks.
 */
export async function refreshManagedTargets(force = false): Promise<void> {
  const now = Date.now()
  if (!force && now - lastRefreshAt < REFRESH_TTL_MS) return
  lastRefreshAt = now

  const token = process.env[TOKEN_ENV]?.trim()
  if (!token) {
    lastError = `${TOKEN_ENV} is not set, so managed targets cannot be fetched.`
    return
  }

  try {
    const res = await fetch(`${controlPlaneUrl()}/api/connector/targets`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      lastError = `control plane returned HTTP ${res.status} for /api/connector/targets`
      return
    }
    const body = (await res.json()) as { targets?: Record<string, ManagedTarget> }
    const managed = body.targets ?? {}

    let current: Record<string, ManagedTarget> = {}
    try {
      const raw = process.env[TARGETS_ENV]?.trim()
      if (raw) current = JSON.parse(raw) as Record<string, ManagedTarget>
    } catch {
      // Unparseable existing value: replacing it would destroy whatever an
      // operator meant to write. Leave it, and let config.ts report the syntax
      // error against the value they actually set.
      lastError = `${TARGETS_ENV} is not valid JSON; managed targets were not merged.`
      return
    }

    let added = 0
    for (const [name, t] of Object.entries(managed)) {
      if (current[name]) continue // already configured — theirs wins
      if (!t.url || !t.email || !t.secret) continue // incomplete: skip, do not emit a broken target
      current[name] = t
      added++
    }
    if (added > 0) {
      process.env[TARGETS_ENV] = JSON.stringify(current)
      console.log(`[connector] ${added} connector-managed target(s) now reachable`)
    }
    lastError = undefined
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
  }
}

/** Why the last refresh did not produce targets, if it did not. */
export function managedTargetsError(): string | undefined {
  return lastError
}
