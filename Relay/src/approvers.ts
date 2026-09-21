/**
 * The approver registry, readable by the side that checks approvals (R6).
 *
 * The PRD asks that "the registry is the only place this mapping lives, and
 * both ends read the same registry". This is the door the checking side reads
 * it through — one answer to "who may approve this property", rather than two
 * copies of a map that agree by habit.
 *
 * Answered before identity, like `/api/health`, and for the same reason: every
 * field here is a PUBLIC key and its fingerprint. `/api/health` already
 * publishes those fingerprints unauthenticated so the two sides can be compared
 * without logging in; withholding the keys themselves would protect nothing and
 * would mean handing the checking side a credential it has no other use for.
 *
 * What is deliberately NOT here: private keys (they never leave the owner's
 * machine), and retired registrations (history belongs to the export, and a
 * checker that could see a retired key might be tempted to honour one).
 */
import type { Store } from './store'

export const APPROVERS_PATH = '/api/approvers'

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // The checking side caches this and refuses when its copy goes stale, so a
  // shared cache in between would only blur who saw what, and when.
  'cache-control': 'no-store',
}

export interface PublishedApprover {
  property: string
  level: 'project' | 'business'
  /** Properties a business-level approver covers. Absent for a project row. */
  covers?: string[]
  publicKey: string
  fingerprint: string
  effectiveFrom: string
}

export async function approvers(request: Request, store: Store): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'Use GET.' }), { status: 405, headers: HEADERS })
  }
  const live = await store.listApprovers()
  const body = {
    // Stamped so the reader can tell how old its copy is, and refuse to act on
    // one that has gone stale rather than honour a key that may since have been
    // retired.
    at: new Date().toISOString(),
    approvers: live.map((a): PublishedApprover => ({
      property: a.property,
      level: a.level,
      ...(a.covers ? { covers: a.covers } : {}),
      publicKey: a.publicKey,
      fingerprint: a.fingerprint,
      effectiveFrom: a.effectiveFrom,
    })),
  }
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status: 200, headers: HEADERS })
}
