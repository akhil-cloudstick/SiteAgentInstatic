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
import { base64ToBytes, keyFingerprint } from './go'
import type { Store } from './store'
import type { ApproverRecord } from './types'

export const APPROVERS_PATH = '/api/approvers'
export const APPROVER_RETIRE = /^\/api\/approvers\/([^/]+)\/retire$/

/**
 * The path the checking side actually reads, and the one to publish.
 *
 * `/api/approvers` answers a GET too and still does — but it cannot be the
 * PUBLISHED read, because Cloudflare Access sits in front of the relay and its
 * applications match a path AND EVERYTHING BENEATH IT. A Bypass policy on
 * `api/approvers` (which is what DEPLOY.md used to instruct) therefore also
 * covers `POST /api/approvers` and `POST /api/approvers/<property>/retire`, and
 * a Bypass stops Cloudflare adding the `cf-access-jwt-assertion` header. The
 * owner is a BROWSER identity matched on that header's email, so the one party
 * permitted to register an approver would be refused at their own door. The
 * owner caught this by testing the live relay before deploying.
 *
 * Underneath `/api/health`, which already has its Bypass, that conflict cannot
 * arise: nothing is written under `/api/health`, so opening the whole subtree
 * opens only reads. No second Access policy is needed.
 */
export const APPROVERS_PUBLIC_PATH = '/api/health/approvers'

/**
 * The test-property write door. Owner-only, for the same reason the approver
 * door is: a validator who could designate a property could designate a LIVE
 * one and then submit its GO, which hands over the whole control in one step.
 *
 * Designating and undesignating are both POSTs because both are appends — there
 * is no DELETE here, and no UPDATE anywhere in the table.
 */
export const TEST_PROPERTIES_PATH = '/api/test-properties'
export const TEST_PROPERTY_REMOVE = /^\/api\/test-properties\/([^/]+)\/remove$/

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
  const [live, testProperties] = await Promise.all([store.listApprovers(), store.listTestProperties()])
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
    // Published deliberately, and as a sibling list rather than a field on each
    // approver. Two reasons: this registry is keyed by APPROVER, and a
    // business-level row's `property` is the business's own name rather than a
    // deployable property; and a property can be designated before it has an
    // approver at all. It is published so that who may submit a GO — not just
    // whose signature counts — can be audited from outside.
    testProperties,
  }
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status: 200, headers: HEADERS })
}

// --- Registration, rotation and revocation ------------------------------------
//
// R6 asks for these to be "first-class operations". Until this door existed they
// were a developer running `wrangler d1 execute` by hand against the production
// database — which is not an operation, it is a person with a shell, and it is
// one of the developer actions R13 has to remove.
//
// Owner-only, and that is not a formality. Registering an approver decides whose
// signature counts, so a door that let the builder or the validator through
// would let either appoint themselves the approver and grant their own GO.

type Out = { status: number; body: unknown }

const PROPERTY = /^[a-z0-9][a-z0-9-]{0,62}$/
const MAX_COVERS = 200

/**
 * A key we are willing to record: correctly encoded, the right length, and
 * accepted by the runtime that will later verify signatures against it.
 *
 * What this deliberately does NOT claim is that the key is a valid curve point.
 * WebCrypto's raw Ed25519 import accepts any 32 bytes — 32 bytes of 0xFF import
 * without complaint — because point validation happens inside `verify`. So the
 * guarantee here is "this will import where it matters", which catches the
 * realistic mistakes (a truncated paste, a hex string where base64 was meant, a
 * whole PEM file) at the moment somebody can still fix them, rather than at the
 * moment a GO is refused for reasons that read like a signing problem.
 */
async function usableEd25519(publicKey: string): Promise<{ ok: true; fingerprint: string } | { ok: false }> {
  try {
    const raw = base64ToBytes(publicKey.trim())
    if (raw.length !== 32) return { ok: false }
    await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify'])
    return { ok: true, fingerprint: await keyFingerprint(publicKey) }
  } catch {
    return { ok: false }
  }
}

