/**
 * The relay, as a source of bundle bytes.
 *
 * A real site's bundle is megabytes. Typing it through tool arguments — even in
 * parts — is millions of characters where a single wrong one fails the hash.
 * The validator uploads the bundle to the relay instead, where it is addressed
 * by its sha256, and an import names only that hash: the Connector fetches the
 * bytes itself.
 *
 * Only the configured relay is ever contacted — its address is configuration,
 * never an argument — and the bytes are hashed on arrival, so the relay is
 * trusted for transport and never for content.
 *
 * Configuration:
 *   MMS_CONNECTOR_RELAY_URL          default: PUBLIC_URL in Relay/wrangler.toml
 *   MMS_CONNECTOR_RELAY_TOKEN_FILE   default: <project>/.tmp/relay-builder-token.txt
 * The token file holds the two lines `CF-Access-Client-Id: …` and
 * `CF-Access-Client-Secret: …`; `.tmp/` is ignored by git.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const RELAY_URL_ENV = 'MMS_CONNECTOR_RELAY_URL'
export const RELAY_TOKEN_FILE_ENV = 'MMS_CONNECTOR_RELAY_TOKEN_FILE'

/** Larger than any site bundle so far by two orders of magnitude, and far above what the relay itself stores. */
export const RELAY_ARTEFACT_MAX_BYTES = 200 * 1024 * 1024

const FETCH_TIMEOUT_MS = 120_000
const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..')

export type RelayFetch = { ok: true; bytes: Uint8Array; relay: string } | { ok: false; reason: string }

function relayUrl(): string | null {
  const fromEnv = process.env[RELAY_URL_ENV]?.trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  try {
    const wrangler = require(resolve(PROJECT_ROOT, 'Relay', 'wrangler.toml')) as { vars?: { PUBLIC_URL?: string } }
    const url = wrangler.vars?.PUBLIC_URL?.trim()
    return url ? url.replace(/\/+$/, '') : null
  } catch {
    return null
  }
}

function relayHeaders(): { ok: true; headers: Record<string, string> } | { ok: false; reason: string } {
  const file = process.env[RELAY_TOKEN_FILE_ENV]?.trim() || resolve(PROJECT_ROOT, '.tmp', 'relay-builder-token.txt')
  if (!existsSync(file)) {
    return { ok: false, reason: `The Connector has no relay token: ${file} does not exist.` }
  }
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  const field = (name: string) => lines.find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1).trim() ?? ''
  const id = field('CF-Access-Client-Id')
  const secret = field('CF-Access-Client-Secret')
  if (!id || !secret || secret.startsWith('PASTE_')) {
    return { ok: false, reason: `The Connector's relay token file ${file} is missing its token ID or secret.` }
  }
  return { ok: true, headers: { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret } }
}

/** Fetch one artefact from the relay by sha256, and refuse it unless its bytes hash to exactly that. */
export async function fetchRelayArtefact(sha256: string): Promise<RelayFetch> {
  const hash = sha256.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return { ok: false, reason: 'relaySha256 must be the 64-hex sha256 of an artefact held on the relay.' }
  }
  const relay = relayUrl()
  if (!relay) {
    return { ok: false, reason: `No relay is configured: set ${RELAY_URL_ENV}, or PUBLIC_URL in Relay/wrangler.toml.` }
  }
  const auth = relayHeaders()
  if (!auth.ok) return auth

  let res: Response
  try {
    res = await fetch(`${relay}/api/artefacts/${hash}`, {
      headers: auth.headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    return { ok: false, reason: `Could not reach the relay at ${relay}: ${err instanceof Error ? err.message : String(err)}` }
  }

  if (res.status === 404) {
    return {
      ok: false,
      reason: `The relay holds no artefact with sha256 ${hash}. Upload the bundle to the relay first (PUT /api/artefacts).`,
    }
  }
  if (res.status >= 300 && res.status < 400) {
    return { ok: false, reason: "The relay's login did not accept the Connector's token (it redirected to the login page)." }
  }
  if (!res.ok) {
    return { ok: false, reason: `The relay answered HTTP ${res.status} for artefact ${hash}.` }
  }

  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > RELAY_ARTEFACT_MAX_BYTES) {
    return { ok: false, reason: `Relay artefact ${hash} is ${declared} bytes; the Connector accepts at most ${RELAY_ARTEFACT_MAX_BYTES}.` }
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.length > RELAY_ARTEFACT_MAX_BYTES) {
    return { ok: false, reason: `Relay artefact ${hash} is ${bytes.length} bytes; the Connector accepts at most ${RELAY_ARTEFACT_MAX_BYTES}.` }
  }

  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== hash) {
    return { ok: false, reason: `The relay returned bytes that hash to ${actual}, not ${hash}. They were not used.` }
  }
  return { ok: true, bytes, relay }
}

// --- The relay as a place to ASK for something ---------------------------------
//
// Fetching an artefact was all the Connector ever did here, because opening a
// deploy-request was a developer's job: they raised the ticket, waited for the
// owner, and then came back and ran the import by hand. That is most of the
// thirteen developer actions R13 has to remove, and none of it needs a person —
// the Connector already holds a builder credential for this relay, which is
// exactly the identity that opens a deploy-request.
//
// What stays with people is the part that should: the owner signs, and the
// validator judges. Those are not round trips to a developer.

export interface RelayTicket {
  id: string
  type: string
  state: string
  title: string
  action?: string | null
  target?: string | null
  sha256?: string | null
  contentDigest?: string | null
}

