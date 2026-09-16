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
