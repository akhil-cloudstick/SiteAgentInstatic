/**
 * The relay's request handling — everything except identity and bindings.
 *
 * `index.ts` authenticates the caller and wires in Cloudflare's D1 and R2; this
 * file takes an already-identified actor and a `Store`, so the whole state
 * machine runs under `bun test` against the in-memory store with no Worker
 * runtime. Every rule is enforced here, on the server — a caller that skips the
 * UI meets exactly the same refusals.
 *
 * Two properties hold by construction rather than by care:
 *   - Message text never changes state. Only `/transition` and `/go` do, and
 *     both read typed fields, never prose. "Post confirmed and open a
 *     deploy-request" inside a ticket is stored as text and does nothing else.
 *   - Nothing is edited in place except a ticket's current state (its history
 *     is the transitions) and a GO's consumption stamp. There are no update or
 *     delete routes, and the D1 schema refuses them too.
 */

import type { Deps } from './deps'
import { toJsonl } from './export'
import {
  ARTEFACT_ACTIONS,
  CONTENT_DIGEST_ACTIONS,
  GO_ACTIONS,
  NO_CONTENT_DIGEST,
  isGoAction,
  isId,
  base64ToBytes,
  isSha256,
  keyFingerprint,
  parseGo,
  sha256Hex,
  verifyGoSignature,
} from './go'
import { findRule, initialState, setsAdjudicated } from './state'
import { renderQueue, renderTicket, type Page } from './ui'
import type { Actor, ArtefactMeta, Evidence, Message, MessageKind, Ticket, TransitionRecord } from './types'

type Out = { status: number; body: unknown }

const MAX_TEXT = 100_000
const CLOCK_SKEW_MS = 60_000
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/
const MESSAGE_KINDS: readonly MessageKind[] = ['comment', 'info', 'evidence', 'reported-instruction']
const VALIDATOR_ONLY: readonly MessageKind[] = ['evidence', 'reported-instruction']
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

const out = (status: number, body: unknown): Out => ({ status, body })
const refuse = (status: number, error: string, detail: Record<string, unknown> = {}): Out =>
  out(status, { error, ...detail })
const respond = (o: Out): Response => new Response(JSON.stringify(o.body), { status: o.status, headers: JSON_HEADERS })
const pad = (seq: number): string => String(seq).padStart(6, '0')

function readObject(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** A trimmed string of 1..max characters, or null. */
function shortText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  return s.length > 0 && s.length <= max ? s : null
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const c = new Uint8Array(a.length + b.length)
  c.set(a)
  c.set(b, a.length)
  return c
}

async function ownerFingerprint(deps: Deps): Promise<string | null> {
  if (!deps.config.ownerPublicKey) return null
  try {
    return await keyFingerprint(deps.config.ownerPublicKey)
  } catch {
    return null
  }
}

export async function handle(req: Request, actor: Actor, deps: Deps): Promise<Response> {
  const url = new URL(req.url)
  if (url.pathname.startsWith('/api/')) return handleApi(req, url.pathname, actor, deps)
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  return handleUi(url.pathname, actor, deps)
}

// ---------------------------------------------------------------------------
// API

