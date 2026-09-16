/**
 * The GO gate — what makes an owner's GO a control rather than a record.
 *
 * The partner plan's §3 in one sentence: a ticket system is not on the path to
 * an import, so nothing it records can stop one. This is on the path. Every
 * deploy-class tool calls `checkGo` before it changes anything, and wraps the
 * one call that does in `runUnderGo`.
 *
 * Ordering is the B0.6d lesson: every refusal happens before any write, and
 * every check that needs no CMS read runs before the one that does. The tests
 * count CMS calls rather than reading messages, because a guard that is merely
 * late produces the right message after the damage.
 *
 * What no check made before the write can promise: that the state it read is
 * the state the write lands on. For the site publish that gap is closed at the
 * CMS itself — the draft site hash travels as `If-Match` and is compared after
 * the editor flush, under the publish lock. For row actions it stays open until
 * row publishes take the same precondition.
 */

import { verify, type KeyObject } from 'node:crypto'
import { draftSiteHash, getRow } from '../http/rows'
import type { InstaticSession } from '../http/session'
import { rowsDigest, type RowHashEntry } from '../hash/row'
import { goMessage, parseGo, type Go, type GoAction } from './message'
import { loadGoPolicy } from './policy'
import { isSpent, lastSuccessfulImport, recordOutcome, trySpend } from './ledger'

/**
 * What the GO must match.
 *
 *   bytes  sha256 = the uploaded bundle's bytes (imports); absent for an inline bundle
 *   site   sha256 = the last import under GO that succeeded; contentDigest = the draft site hash now
 *   rows   sha256 = the rows digest of exactly the rows the call touches, read now
 */
export type GoBinding =
  | { kind: 'bytes'; sha256: string | undefined }
  | { kind: 'site'; session: InstaticSession }
  | { kind: 'rows'; session: InstaticSession; rowIds: readonly string[] }

export interface GoReceipt {
  ticketId: string
  nonce: string
  ownerKeyFingerprint: string
}

export type GoPass =
  | { ok: true; gated: false }
  | { ok: true; gated: true; go: Go; ownerKeyFingerprint: string }

export type GoCheck = GoPass | { ok: false; reason: string }

export function verifyGoSignature(go: Go, ownerKey: KeyObject): boolean {
  try {
    return verify(null, Buffer.from(goMessage(go), 'utf8'), ownerKey, Buffer.from(go.signature, 'base64'))
  } catch {
    return false
  }
}

/**
 * The rows digest a row-action GO is signed over: the aggregate
 * `connector_hash_rows` computes, over the rows as the CMS holds them now.
 *
 * It binds WHICH rows — the digest is over their ids — and WHAT they contain.
 * A GO for one article cannot publish or delete another, and an edit made after
 * the owner signed makes the call refuse. That is the content identity the
 * partner ledger locked on 2026-09-01, reused rather than reinvented.
 */
export async function currentRowsDigest(
  session: InstaticSession,
  rowIds: readonly string[],
): Promise<{ rowIds: string[]; digest: string; entries: RowHashEntry[] }> {
  const unique = [...new Set(rowIds)]
  const rows = []
  for (const id of unique) {
    const row = await getRow(session, id)
    rows.push({ id: row.id, tableId: row.tableId, slug: row.slug, cells: row.cells, authorUserId: row.authorUserId })
  }
  return { rowIds: unique, ...rowsDigest(rows) }
}

/** The two values a site-publish GO must name, as they stand now. */
export async function currentSiteDigest(
  session: InstaticSession,
  target: string,
): Promise<{
  target: string
  sha256: string | null
  contentDigest: string | null
  lastImportUnderGo: { ticketId: string; action: GoAction; at: string } | null
}> {
  const last = lastSuccessfulImport(target)
  return {
    target,
    sha256: last?.sha256 ?? null,
    contentDigest: await draftSiteHash(session),
    lastImportUnderGo: last ? { ticketId: last.ticketId, action: last.action, at: last.at } : null,
  }
}

/**
 * Decide whether this call may run.
 *
 * `target` must be the RESOLVED target name — the one the call will actually
 * write to — not the raw argument. The argument may be omitted and filled from
 * a default, and a GO checked against what the caller typed rather than where
 * the write lands binds nothing.
 */
