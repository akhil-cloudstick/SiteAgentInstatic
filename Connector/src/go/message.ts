/**
 * The GO — what the owner signs before a deploy-class action may run.
 *
 * A GO names one ticket, one action, one target and the content it applies to,
 * expires, and carries a nonce so it can be spent exactly once. The signed
 * bytes are defined here and nowhere else in this project. The relay builds the
 * same string (`Relay/src/go.ts`), and `docs/relay/go-test-vectors.json` pins
 * it: both test suites read that file, so the two verifiers cannot drift apart
 * without one of them failing.
 *
 * `mms-go-v2` added `contentDigest`, a second hash only a site publish uses:
 * the draft site document the publish will bake. Every other action carries
 * "-" there, so each GO still has exactly one spelling. The version prefix is
 * also domain separation — nothing else the owner signs with the same key can
 * be replayed as a GO, and no v1 GO parses as v2.
 */

export const GO_VERSION = 'mms-go-v2'

/**
 * Every deploy-class action a GO can authorize — one per distinct effect, so a
 * GO for the gentler of two actions can never be spent on the harsher one
 * (merge-add as merge-overwrite, draft as unpublish).
 */
export const GO_ACTIONS = [
  /** connector_import_replace — sha256 of the uploaded bundle */
  'import',
  /** connector_import_archive, strategy merge-overwrite — sha256 of the uploaded archive */
  'merge-overwrite',
  /** connector_import_archive, strategy merge-add — sha256 of the uploaded archive */
  'merge-add',
  /** connector_publish_site — sha256 of the last import under GO; contentDigest of the draft site */
  'publish',
  /** connector_publish_row / connector_publish_rows — rows digest of exactly those rows */
  'publish-row',
  /** connector_set_row_status to draft — rows digest of the row */
  'set-status-draft',
  /** connector_set_row_status to unpublished — rows digest of the row */
  'set-status-unpublished',
  /** connector_delete_row / connector_delete_rows — rows digest of exactly those rows */
  'delete',
] as const

export type GoAction = (typeof GO_ACTIONS)[number]

/** Imports: a publish GO binds to the most recent of these that succeeded under GO. */
export const IMPORT_ACTIONS: readonly GoAction[] = ['import', 'merge-overwrite', 'merge-add']

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
  /** ISO-8601 UTC with a `Z` suffix — one spelling, so the signed bytes have one spelling. */
  expiresAt: string
  nonce: string
  /** Ed25519 over `goMessage(...)`, standard base64. */
  signature: string
}

export type GoParse = { ok: true; go: Go } | { ok: false; reason: string }

// Every field is limited to characters that cannot contain the `|` separator,
// so two different GOs can never produce the same signed string.
const ID = /^[A-Za-z0-9._:-]{1,128}$/
const SHA256 = /^[0-9a-f]{64}$/
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/
/** base64url, at least 16 bytes of randomness. */
const NONCE = /^[A-Za-z0-9_-]{22,128}$/
/** 64 signature bytes in standard base64. */
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/

/** The exact string the owner's key signs. */
export function goMessage(go: Omit<Go, 'signature'>): string {
  return [GO_VERSION, go.ticketId, go.action, go.target, go.sha256, go.contentDigest, go.expiresAt, go.nonce].join('|')
}

/**
 * Shape-check a GO argument. Names every malformed field at once — a refusal
 * that reports one problem per attempt is how people end up hand-editing a
 * signed object until it "works".
 */
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

/** The `go` tool argument, shared by every gated tool so they describe it identically. */
export const GO_INPUT_PROP = {
  type: 'object',
  description:
    'The owner-signed GO for exactly this call: {ticketId, action, target, sha256, contentDigest, ' +
    'expiresAt, nonce, signature}, as the relay returns it for the deploy-request (GET ' +
    '/api/tickets/<id>/go). Required on every target the GO policy does not list as ungated. sha256 ' +
    'is the uploaded bundle for an import, the last import under GO for a site publish, and ' +
    'connector_rows_digest of the affected rows for a row action. contentDigest is the draft site ' +
    'hash (connector_site_digest) for a site publish and "-" otherwise. Single-use, and spent before ' +
    'the CMS call — a run that fails has still used it.',
} as const