async function handleApi(req: Request, path: string, actor: Actor, deps: Deps): Promise<Response> {
  if (req.method === 'GET') {
    if (path === '/api/export.jsonl') {
      return new Response(toJsonl(await deps.store.exportLines()), {
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
      })
    }
    const artefact = /^\/api\/artefacts\/([0-9a-f]{64})$/.exec(path)
    if (artefact) return downloadArtefact(artefact[1]!, deps)
    return respond(await routeRead(path, actor, deps))
  }

  if (req.method !== 'POST' && req.method !== 'PUT') {
    return respond(
      refuse(405, 'Tickets, messages, artefacts and GOs are append-only: there is no update or delete route.'),
    )
  }

  // Idempotency before anything else, so a retried write can never run twice —
  // the validator's daemon has already dropped a response batch after three
  // failed POSTs and would otherwise re-issue an action it believes never ran.
  const key = req.headers.get('idempotency-key') ?? ''
  if (!IDEMPOTENCY_KEY.test(key)) {
    return respond(refuse(400, 'Every write needs an Idempotency-Key header (8-128 of A-Z a-z 0-9 . _ : -).'))
  }
  const bytes = new Uint8Array(await req.arrayBuffer())
  const declaredSha256 = req.headers.get('x-content-sha256') ?? ''
  const requestSha256 = await sha256Hex(
    concatBytes(new TextEncoder().encode(`${req.method}\n${path}\n${declaredSha256}\n`), bytes),
  )

  const seen = await deps.store.getIdempotency(actor.subject, key)
  if (seen) {
    if (seen.requestSha256 !== requestSha256) {
      return respond(refuse(409, 'This Idempotency-Key was already used for a different request.'))
    }
    return new Response(seen.body, {
      status: seen.status,
      headers: { ...JSON_HEADERS, 'idempotent-replay': 'true' },
    })
  }

  const result = await routeWrite(req.method, path, bytes, declaredSha256, actor, deps)
  const body = JSON.stringify(result.body)
  if (result.status < 500) {
    await deps.store.putIdempotency({
      subject: actor.subject,
      key,
      requestSha256,
      status: result.status,
      body,
      createdAt: deps.now().toISOString(),
    })
  }
  return new Response(body, { status: result.status, headers: JSON_HEADERS })
}

async function routeRead(path: string, actor: Actor, deps: Deps): Promise<Out> {
  if (path === '/api/whoami') {
    return out(200, { role: actor.role, subject: actor.subject, ownerKeyFingerprint: await ownerFingerprint(deps) })
  }
  if (path === '/api/tickets') return out(200, { tickets: await deps.store.listTickets() })

  const goMatch = /^\/api\/tickets\/([^/]+)\/go$/.exec(path)
  if (goMatch) return readGo(goMatch[1]!, deps)

  const ticketMatch = /^\/api\/tickets\/([^/]+)$/.exec(path)
  if (ticketMatch) {
    const ticket = await deps.store.getTicket(ticketMatch[1]!)
    if (!ticket) return refuse(404, 'No such ticket.')
    return out(200, {
      ticket,
      messages: await deps.store.listMessages(ticket.id),
      transitions: await deps.store.listTransitions(ticket.id),
      go: await deps.store.getGo(ticket.id),
    })
  }
  return refuse(404, 'No such route.')
}

async function routeWrite(
  method: string,
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
  declaredSha256: string,
  actor: Actor,
  deps: Deps,
): Promise<Out> {
  if (path === '/api/artefacts') {
    return method === 'PUT'
      ? uploadArtefact(bytes, declaredSha256, actor, deps)
      : refuse(405, 'Upload artefacts with PUT.')
  }
  if (method !== 'POST') return refuse(405, 'Use POST for this route.')
  if (path === '/api/tickets') return createTicket(bytes, actor, deps)

  const match = /^\/api\/tickets\/([^/]+)\/(messages|transition|go)$/.exec(path)
  if (!match) return refuse(404, 'No such route.')
  const ticket = await deps.store.getTicket(match[1]!)
  if (!ticket) return refuse(404, 'No such ticket.')
  const body = readObject(bytes)
  if (!body) return refuse(400, 'The body must be a JSON object.')

  switch (match[2]) {
    case 'messages':
      return postMessage(ticket, body, actor, deps)
    case 'transition':
      return transition(ticket, body, actor, deps)
    default:
      return grantGo(ticket, body, actor, deps)
  }
}

async function heldArtefacts(
  raw: unknown,
  deps: Deps,
): Promise<{ ok: true; list: string[] } | { ok: false; out: Out }> {
  if (raw === undefined || raw === null) return { ok: true, list: [] }
  if (!Array.isArray(raw) || !raw.every((v) => isSha256(v))) {
    return { ok: false, out: refuse(422, 'artefacts must be a list of sha256 hashes.') }
  }
  const list = [...new Set(raw as string[])]
  for (const sha256 of list) {
    if (!(await deps.store.getArtefact(sha256))) {
      return { ok: false, out: refuse(422, 'Upload each artefact before referring to it.', { sha256 }) }
    }
  }
  return { ok: true, list }
}

