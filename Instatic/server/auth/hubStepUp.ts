/**
 * Step-up for a person who arrived from the Product Hub (MMS Phase 1, NEW-3b).
 *
 * Such a person has no local password — the hub is their identity provider —
 * so the password they re-enter for a step-up is their HUB password, and it is
 * checked by the control plane. The request is signed with this project's key,
 * so the control plane answers only about this project's own people.
 *
 * Fail closed: anything other than a clear "yes" (unreachable, timeout, bad
 * response, locked) is a failed check.
 */
import { projectSlug, signProjectRequest } from './tenantSso'

export type HubVerifyResult = 'ok' | 'wrong' | 'locked' | 'unavailable'

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export function hubVerifyUrl(): string {
  return (process.env.INSTATIC_HUB_VERIFY_URL ?? '').trim()
}

export async function verifyHubPassword(
  personId: string,
  password: string,
  fetchImpl: FetchLike = fetch,
): Promise<HubVerifyResult> {
  const url = hubVerifyUrl()
  const token = signProjectRequest({ kind: 'hub-verify', personId })
  if (!url || !token || !password) return 'unavailable'
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: projectSlug(), token, password }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 429) return 'locked'
    if (!res.ok) return 'unavailable'
    const body = (await res.json().catch(() => null)) as { ok?: unknown } | null
    if (body?.ok === true) return 'ok'
    if (body?.ok === false) return 'wrong'
    return 'unavailable'
  } catch {
    return 'unavailable'
  }
}
