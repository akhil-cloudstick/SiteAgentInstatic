import { createPrivateKey, randomBytes, sign, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { handle } from '../src/app'
import type { Deps } from '../src/deps'
import { goMessage, sha256Hex, type Go } from '../src/go'
import { MemoryBlobs, MemoryStore } from '../src/store.memory'
import type { Actor, RelayEvent, Ticket } from '../src/types'

export interface Vectors {
  owner: { seedHex: string; publicKey: string; fingerprint: string }
  other: { seedHex: string; publicKey: string; fingerprint: string }
  cases: { name: string; message?: string; go: Go; valid: boolean }[]
}

export const VECTORS = JSON.parse(
  readFileSync(resolve(import.meta.dir, '../../docs/relay/go-test-vectors.json'), 'utf8'),
) as Vectors

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const keyFromSeed = (seedHex: string): KeyObject =>
  createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seedHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  })

export const OWNER_KEY = keyFromSeed(VECTORS.owner.seedHex)
export const OTHER_KEY = keyFromSeed(VECTORS.other.seedHex)

export const OWNER: Actor = { role: 'owner', subject: 'owner@example.test' }
export const BUILDER: Actor = { role: 'builder', subject: 'builder@example.test' }
export const VALIDATOR: Actor = { role: 'validator', subject: 'service:validator-token-id' }

export interface CallResult {
  status: number
  json: any
  text: string
  headers: Headers
}

export function relay(options: { ownerPublicKey?: string } = {}) {
  const store = new MemoryStore()
  const blobs = new MemoryBlobs()
  const events: RelayEvent[] = []
  let now = new Date('2026-09-14T08:00:00.000Z')
  const deps: Deps = {
    store,
    blobs,
    config: { ownerPublicKey: options.ownerPublicKey ?? VECTORS.owner.publicKey, stallMinutes: 30, goMaxTtlHours: 4 },
    now: () => new Date(now),
    notify: (event) => events.push(event),
  }

  let keys = 0
  async function call(
    actor: Actor,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<CallResult> {
    const init: RequestInit = {
      method,
      headers: { ...(method === 'GET' ? {} : { 'idempotency-key': `test-key-${++keys}` }), ...headers },
    }
    if (body !== undefined) init.body = body instanceof Uint8Array ? body : JSON.stringify(body)
    const res = await handle(new Request(`https://relay.test${path}`, init), actor, deps)
    const text = await res.text()
    let json: any = null
    try {
      json = JSON.parse(text)
    } catch {
      // HTML, JSONL or bytes
    }
    return { status: res.status, json, text, headers: res.headers }
  }

  return {
    store,
    blobs,
    deps,
    events,
    call,
    now: () => new Date(now),
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms)
    },
  }
}

export type Relay = ReturnType<typeof relay>

export const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

export async function uploadArtefact(r: Relay, actor: Actor, content: Uint8Array) {
  const sha = await sha256Hex(content)
  const res = await r.call(actor, 'PUT', '/api/artefacts', content, { 'x-content-sha256': sha })
  return { sha, res }
}

export async function openTicket(r: Relay, actor: Actor, fields: { title?: string; body?: string } = {}): Promise<Ticket> {
  const res = await r.call(actor, 'POST', '/api/tickets', {
    type: 'ticket',
    title: fields.title ?? 'v10 renders 11 of 11 pages',
    body: fields.body ?? '',
  })
  if (res.status !== 201) throw new Error(`openTicket: ${res.status} ${res.text}`)
  return res.json.ticket as Ticket
}

export async function openDeployRequest(
  r: Relay,
  options: { action?: 'import' | 'publish'; content?: string; target?: string } = {},
): Promise<Ticket> {
  const { sha } = await uploadArtefact(r, BUILDER, bytes(options.content ?? 'sheeltron bundle v10'))
  const action = options.action ?? 'import'
  const res = await r.call(BUILDER, 'POST', '/api/tickets', {
    type: 'deploy-request',
    title: `${action} v10`,
    action,
    target: options.target ?? 'sheeltron',
    sha256: sha,
    ...(action === 'publish' ? { contentDigest: 'd'.repeat(64) } : {}),
  })
  if (res.status !== 201) throw new Error(`openDeployRequest: ${res.status} ${res.text}`)
  return res.json.ticket as Ticket
}

export function goFor(ticket: Ticket, now: Date, overrides: Partial<Omit<Go, 'signature'>> = {}): Omit<Go, 'signature'> {
  return {
    ticketId: ticket.id,
    action: ticket.action!,
    target: ticket.target!,
    sha256: ticket.sha256!,
    contentDigest: ticket.contentDigest ?? '-',
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    nonce: randomBytes(18).toString('base64url'),
    ...overrides,
  }
}

export function signGo(fields: Omit<Go, 'signature'>, key: KeyObject = OWNER_KEY): Go {
  return { ...fields, signature: sign(null, Buffer.from(goMessage(fields), 'utf8'), key).toString('base64') }
}

export async function grant(r: Relay, ticket: Ticket, overrides: Partial<Omit<Go, 'signature'>> = {}) {
  return r.call(OWNER, 'POST', `/api/tickets/${ticket.id}/go`, { go: signGo(goFor(ticket, r.now(), overrides)) })
}

export const move = (r: Relay, actor: Actor, ticket: Ticket, to: string, extra: Record<string, unknown> = {}) =>
  r.call(actor, 'POST', `/api/tickets/${ticket.id}/transition`, { to, ...extra })

export function evidence(verdict: 'confirmed' | 'refuted' | 'abstain', sha256: string) {
  return {
    claim: 'The bundle loads 11 of 11 pages after import.',
    prediction: '11 of 11 pages survive the tolerant and the strict load.',
    artefacts: [sha256],
    commands: ['bun verify-load.ts sheeltron-bundle-v10.json'],
    output: 'TOLERANT LOAD -> pages surviving: 11 of 11',
    verdict,
    blindSpots: 'Breakpoints below 390px were not rendered.',
  }
}

export async function postEvidence(r: Relay, ticket: Ticket, verdict: 'confirmed' | 'refuted' | 'abstain', sha256: string) {
  const res = await r.call(VALIDATOR, 'POST', `/api/tickets/${ticket.id}/messages`, {
    kind: 'evidence',
    evidence: evidence(verdict, sha256),
  })
  if (res.status !== 201) throw new Error(`postEvidence: ${res.status} ${res.text}`)
  return res.json.message.id as string
}