async function createTicket(bytes: Uint8Array<ArrayBuffer>, actor: Actor, deps: Deps): Promise<Out> {
  const b = readObject(bytes)
  if (!b) return refuse(400, 'The body must be a JSON object.')

  const type = b.type
  if (type !== 'ticket' && type !== 'deploy-request') {
    return refuse(400, 'type must be "ticket" or "deploy-request".')
  }
  if (type === 'deploy-request' && actor.role !== 'builder') {
    return refuse(403, 'Only the builder opens a deploy-request.')
  }
  if (type === 'ticket' && actor.role === 'owner') {
    return refuse(403, 'Tickets are opened by the builder or the validator.')
  }

  const title = shortText(b.title, 200)
  if (!title) return refuse(422, 'title is required (1-200 characters).')
  const body = typeof b.body === 'string' ? b.body : ''
  if (body.length > MAX_TEXT) return refuse(422, `body is limited to ${MAX_TEXT} characters.`)
  const artefacts = await heldArtefacts(b.artefacts, deps)
  if (!artefacts.ok) return artefacts.out

  let action: Ticket['action'] = null
  let target: string | null = null
  let sha256: string | null = null
  let contentDigest: string | null = null
  if (type === 'deploy-request') {
    if (!isGoAction(b.action)) {
      return refuse(422, `action must be one of ${GO_ACTIONS.join(', ')} — one deploy per request.`)
    }
    if (!isId(b.target)) return refuse(422, 'target must be the Connector target name.')
    if (!isSha256(b.sha256)) return refuse(422, 'sha256 must be 64 lowercase hex.')
    // A bundle action names bytes the validator must be able to fetch. A row
    // action names a rows digest, which has no bytes to hold.
    if (ARTEFACT_ACTIONS.includes(b.action) && !(await deps.store.getArtefact(b.sha256))) {
      return refuse(422, 'Upload the artefact first: a deploy-request can only name an artefact the relay holds.', {
        sha256: b.sha256,
      })
    }
    // A site publish also binds the draft site document, fixed here so the
    // owner signs exactly the digest the validator checked.
    if (CONTENT_DIGEST_ACTIONS.includes(b.action)) {
      if (!isSha256(b.contentDigest)) {
        return refuse(
          422,
          'A publish deploy-request needs contentDigest: the draft site hash from connector_site_digest, ' +
            'taken after the between-steps check.',
        )
      }
      contentDigest = b.contentDigest
    } else if (b.contentDigest !== undefined && b.contentDigest !== null) {
      return refuse(422, `contentDigest applies only to ${CONTENT_DIGEST_ACTIONS.join(', ')}.`)
    }
    action = b.action
    target = b.target
    sha256 = b.sha256
  }

  const seq = await deps.store.nextSeq()
  const at = deps.now().toISOString()
  const ticket: Ticket = {
    id: `${type === 'ticket' ? 'T' : 'DR'}-${pad(seq)}`,
    seq,
    type,
    title,
    body,
    state: initialState(type),
    createdBy: actor.role,
    createdAt: at,
    updatedAt: at,
    stateSince: at,
    artefacts: artefacts.list,
    action,
    target,
    sha256,
    contentDigest,
    deployId: null,
    validatorStalled: false,
    lastValidatorAt: null,
    adjudicated: false,
  }
  await deps.store.insertTicket(ticket)
  deps.notify({ event: 'ticket_created', ticketId: ticket.id, state: ticket.state, title, at })
  return out(201, { ticket })
}