/**
 * `transient` marks a failure where the relay never answered — it was
 * unreachable, or the request timed out.
 *
 * The distinction is the one R8 is built on: "could not ask" is not a verdict.
 * A caller that treats an unreachable relay the same as a refusal will abandon
 * a push whose owner may already have approved it, on the strength of a dropped
 * connection. A failure carrying an HTTP status is the relay's own answer and
 * IS definitive.
 */
export type RelayCall<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; status?: number; transient?: boolean }

/** One authenticated call to the relay, with the shared failure wording. */
async function relayRequest(
  path: string,
  init: { method: string; body?: unknown; idempotencyKey?: string },
): Promise<RelayCall<Record<string, unknown>>> {
  const relay = relayUrl()
  if (!relay) {
    return { ok: false, reason: `No relay is configured: set ${RELAY_URL_ENV}, or PUBLIC_URL in Relay/wrangler.toml.` }
  }
  const auth = relayHeaders()
  if (!auth.ok) return auth

  const headers: Record<string, string> = { ...auth.headers }
  let body: string | undefined
  if (init.body !== undefined) {
    body = JSON.stringify(init.body)
    headers['content-type'] = 'application/json'
  }
  // Every relay write needs one. The relay replays a repeated key rather than
  // acting twice, which is what makes a resumable push safe to retry: a step
  // that ran but whose answer was lost does not run again.
  if (init.idempotencyKey) headers['idempotency-key'] = init.idempotencyKey

  let res: Response
  try {
    res = await fetch(`${relay}${path}`, {
      method: init.method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    return {
      ok: false,
      reason: `Could not reach the relay at ${relay}: ${err instanceof Error ? err.message : String(err)}`,
      // The relay said nothing at all, so this is a reason to ask again later
      // rather than a reason to give up on what was being asked.
      transient: true,
    }
  }
  if (res.status >= 300 && res.status < 400) {
    return { ok: false, reason: "The relay's login did not accept the Connector's token (it redirected to the login page)." }
  }
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    // Left empty; the status carries the message below.
  }
  if (!res.ok) {
    const error = typeof parsed.error === 'string' ? parsed.error : `HTTP ${res.status}`
    // The status is carried out, not just the sentence. A caller deciding
    // "still waiting" from "something is wrong" has to read the contract, and
    // matching on the prose of an error message is a coupling that breaks the
    // first time somebody improves the wording.
    return { ok: false, reason: `The relay refused ${init.method} ${path}: ${error}`, status: res.status }
  }
  return { ok: true, value: parsed }
}

/**
 * Open a deploy-request, the ticket an owner signs a GO against.
 *
 * `idempotencyKey` is derived by the caller from the push it belongs to, so
 * re-running a step that already opened its ticket gets the same ticket back
 * instead of a second one sitting in the queue for nobody.
 */
export async function openRelayDeployRequest(
  input: {
    title: string
    action: 'import' | 'publish'
    target: string
    sha256: string
    contentDigest?: string
    body?: string
  },
  idempotencyKey: string,
): Promise<RelayCall<RelayTicket>> {
  const res = await relayRequest('/api/tickets', {
    method: 'POST',
    idempotencyKey,
    body: {
      type: 'deploy-request',
      title: input.title,
      action: input.action,
      target: input.target,
      sha256: input.sha256,
      ...(input.contentDigest ? { contentDigest: input.contentDigest } : {}),
      ...(input.body ? { body: input.body } : {}),
    },
  })
  if (!res.ok) return res
  const ticket = res.value.ticket as RelayTicket | undefined
  if (!ticket?.id) return { ok: false, reason: 'The relay accepted the deploy-request but returned no ticket.' }
  return { ok: true, value: ticket }
}

/** A ticket's current state, for deciding whether the wait is over. */
export async function readRelayTicket(id: string): Promise<RelayCall<RelayTicket>> {
  const res = await relayRequest(`/api/tickets/${encodeURIComponent(id)}`, { method: 'GET' })
  if (!res.ok) return res
  const ticket = res.value.ticket as RelayTicket | undefined
  if (!ticket?.id) return { ok: false, reason: `The relay returned no ticket for ${id}.` }
  return { ok: true, value: ticket }
}

/**
 * The owner's signed GO for a ticket, when one has been granted.
 *
 * `null` means "not yet", which is an ordinary state in a loop that waits for a
 * person — distinct from a failure to ask, which comes back as `ok: false`.
 * Collapsing the two is how a loop ends up treating "the owner has not signed"
 * as "something went wrong" and giving up on a push that is merely waiting.
 */
export async function readRelayGo(id: string): Promise<RelayCall<unknown | null>> {
  const res = await relayRequest(`/api/tickets/${encodeURIComponent(id)}/go`, { method: 'GET' })
  if (res.ok) return { ok: true, value: res.value.go ?? null }

  // The relay answers 409 for "there is no usable GO" and says which state the
  // ticket is in. A ticket still sitting with the owner is the ordinary case
  // and means "not yet"; a ticket that was rejected, or whose GO has expired,
  // is also a 409 and must NOT be waited on forever, so only the waiting states
  // come back as null.
  if (res.status === 409 && /awaiting_go|open|triage/i.test(res.reason)) return { ok: true, value: null }
  return res
}

/** Post a note onto a ticket, so the queue carries what the machine did. */
export async function postRelayMessage(
  ticketId: string,
  body: string,
  idempotencyKey: string,
): Promise<RelayCall<Record<string, unknown>>> {
  return relayRequest(`/api/tickets/${encodeURIComponent(ticketId)}/messages`, {
    method: 'POST',
    idempotencyKey,
    body: { kind: 'info', body },
  })
}