function readCovers(level: string, raw: unknown): { ok: true; covers: string[] | null } | { ok: false; error: string } {
  if (level === 'project') {
    if (raw !== undefined && raw !== null && !(Array.isArray(raw) && raw.length === 0)) {
      return { ok: false, error: 'A project-level approver covers exactly its own property, so it takes no `covers`.' }
    }
    return { ok: true, covers: null }
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      ok: false,
      error:
        'A business-level approver must name the properties it covers. Delegation is explicit, never implied — ' +
        'an empty `covers` would approve nothing, and an absent one would have to guess.',
    }
  }
  if (raw.length > MAX_COVERS) return { ok: false, error: `A registration may name at most ${MAX_COVERS} properties.` }
  const covers = [...new Set(raw.map((v) => (typeof v === 'string' ? v.trim() : '')))]
  if (!covers.every((c) => PROPERTY.test(c))) {
    return { ok: false, error: 'Each covered property must be a slug: a-z, 0-9 and hyphens, starting alphanumeric.' }
  }
  return { ok: true, covers }
}

/**
 * Register an approver for a property, retiring whatever held it before.
 *
 * Rotation is this same call: the store retires the live row and inserts the new
 * one in one batch, so the property is never left with two live identities nor
 * momentarily with none.
 */
export async function registerApprover(
  body: Record<string, unknown>,
  store: Store,
  registeredBy: string,
  at: string,
): Promise<Out> {
  const property = typeof body.property === 'string' ? body.property.trim() : ''
  if (!PROPERTY.test(property)) {
    return { status: 422, body: { error: 'property must be a slug: a-z, 0-9 and hyphens, starting alphanumeric.' } }
  }
  const level = body.level === 'business' ? 'business' : body.level === 'project' ? 'project' : null
  if (!level) return { status: 422, body: { error: 'level must be "project" or "business".' } }

  const covers = readCovers(level, body.covers)
  if (!covers.ok) return { status: 422, body: { error: covers.error } }

  const publicKey = typeof body.publicKey === 'string' ? body.publicKey.trim() : ''
  const key = await usableEd25519(publicKey)
  if (!key.ok) {
    return {
      status: 422,
      body: {
        error:
          'publicKey must be a base64 Ed25519 public key of exactly 32 bytes. It is checked here rather than at ' +
          'GO time, because a key that cannot be imported would otherwise refuse every approval for this ' +
          'property with no sign of why.',
      },
    }
  }

  const live = await store.listApprovers()

  // AC-B6.3, enforced at the only moment it can be: no single identity ever
  // satisfies two properties. Registering one key twice is how a master key gets
  // built by accident, one well-meaning rotation at a time.
  const elsewhere = live.find((a) => a.fingerprint === key.fingerprint && a.property !== property)
  if (elsewhere) {
    return {
      status: 409,
      body: {
        error:
          `That key is already registered for "${elsewhere.property}". One identity may not approve two ` +
          'properties — register a separate key for this one.',
        fingerprint: key.fingerprint,
      },
    }
  }

  // Two business approvers both claiming one property would make resolution
  // depend on row order. Whichever named it keeps it, until it is re-registered
  // without it.
  if (level === 'business' && covers.covers) {
    const claimed = covers.covers
      .map((c) => ({
        c,
        by: live.find((a) => a.level === 'business' && a.property !== property && (a.covers ?? []).includes(c)),
      }))
      .filter((x) => x.by)
    if (claimed.length > 0) {
      return {
        status: 409,
        body: {
          error:
            `"${claimed[0]!.c}" is already covered by the business approver registered for ` +
            `"${claimed[0]!.by!.property}". A property has one approver, so remove it there first.`,
          conflicts: claimed.map((x) => ({ property: x.c, coveredBy: x.by!.property })),
        },
      }
    }
  }

  const previous = live.find((a) => a.property === property) ?? null
  const seq = await store.nextSeq()
  const record: ApproverRecord = {
    id: `AP-${String(seq).padStart(6, '0')}`,
    seq,
    property,
    level,
    covers: covers.covers,
    publicKey,
    fingerprint: key.fingerprint,
    effectiveFrom: at,
    retiredAt: null,
    registeredBy,
    reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 2000) : null,
    createdAt: at,
  }
  if (!(await store.registerApprover(record))) {
    return { status: 500, body: { error: 'The registration was not recorded.' } }
  }
  return {
    status: 201,
    body: {
      approver: {
        id: record.id,
        property,
        level,
        ...(record.covers ? { covers: record.covers } : {}),
        fingerprint: record.fingerprint,
        effectiveFrom: at,
      },
      // Rotation "takes effect immediately" (PRD 5.3): saying which identity has
      // just stopped being accepted is how the caller tells a rotation from a
      // first registration without making a second request.
      retired: previous ? { id: previous.id, fingerprint: previous.fingerprint } : null,
    },
  }
}

