/**
 * Target configuration — several CMS instances, addressed by name.
 *
 * This is deliberately multi-target. An earlier single-target design could not
 * express the real deployment: each tenant runs its own Instatic on its own
 * port, and the public gateway chooses between them using a browser session
 * cookie. A server-to-server caller has no such cookie, so "which tenant" cannot
 * be inferred — it has to be stated.
 *
 * Two consequences worth being explicit about:
 *
 *   - **Point at the tenant, not the gateway.** The gateway multiplexes by
 *     cookie; addressing a tenant's own port removes the ambiguity entirely.
 *   - **These are Instatic credentials, not hub credentials.** The hub login is
 *     a control-plane account that mints SSO tokens into the tools. The
 *     connector talks to Instatic's own login endpoint, which is a separate
 *     credential store.
 *
 * Credentials are read from the environment, never accepted as tool arguments —
 * a secret passed as an argument has already travelled through the client and
 * into whatever transcript it keeps.
 */

export interface Target {
  name: string
  baseUrl: string
  apiPrefix: string
  email: string
  secret: string
}

export class TargetNotConfiguredError extends Error {
  override readonly name = 'TargetNotConfiguredError'
}

export const TARGETS_ENV = 'MMS_TARGETS'
export const DEFAULT_TARGET_ENV = 'MMS_DEFAULT_TARGET'

interface RawTarget {
  url?: string
  apiPrefix?: string
  email?: string
  secret?: string
}

function parseTargets(): Map<string, Target> {
  const raw = process.env[TARGETS_ENV]?.trim()
  if (!raw) return new Map()

  let parsed: Record<string, RawTarget>
  try {
    parsed = JSON.parse(raw) as Record<string, RawTarget>
  } catch (err) {
    throw new TargetNotConfiguredError(
      `${TARGETS_ENV} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const targets = new Map<string, Target>()
  for (const [name, t] of Object.entries(parsed)) {
    const missing = (['url', 'email', 'secret'] as const).filter((k) => !t[k]?.trim())
    if (missing.length > 0) {
      throw new TargetNotConfiguredError(
        `Target "${name}" is missing: ${missing.join(', ')}`,
      )
    }
    targets.set(name, {
      name,
      baseUrl: t.url!.trim().replace(/\/$/, ''),
      // Differs between this fork and public upstream, so it is configurable.
      apiPrefix: (t.apiPrefix?.trim() || '/cms/api/cms').replace(/\/$/, ''),
      email: t.email!.trim(),
      secret: t.secret!.trim(),
    })
  }
  return targets
}

export function targetNames(): string[] {
  return [...parseTargets().keys()].sort()
}

/**
 * Resolve a target by name. When no name is given, fall back to the configured
 * default, and then — only if exactly one target exists — to that one. With two
 * or more targets and no name, this refuses rather than guessing: picking a
 * tenant by chance is how content lands in the wrong site.
 */
export function resolveTarget(name?: string): Target {
  const targets = parseTargets()

  if (targets.size === 0) {
    throw new TargetNotConfiguredError(
      `No CMS targets configured. Set ${TARGETS_ENV} to a JSON object, for example:\n` +
        `  {"acme":{"url":"http://127.0.0.1:7301","email":"owner@acme.test","secret":"..."}}`,
    )
  }

  if (name) {
    const found = targets.get(name)
    if (!found) {
      throw new TargetNotConfiguredError(
        `Unknown target "${name}". Configured targets: ${[...targets.keys()].join(', ')}`,
      )
    }
    return found
  }

  const fallback = process.env[DEFAULT_TARGET_ENV]?.trim()
  if (fallback) {
    const found = targets.get(fallback)
    if (!found) {
      throw new TargetNotConfiguredError(
        `${DEFAULT_TARGET_ENV} is "${fallback}" but no such target is configured. ` +
          `Configured: ${[...targets.keys()].join(', ')}`,
      )
    }
    return found
  }

  if (targets.size === 1) return [...targets.values()][0]!

  throw new TargetNotConfiguredError(
    `Several targets are configured (${[...targets.keys()].join(', ')}) and no target was ` +
      `named. Pass one explicitly — guessing which tenant to write to is how content ends up ` +
      `in the wrong site.`,
  )
}

/** Safe to log and return: names and addresses, never secrets. */
export function describeTargets(): { name: string; baseUrl: string; email: string }[] {
  try {
    return [...parseTargets().values()].map((t) => ({
      name: t.name,
      baseUrl: t.baseUrl,
      email: t.email,
    }))
  } catch {
    return []
  }
}
