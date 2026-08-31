/**
 * Live sessions, one per target, held in memory only.
 *
 * Keyed by target name so two tenants can be worked on in the same process
 * without either inheriting the other's session. That isolation is the point:
 * a single shared session would make "which site did that write land in" a
 * question of call ordering.
 *
 * In memory and nowhere else — a session cookie written to disk outlives the
 * process that earned it and becomes a credential lying around on the host.
 * Losing sessions on restart is the correct trade.
 */

import { InstaticSession } from './session'
import { resolveTarget } from './config'

const sessions = new Map<string, InstaticSession>()

export function connectedTargets(): string[] {
  return [...sessions.entries()]
    .filter(([, s]) => s.authenticated)
    .map(([name]) => name)
    .sort()
}

export async function connect(targetName?: string, mfaCode?: string): Promise<string> {
  const target = resolveTarget(targetName)
  // Drop any existing session BEFORE attempting login. A failed re-auth reads as
  // "not connected", so leaving the previous session in place means later calls keep
  // running under the old cookie — the identity the operator was trying to replace.
  sessions.delete(target.name)
  const session = new InstaticSession({
    baseUrl: target.baseUrl,
    apiPrefix: target.apiPrefix,
  })
  await session.login(target.email, target.secret, mfaCode)
  sessions.set(target.name, session)
  return target.name
}

/**
 * The session for a target, or a clear instruction to open one.
 *
 * Resolving the target first means an unknown name is reported as an unknown
 * name, rather than as "not connected" — which would send someone off checking
 * credentials for a target that was never configured.
 */
export function requireSession(targetName?: string): InstaticSession {
  const target = resolveTarget(targetName)
  const session = sessions.get(target.name)
  if (!session?.authenticated) {
    throw new Error(
      `Not connected to "${target.name}". Run connector_connect with target "${target.name}" first.`,
    )
  }
  return session
}

export function disconnect(targetName?: string): string[] {
  if (!targetName) {
    const all = connectedTargets()
    sessions.clear()
    return all
  }
  const target = resolveTarget(targetName)
  sessions.delete(target.name)
  return [target.name]
}
