/**
 * Hub context — server side.
 *
 * Reads the Product Hub origin from the environment the control-plane already
 * injects, parses the authorized scope off the SSO hand-off URL, and validates
 * it. The parsed value is persisted on the session row (see the
 * `025_sessions_hub_context` migration) so it survives page loads and can be
 * read back by `GET /cms/api/cms/hub-context`.
 *
 * Security posture: `returnUrl` is attacker-influenced input on a route whose
 * only authenticator is the SSO token. It is therefore pinned to the CONFIGURED
 * Hub origin, not merely to "some absolute URL" — otherwise the hand-off would
 * be an open redirect wearing a product feature's clothes.
 */
import type { Static } from '@sinclair/typebox'
import { HubContextSchema, HUB_CONTEXT_PARAMS } from '@core/hubContext'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'

export type HubContext = Static<typeof HubContextSchema>

/**
 * Origin the Product Hub is served from.
 *
 * `INSTATIC_HUB_BASE_URL` is the explicit setting. When it is unset we fall
 * back to the origin of `INSTATIC_HUB_SSO_URL`, which the control-plane already
 * injects into every managed tenant (`Operator/control-plane/runtime/tenantRuntime.mjs`)
 * — the hub that mints our SSO tokens is by definition the hub we return to.
 * Returns `''` on a plain self-hosted install, which makes every hub-aware
 * surface inert.
 */
export function hubBaseUrl(): string {
  const explicit = (process.env.INSTATIC_HUB_BASE_URL ?? '').trim()
  if (explicit) return stripTrailingSlash(explicit)

  const ssoUrl = (process.env.INSTATIC_HUB_SSO_URL ?? '').trim()
  if (!ssoUrl) return ''
  try {
    return new URL(ssoUrl).origin
  } catch {
    // A malformed env var must not take the whole SSO route down with it.
    console.warn('[hub-context] INSTATIC_HUB_SSO_URL is not a valid URL; hub features disabled')
    return ''
  }
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

/** Trimmed param, or `null` when absent/blank. Blank is the same as missing. */
function scopeParam(params: URLSearchParams, key: string): string | null {
  const raw = (params.get(key) ?? '').trim()
  return raw === '' ? null : raw
}

/**
 * A '1'/'0' hand-off flag, as a spreadable fragment.
 *
 * Returns `{}` when the parameter is missing so the key stays absent from the
 * candidate object entirely — the schema distinguishes "not sent" (an older
 * hub) from an explicit `false`, and `undefined` would blur the two.
 */
function flagParam(
  params: URLSearchParams,
  key: string,
  field: 'designActive' | 'cmsActive',
): Record<string, boolean> {
  const raw = scopeParam(params, key)
  return raw === null ? {} : { [field]: raw === '1' }
}

/**
 * Resolve the return URL. Accepts either an absolute URL on the Hub origin or a
 * Hub-relative path; anything pointing elsewhere is discarded and we fall back
 * to the Hub root. Never returns a URL outside `base`.
 */
function resolveReturnUrl(raw: string | null, base: string): string {
  if (!raw) return base
  try {
    // Resolving against `base` turns "/hub?tab=projects" into an absolute URL
    // and leaves an already-absolute one alone — so one check covers both.
    const resolved = new URL(raw, `${base}/`)
    if (resolved.origin !== new URL(base).origin) return base
    return resolved.toString()
  } catch {
    return base
  }
}

/**
 * Parse the authorized scope out of an SSO hand-off URL.
 *
 * Returns `null` when no Hub origin is configured (self-hosted) or when the
 * hand-off carried no role — a context without a role cannot drive role-scoped
 * navigation, and a guessed role would violate the contract's "do not show
 * links a role is not allowed to use".
 */
export function parseHubContextFromSso(url: URL): HubContext | null {
  const base = hubBaseUrl()
  if (!base) return null

  const role = scopeParam(url.searchParams, HUB_CONTEXT_PARAMS.role)
  if (!role) return null

  const candidate = {
    hubBaseUrl: base,
    role,
    client: scopeParam(url.searchParams, HUB_CONTEXT_PARAMS.client),
    project: scopeParam(url.searchParams, HUB_CONTEXT_PARAMS.project),
    site: scopeParam(url.searchParams, HUB_CONTEXT_PARAMS.site),
    origin: scopeParam(url.searchParams, HUB_CONTEXT_PARAMS.origin),
    returnUrl: resolveReturnUrl(scopeParam(url.searchParams, HUB_CONTEXT_PARAMS.returnUrl), base),
    // Absent stays absent rather than defaulting to `true`: the schema treats
    // "unknown" as enabled already, and writing a guessed `true` into the
    // session would make an old hand-off indistinguishable from a real answer.
    ...flagParam(url.searchParams, HUB_CONTEXT_PARAMS.designActive, 'designActive'),
    ...flagParam(url.searchParams, HUB_CONTEXT_PARAMS.cmsActive, 'cmsActive'),
  }

  const parsed = safeParseValue(HubContextSchema, candidate)
  if (!parsed.ok) {
    // An unrecognised role is the realistic failure here. Dropping the whole
    // context is correct: a partial context would render a header claiming an
    // authority the Hub never granted.
    console.warn('[hub-context] discarding invalid SSO scope:', parsed.errors)
    return null
  }
  return parsed.value
}

/**
 * Re-validate a context read back out of the database, and re-pin it to the
 * CURRENT Hub origin. Re-pinning matters: an operator can move the Hub between
 * the session being minted and the page being loaded, and a stale origin would
 * send `Back to Product Hub` to a host we no longer trust.
 */
export function readStoredHubContext(raw: unknown): HubContext | null {
  if (raw === null || raw === undefined) return null

  const base = hubBaseUrl()
  if (!base) return null

  const parsed = safeParseValue(HubContextSchema, raw)
  if (!parsed.ok) return null

  const stored = parsed.value
  if (stored.hubBaseUrl === base) return stored

  // The Hub moved. The VIEW the user came from is still valid — only its host
  // changed — so carry the path across rather than dropping them on the Hub
  // root. Re-resolving the stored absolute URL directly would keep the old
  // origin and get rejected, so we take its path and rebuild.
  return {
    ...stored,
    hubBaseUrl: base,
    returnUrl: resolveReturnUrl(relativePart(stored.returnUrl), base),
  }
}

/** `path?query#hash` of an absolute URL, or `null` if it isn't parseable. */
function relativePart(url: string): string | null {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}

/**
 * Shape of the `hub_context_json` column as it comes back from the DB layer.
 * Postgres hands back parsed JSON; the SQLite adapter auto-parses `*_json`
 * columns, so both dialects yield an object or null — never a string.
 */
export const StoredHubContextRowSchema = Type.Object({
  hub_context_json: Type.Unknown(),
})