export async function checkGo(
  input: { action: GoAction; target: string; go: unknown; binding: GoBinding },
  now = Date.now(),
): Promise<GoCheck> {
  const loaded = loadGoPolicy()
  if (!loaded.ok) return { ok: false, reason: loaded.reason }
  const { policy } = loaded

  if (policy.ungated.includes(input.target)) return { ok: true, gated: false }

  const { action, binding } = input
  if (!policy.ownerKey || !policy.ownerKeyFingerprint) {
    return {
      ok: false,
      reason: `"${input.target}" needs an owner-signed GO for "${action}", and the GO policy has ${policy.keyProblem}.`,
    }
  }
  const fingerprint = policy.ownerKeyFingerprint

  if (input.go === undefined || input.go === null) {
    return {
      ok: false,
      reason:
        `"${input.target}" needs an owner-signed GO for "${action}". Pass go, taken from the relay ` +
        'deploy-request for this exact action.',
    }
  }
  const parsed = parseGo(input.go)
  if (!parsed.ok) return parsed
  const go = parsed.go

  if (!verifyGoSignature(go, policy.ownerKey)) {
    return { ok: false, reason: `The GO signature does not verify against the owner key ${fingerprint}.` }
  }
  if (go.action !== action) {
    return {
      ok: false,
      reason: `This GO authorizes "${go.action}" and this call is "${action}". Each action needs its own GO.`,
    }
  }
  if (go.target !== input.target) {
    return {
      ok: false,
      reason: `This GO is for target "${go.target}" and this call would write to "${input.target}".`,
    }
  }
  if (Date.parse(go.expiresAt) <= now) {
    return { ok: false, reason: `This GO expired at ${go.expiresAt}.` }
  }
  if (isSpent(go.nonce)) {
    return {
      ok: false,
      reason: `This GO (ticket ${go.ticketId}) has already been used. A GO authorizes one run, including a run that failed.`,
    }
  }

  // The content binding goes last: its CMS reads are the only checks that
  // touch the CMS, and nothing should be read on behalf of a GO that fails for
  // any other reason.
  switch (binding.kind) {
    case 'bytes':
      if (!binding.sha256) {
        return {
          ok: false,
          reason:
            'An inline bundle cannot be bound to a GO — there are no transferred bytes to hash. ' +
            'Upload the bundle and pass uploadId.',
        }
      }
      if (binding.sha256 !== go.sha256) {
        return { ok: false, reason: `The bundle is sha256 ${binding.sha256}; the GO was signed for ${go.sha256}.` }
      }
      break

    case 'site': {
      const last = lastSuccessfulImport(input.target)
      if (!last) {
        return {
          ok: false,
          reason:
            `The most recent import under GO on "${input.target}" did not succeed, or there has been ` +
            'none, so there is no artefact for a publish GO to bind to.',
        }
      }
      if (last.sha256 !== go.sha256) {
        return {
          ok: false,
          reason: `The last import under GO on "${input.target}" was sha256 ${last.sha256}; this publish GO names ${go.sha256}.`,
        }
      }
      const current = await draftSiteHash(binding.session)
      if (current === null) {
        return { ok: false, reason: `"${input.target}" has no draft site, so there is nothing to publish.` }
      }
      if (current !== go.contentDigest) {
        return {
          ok: false,
          reason:
            `The draft site as it is now hashes to ${current}; the GO was signed for ${go.contentDigest}. ` +
            'The draft changed after it was signed.',
        }
      }
      break
    }

    case 'rows': {
      if (binding.rowIds.length === 0) return { ok: false, reason: 'No rows were named, so there is nothing to bind.' }
      const { digest } = await currentRowsDigest(binding.session, binding.rowIds)
      if (digest !== go.sha256) {
        return {
          ok: false,
          reason:
            `These rows, as they are now, digest to ${digest}; the GO was signed for ${go.sha256}. ` +
            'Either the GO names other rows, or they changed after it was signed.',
        }
      }
      break
    }
  }

  return { ok: true, gated: true, go, ownerKeyFingerprint: fingerprint }
}

export type GoRun<T> = { ok: true; result: T; receipt?: GoReceipt } | { ok: false; reason: string }

/**
 * Spend the GO, run the site-changing call, record how it went.
 *
 * The call receives the verified GO (undefined on an ungated target) so a
 * publish can hand its contentDigest to the CMS as the precondition. Expiry is
 * checked again because a dry run or a CMS read can sit between `checkGo` and
 * here, and the spend is atomic against a second call carrying the same GO.
 */
export async function runUnderGo<T>(gate: GoPass, run: (go: Go | undefined) => Promise<T>): Promise<GoRun<T>> {
  if (!gate.gated) return { ok: true, result: await run(undefined) }
  const { go } = gate

  if (Date.parse(go.expiresAt) <= Date.now()) {
    return { ok: false, reason: `This GO expired at ${go.expiresAt}, before the site-changing call started.` }
  }
  if (!trySpend(go)) {
    return { ok: false, reason: `This GO (ticket ${go.ticketId}) was used by another call first.` }
  }

  let result: T
  try {
    result = await run(go)
  } catch (err) {
    recordOutcome(go.nonce, 'failed')
    throw err
  }
  recordOutcome(go.nonce, 'ok')
  return {
    ok: true,
    result,
    receipt: { ticketId: go.ticketId, nonce: go.nonce, ownerKeyFingerprint: gate.ownerKeyFingerprint },
  }
}

export function goRefusal(reason: string): string {
  return `Refused: ${reason} Nothing was written to the site.`
}

/** What the gate would decide, for a dry run that needs no GO of its own. */
export function describeGo(gate: GoCheck): Record<string, unknown> {
  if (!gate.ok) return { required: true, wouldPass: false, reason: gate.reason }
  if (!gate.gated) return { required: false, reason: 'This target is ungated (staging).' }
  return {
    required: true,
    wouldPass: true,
    ticketId: gate.go.ticketId,
    ownerKeyFingerprint: gate.ownerKeyFingerprint,
  }
}