function parseEvidence(raw: unknown): { ok: true; evidence: Evidence } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      reason: 'evidence must be an object: claim, prediction, artefacts, commands, output, verdict, blindSpots.',
    }
  }
  const r = raw as Record<string, unknown>
  const problems: string[] = []

  const text = (k: string): string => {
    const v = r[k]
    if (typeof v === 'string' && v.trim() !== '' && v.length <= MAX_TEXT) return v
    problems.push(k)
    return ''
  }
  const claim = text('claim')
  const prediction = text('prediction')
  const output = text('output')
  const blindSpots = text('blindSpots')

  let artefacts: string[] = []
  if (Array.isArray(r.artefacts) && r.artefacts.length > 0 && r.artefacts.every((v) => isSha256(v))) {
    artefacts = r.artefacts as string[]
  } else {
    problems.push('artefacts (sha256 list)')
  }

  let commands: string[] = []
  if (
    Array.isArray(r.commands) &&
    r.commands.length > 0 &&
    r.commands.every((c) => typeof c === 'string' && c.trim() !== '')
  ) {
    commands = r.commands as string[]
  } else {
    problems.push('commands')
  }

  const verdict = r.verdict
  if (verdict !== 'confirmed' && verdict !== 'refuted' && verdict !== 'abstain') {
    problems.push('verdict (confirmed|refuted|abstain)')
  }

  if (problems.length > 0) {
    return {
      ok: false,
      reason: `The evidence block is missing or has invalid: ${problems.join(', ')}. A verdict is not accepted without all of it.`,
    }
  }
  return {
    ok: true,
    evidence: { claim, prediction, artefacts, commands, output, verdict: verdict as Evidence['verdict'], blindSpots },
  }
}

async function validatorActive(ticket: Ticket, at: string, deps: Deps): Promise<void> {
  const flag = ticket.validatorStalled
    ? { seq: await deps.store.nextSeq(), ticketId: ticket.id, validatorStalled: false, at }
    : null
  await deps.store.recordValidatorActivity(ticket.id, at, flag)
}

async function postMessage(ticket: Ticket, b: Record<string, unknown>, actor: Actor, deps: Deps): Promise<Out> {
  const kind = b.kind as MessageKind
  if (!MESSAGE_KINDS.includes(kind)) return refuse(422, `kind must be one of ${MESSAGE_KINDS.join(', ')}.`)
  if (VALIDATOR_ONLY.includes(kind) && actor.role !== 'validator') {
    return refuse(403, `Only the validator posts ${kind} messages.`)
  }

  const body = typeof b.body === 'string' ? b.body : ''
  if (body.length > MAX_TEXT) return refuse(422, `body is limited to ${MAX_TEXT} characters.`)

  let evidence: Evidence | null = null
  if (kind === 'evidence') {
    const parsed = parseEvidence(b.evidence)
    if (!parsed.ok) return refuse(422, parsed.reason)
    evidence = parsed.evidence
  } else if (body.trim() === '') {
    return refuse(422, 'body is required.')
  }

  let replyTo: string | null = null
  if (b.replyTo !== undefined && b.replyTo !== null) {
    const parent = typeof b.replyTo === 'string' ? await deps.store.getMessage(b.replyTo) : null
    if (!parent || parent.ticketId !== ticket.id) return refuse(422, 'replyTo must name a message on this ticket.')
    replyTo = parent.id
  }

  const artefacts = await heldArtefacts(b.artefacts, deps)
  if (!artefacts.ok) return artefacts.out

  const seq = await deps.store.nextSeq()
  const at = deps.now().toISOString()
  const message: Message = {
    id: `M-${pad(seq)}`,
    seq,
    ticketId: ticket.id,
    kind,
    author: actor.role,
    body,
    evidence,
    replyTo,
    artefacts: artefacts.list,
    createdAt: at,
  }
  await deps.store.insertMessage(message)
  if (actor.role === 'validator') await validatorActive(ticket, at, deps)
  // Every message fires the notifier, not only the stall timer: a thread that
  // waits for the other side's next poll is the courier delay in miniature,
  // which is the thing this relay replaces.
  deps.notify({
    event: 'message_posted',
    ticketId: ticket.id,
    state: ticket.state,
    title: ticket.title,
    at,
    messageId: message.id,
    author: actor.role,
    kind,
  })
  return out(201, { message })
}