/**
 * Retire a property's approver with no replacement.
 *
 * "Revocation without a replacement leaves the property with no approver, and
 * every gated action there refuses. That is the correct failure" (PRD 5.3) — so
 * this deliberately falls back to nothing, and the response says what it has
 * done rather than reading like a success with no consequences.
 */
export async function retireApprover(property: string, store: Store, at: string): Promise<Out> {
  if (!PROPERTY.test(property)) return { status: 404, body: { error: 'No such property.' } }
  const live = await store.listApprovers()
  const current = live.find((a) => a.property === property)
  if (!current) return { status: 404, body: { error: `No approver is registered for "${property}".` } }
  if (!(await store.retireApprover(property, at))) {
    return { status: 500, body: { error: 'The retirement was not recorded.' } }
  }
  const stranded = current.level === 'business' ? (current.covers ?? []) : []
  return {
    status: 200,
    body: {
      retired: { id: current.id, property, fingerprint: current.fingerprint, at },
      // Named plainly, because this is the whole point of the operation and the
      // caller should not have to deduce it from a 200.
      effect:
        stranded.length > 0
          ? `"${property}" now has no approver, and every gated action on it and on the ${stranded.length} ` +
            'properties it covered will refuse until one is registered.'
          : `"${property}" now has no approver, and every gated action on it will refuse until one is registered.`,
      ...(stranded.length > 0 ? { alsoWithoutApprover: stranded } : {}),
    },
  }
}

// --- Test properties ----------------------------------------------------------
//
// Which properties the validator may SUBMIT a GO for. The signature is checked
// against the property's registered approver either way, in exactly the same
// place as before — a designation widens who may submit and nothing else.
//
// No role check lives in this file, exactly as for registration above: the door
// is guarded once, in app.ts, and a handler that also checked would be a second
// copy of the rule to keep in step.

/** Designate a property. Idempotent by nature: designating twice is two rows and one state. */
export async function designateTestProperty(
  body: Record<string, unknown>,
  store: Store,
  by: string,
  at: string,
): Promise<Out> {
  const property = String(body.property ?? '').trim()
  if (!PROPERTY.test(property)) {
    return { status: 422, body: { error: 'A property is lowercase letters, digits and hyphens.' } }
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null

  const already = await store.listTestProperties()
  if (already.includes(property)) {
    return {
      status: 200,
      body: {
        designated: { property, at, by },
        effect: `"${property}" was already a test property; nothing changed.`,
        testProperties: already,
      },
    }
  }

  const seq = await store.nextSeq()
  const ok = await store.recordTestProperty({
    id: `TP-${String(seq).padStart(6, '0')}`,
    seq,
    property,
    designated: true,
    at,
    by,
    reason,
    createdAt: at,
  })
  if (!ok) return { status: 500, body: { error: 'The designation was not recorded.' } }

  return {
    status: 200,
    body: {
      designated: { property, at, by, ...(reason ? { reason } : {}) },
      // The consequence in words, as the retire handler does — a status code
      // does not tell the owner what they just widened.
      effect:
        `The validator may now submit a GO for "${property}". Its signature is still checked ` +
        `against the approver registered for "${property}", and no other role gains anything.`,
      testProperties: await store.listTestProperties(),
    },
  }
}

/** Remove a designation. The property goes back to owner-submit only. */
export async function removeTestProperty(
  property: string,
  store: Store,
  by: string,
  at: string,
): Promise<Out> {
  if (!PROPERTY.test(property)) return { status: 404, body: { error: 'No such property.' } }

  const already = await store.listTestProperties()
  if (!already.includes(property)) {
    return { status: 404, body: { error: `"${property}" is not a test property.` } }
  }

  const seq = await store.nextSeq()
  const ok = await store.recordTestProperty({
    id: `TP-${String(seq).padStart(6, '0')}`,
    seq,
    property,
    designated: false,
    at,
    by,
    reason: null,
    createdAt: at,
  })
  if (!ok) return { status: 500, body: { error: 'The removal was not recorded.' } }

  return {
    status: 200,
    body: {
      removed: { property, at, by },
      effect: `Only the owner may submit a GO for "${property}" again.`,
      testProperties: await store.listTestProperties(),
    },
  }
}
