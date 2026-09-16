/**
 * The GO message and its verification — the relay's copy.
 *
 * Byte-identical to `Connector/src/go/message.ts` by contract, not by import:
 * the relay deploys to Cloudflare and the Connector runs on the builder's host,
 * so they share no build. `docs/relay/go-test-vectors.json` is what holds them
 * together — both test suites verify the same signed vectors.
 *
 * WebCrypto rather than `node:crypto`, because this runs in a Worker.
 */

export const GO_VERSION = 'mms-go-v2'

/** Must list exactly what `Connector/src/go/message.ts` lists. */
export const GO_ACTIONS = [
  'import',
  'merge-overwrite',
  'merge-add',
  'publish',
  'publish-row',
  'set-status-draft',
  'set-status-unpublished',
  'delete',
] as const

export type GoAction = (typeof GO_ACTIONS)[number]

/**
 * Actions whose sha256 names bundle bytes — the relay must hold the artefact so
 * the validator can fetch it. Row actions name a rows digest, which has no
 * bytes to hold.
 */
export const ARTEFACT_ACTIONS: readonly GoAction[] = ['import', 'merge-overwrite', 'merge-add', 'publish']

/** Actions whose GO also binds the draft site document in `contentDigest`. */
export const CONTENT_DIGEST_ACTIONS: readonly GoAction[] = ['publish']

/** The `contentDigest` of every other action. */
export const NO_CONTENT_DIGEST = '-'

export const isGoAction = (value: unknown): value is GoAction =>
  typeof value === 'string' && (GO_ACTIONS as readonly string[]).includes(value)

export interface Go {
  ticketId: string
  action: GoAction
  target: string
  sha256: string
  /** 64 hex — the draft site hash — for a site publish; "-" for every other action. */
  contentDigest: string
  /** ISO-8601 UTC with a `Z` suffix. */
  expiresAt: string
  nonce: string
  /** Ed25519 over `goMessage(...)`, standard base64. */
  signature: string
}

export type GoParse = { ok: true; go: Go } | { ok: false; reason: string }

const ID = /^[A-Za-z0-9._:-]{1,128}$/
const SHA256 = /^[0-9a-f]{64}$/
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
const NONCE = /^[A-Za-z0-9_-]{22,128}$/
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/

export const isSha256 = (v: unknown): v is string => typeof v === 'string' && SHA256.test(v)
export const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v)

export function goMessage(go: Omit<Go, 'signature'>): string {
  return [GO_VERSION, go.ticketId, go.action, go.target, go.sha256, go.contentDigest, go.expiresAt, go.nonce].join('|')
}

export function parseGo(raw: unknown): GoParse {
  if (raw === undefined || raw === null) return { ok: false, reason: 'No GO was supplied.' }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'go must be an object.' }
  const r = raw as Record<string, unknown>
  const s = (k: string): string => (typeof r[k] === 'string' ? (r[k] as string) : '')

  const bad: string[] = []
  const action = s('action')
  if (!ID.test(s('ticketId'))) bad.push('ticketId')
  if (!isGoAction(action)) bad.push(`action (${GO_ACTIONS.join('|')})`)
  if (!ID.test(s('target'))) bad.push('target')
  if (!SHA256.test(s('sha256'))) bad.push('sha256 (64 lowercase hex)')
  const needsDigest = (CONTENT_DIGEST_ACTIONS as readonly string[]).includes(action)
  if (needsDigest ? !SHA256.test(s('contentDigest')) : s('contentDigest') !== NO_CONTENT_DIGEST) {
    bad.push(
      needsDigest
        ? 'contentDigest (64 lowercase hex — the draft site hash)'
        : `contentDigest ("${NO_CONTENT_DIGEST}" for every action except ${CONTENT_DIGEST_ACTIONS.join(', ')})`,
    )
  }
  if (!ISO_UTC.test(s('expiresAt')) || Number.isNaN(Date.parse(s('expiresAt')))) {
    bad.push('expiresAt (ISO-8601 UTC)')
  }
  if (!NONCE.test(s('nonce'))) bad.push('nonce (base64url, at least 16 bytes)')
  if (!SIGNATURE.test(s('signature'))) bad.push('signature (base64 Ed25519)')
  if (bad.length > 0) return { ok: false, reason: `The GO is malformed: ${bad.join(', ')}.` }

  return {
    ok: true,
    go: {
      ticketId: s('ticketId'),
      action: action as GoAction,
      target: s('target'),
      sha256: s('sha256'),
      contentDigest: s('contentDigest'),
      expiresAt: s('expiresAt'),
      nonce: s('nonce'),
      signature: s('signature'),
    },
  }
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', bytes))
}

/** First 16 hex of sha256 over the raw key — the same definition the Connector prints. */
export async function keyFingerprint(ownerKeyB64: string): Promise<string> {
  return (await sha256Hex(base64ToBytes(ownerKeyB64.trim()))).slice(0, 16)
}

export async function verifyGoSignature(go: Go, ownerKeyB64: string): Promise<boolean> {
  try {
    const raw = base64ToBytes(ownerKeyB64.trim())
    if (raw.length !== 32) return false
    const key = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      base64ToBytes(go.signature),
      new TextEncoder().encode(goMessage(go)),
    )
  } catch {
    return false
  }
}