async function transition(ticket: Ticket, b: Record<string, unknown>, actor: Actor, deps: Deps): Promise<Out> {
  const to = typeof b.to === 'string' ? b.to : ''
  if (to === 'go_granted') {
    return refuse(409, 'A GO is granted only by POSTing the owner-signed GO to /api/tickets/<id>/go.')
  }

  const rule = findRule(ticket.type, ticket.state, to)
  if (!rule) {
    return refuse(409, `"${ticket.state}" -> "${to}" is not a transition for a ${ticket.type}.`, {
      state: ticket.state,
    })
  }
  if (!rule.roles.includes(actor.role)) {
    return refuse(403, `The ${actor.role} cannot move a ${ticket.type} from ${ticket.state} to ${to}.`)
  }
  if (to === 'disputed' && ticket.adjudicated) {
    return refuse(409, 'The owner has already decided this dispute.')
  }

  let evidenceMessageId: string | null = null
  if (rule.evidence) {
    const id = typeof b.evidenceMessageId === 'string' ? b.evidenceMessageId : ''
    if (id !== '' || rule.evidence === 'required') {
      const m = id ? await deps.store.getMessage(id) : null
      if (!m || m.ticketId !== ticket.id || m.kind !== 'evidence' || !m.evidence) {
        return refuse(422, `Moving to ${to} needs evidenceMessageId naming an evidence message on this ticket.`)
      }
      if (rule.verdict && m.evidence.verdict !== rule.verdict) {
        return refuse(422, `That evidence's verdict is "${m.evidence.verdict}", which does not support ${to}.`)
      }
      evidenceMessageId = m.id
    }
  }

  let deployId: string | null = null
  if (rule.deployId) {
    deployId = shortText(b.deployId, 200)
    if (!deployId) return refuse(422, `Moving to ${to} needs the deployId the import or publish returned.`)
  }

  const at = deps.now().toISOString()
  if (to === 'executing') {
    const record = await deps.store.getGo(ticket.id)
    if (!record) return refuse(409, 'There is no GO on this deploy-request.')
    if (Date.parse(record.go.expiresAt) <= deps.now().getTime()) {
      return refuse(409, `The GO expired at ${record.go.expiresAt}.`)
    }
    if (!(await deps.store.consumeGo(ticket.id, at, await deps.store.nextSeq()))) {
      return refuse(409, 'This GO has already been consumed. A GO authorizes one run.')
    }
  }

  const tr: TransitionRecord = {
    seq: await deps.store.nextSeq(),
    ticketId: ticket.id,
    from: ticket.state,
    to,
    by: actor.role,
    at,
    evidenceMessageId,
    deployId,
  }
  const moved = await deps.store.applyTransition(tr, {
    ...(deployId ? { deployId } : {}),
    ...(setsAdjudicated(tr) ? { adjudicated: true } : {}),
  })
  if (!moved) return refuse(409, 'The ticket changed state while this request was in flight. Re-read it and retry.')

  if (actor.role === 'validator') await validatorActive(ticket, at, deps)
  deps.notify({ event: 'state_changed', ticketId: ticket.id, state: to, title: ticket.title, at })
  return out(200, { ticket: await deps.store.getTicket(ticket.id) })
}

/**
 * Whose signature approves this property, resolved exactly as the Connector
 * resolves it when it checks a GO: the property's own key when the
 * configuration names one, the default approver otherwise, and a refusal —
 * never a fallback — when a property names a key that cannot be used. The two
 * sides must agree on who the approver is, or an approval means nothing.
 */
async function approverFor(
  deps: Deps,
  target: string,
): Promise<
  | { ok: true; publicKey: string; fingerprint: string; scope: 'property' | 'default' }
  | { ok: false; status: number; reason: string }
> {
  const usable = async (key: string): Promise<string | null> => {
    try {
      return base64ToBytes(key).length === 32 ? await keyFingerprint(key) : null
    } catch {
      return null
    }
  }

  const own = deps.config.propertyApprovers[target]
  if (own !== undefined) {
    const fingerprint = await usable(own)
    return fingerprint
      ? { ok: true, publicKey: own, fingerprint, scope: 'property' }
      : {
          ok: false,
          status: 503,
          reason: `The approver configured for "${target}" is not a usable Ed25519 public key, so no GO can be granted for it.`,
        }
  }

  const fallback = deps.config.ownerPublicKey
  const fingerprint = fallback ? await usable(fallback) : null
  return fingerprint
    ? { ok: true, publicKey: fallback, fingerprint, scope: 'default' }
    : { ok: false, status: 503, reason: `No approver is configured for "${target}", so no GO can be granted.` }
}

async function grantGo(ticket: Ticket, b: Record<string, unknown>, actor: Actor, deps: Deps): Promise<Out> {
  if (actor.role !== 'owner') return refuse(403, 'Only the owner grants a GO.')
  if (ticket.type !== 'deploy-request') return refuse(422, 'A GO is granted on a deploy-request.')
  if (ticket.state !== 'awaiting_go') {
    return refuse(409, `This deploy-request is ${ticket.state}; a GO is granted only while awaiting_go.`, {
      state: ticket.state,
    })
  }

  const parsed = parseGo(b.go)
  if (!parsed.ok) return refuse(422, parsed.reason)
  const go = parsed.go

  const expected = {
    ticketId: ticket.id,
    action: ticket.action,
    target: ticket.target,
    sha256: ticket.sha256,
    contentDigest: ticket.contentDigest ?? NO_CONTENT_DIGEST,
  }
  const mismatched = (Object.keys(expected) as (keyof typeof expected)[]).filter((k) => go[k] !== expected[k])
  if (mismatched.length > 0) {
    return refuse(422, `This GO does not bind this deploy-request: ${mismatched.join(', ')} differ.`, { mismatched })
  }

  const now = deps.now().getTime()
  const expires = Date.parse(go.expiresAt)
  if (expires <= now) return refuse(422, `This GO expired at ${go.expiresAt}.`)
  if (expires - now > deps.config.goMaxTtlHours * 3_600_000 + CLOCK_SKEW_MS) {
    return refuse(422, `This GO expires more than ${deps.config.goMaxTtlHours}h from now. Sign one with a shorter expiry.`)
  }

  const approver = await approverFor(deps, ticket.target ?? '')
  if (!approver.ok) return refuse(approver.status, approver.reason)
  const fingerprint = approver.fingerprint
  if (!(await verifyGoSignature(go, approver.publicKey))) {
    return refuse(422, `The GO signature does not verify against the approver key for "${ticket.target}".`, {
      ownerKeyFingerprint: fingerprint,
      approverScope: approver.scope,
    })
  }
  if (await deps.store.nonceUsed(go.nonce)) return refuse(409, 'This nonce has already been used by another GO.')

  const at = deps.now().toISOString()
  const inserted = await deps.store.insertGo({
    ticketId: ticket.id,
    seq: await deps.store.nextSeq(),
    go,
    ownerKeyFingerprint: fingerprint,
    grantedAt: at,
    consumedAt: null,
    consumedSeq: null,
  })
  if (!inserted) return refuse(409, 'A GO is already recorded for this deploy-request, or its nonce was used.')

  const moved = await deps.store.applyTransition(
    {
      seq: await deps.store.nextSeq(),
      ticketId: ticket.id,
      from: 'awaiting_go',
      to: 'go_granted',
      by: 'owner',
      at,
      evidenceMessageId: null,
      deployId: null,
    },
    {},
  )
  if (!moved) return refuse(409, 'The deploy-request changed state while the GO was being recorded.')

  deps.notify({ event: 'state_changed', ticketId: ticket.id, state: 'go_granted', title: ticket.title, at })
  return out(200, { ticket: await deps.store.getTicket(ticket.id), ownerKeyFingerprint: fingerprint })
}

/** The GO for the publisher helper to hand to the Connector. */
async function readGo(ticketId: string, deps: Deps): Promise<Out> {
  const ticket = await deps.store.getTicket(ticketId)
  if (!ticket) return refuse(404, 'No such ticket.')
  const record = await deps.store.getGo(ticketId)
  if (!record || (ticket.state !== 'go_granted' && ticket.state !== 'executing')) {
    return refuse(409, `There is no usable GO: the deploy-request is ${ticket.state}.`, { state: ticket.state })
  }
  if (ticket.state === 'go_granted' && Date.parse(record.go.expiresAt) <= deps.now().getTime()) {
    return refuse(409, `The GO expired at ${record.go.expiresAt}.`, { state: ticket.state })
  }
  return out(200, { go: record.go, ownerKeyFingerprint: record.ownerKeyFingerprint, state: ticket.state })
}

async function uploadArtefact(
  bytes: Uint8Array<ArrayBuffer>,
  declared: string,
  actor: Actor,
  deps: Deps,
): Promise<Out> {
  const claimed = declared.trim().toLowerCase()
  if (!isSha256(claimed)) {
    return refuse(400, 'Send X-Content-Sha256 with the sha256 of the bytes, computed on your side.')
  }
  if (bytes.length === 0) return refuse(400, 'An artefact cannot be empty.')

  const actual = await sha256Hex(bytes)
  if (actual !== claimed) {
    return refuse(422, 'The bytes do not match X-Content-Sha256. Nothing was stored.', { declared: claimed, actual })
  }

  const existing = await deps.store.getArtefact(actual)
  if (existing) return out(200, { artefact: existing, existing: true })

  // Bytes before metadata, so a metadata row always has its object behind it.
  await deps.blobs.put(actual, bytes)
  const meta: ArtefactMeta = {
    sha256: actual,
    seq: await deps.store.nextSeq(),
    bytes: bytes.length,
    uploadedBy: actor.role,
    createdAt: deps.now().toISOString(),
  }
  await deps.store.insertArtefact(meta)
  return out(201, { artefact: meta, existing: false })
}

async function downloadArtefact(sha256: string, deps: Deps): Promise<Response> {
  const meta = await deps.store.getArtefact(sha256)
  const bytes = meta ? await deps.blobs.get(sha256) : null
  if (!meta || !bytes) return respond(refuse(404, 'No such artefact.'))
  // Always a download, never rendered: artefacts include partner- and
  // site-authored HTML, and rendering it on the relay's origin would hand it
  // the relay session.
  return new Response(bytes, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${sha256}"`,
      'x-content-sha256': sha256,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  })
}

// ---------------------------------------------------------------------------
// UI

function htmlResponse(page: Page, status = 200): Response {
  return new Response(page.html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy':
        `default-src 'none'; style-src 'nonce-${page.nonce}'; script-src 'nonce-${page.nonce}'; ` +
        "connect-src 'self'; img-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  })
}

async function handleUi(path: string, actor: Actor, deps: Deps): Promise<Response> {
  const ownerKeyFingerprint = await ownerFingerprint(deps)
  if (path === '/') {
    return htmlResponse(renderQueue({ actor, ownerKeyFingerprint, tickets: await deps.store.listTickets() }))
  }
  const match = /^\/t\/([A-Za-z0-9-]+)$/.exec(path)
  const ticket = match ? await deps.store.getTicket(match[1]!) : null
  if (!ticket) return new Response('Not found', { status: 404 })
  return htmlResponse(
    renderTicket({
      actor,
      ownerKeyFingerprint,
      ticket,
      messages: await deps.store.listMessages(ticket.id),
      transitions: await deps.store.listTransitions(ticket.id),
      go: await deps.store.getGo(ticket.id),
      now: deps.now(),
    }),
  )
}
