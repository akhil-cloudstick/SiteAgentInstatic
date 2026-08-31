/**
 * Approval verification — the gate `release` cannot be talked past.
 *
 * Every check here fails closed and names exactly which binding broke, because
 * "approval mismatch" with no detail is what makes people override the gate.
 *
 * What this can and cannot promise: verifying here proves the CLI's view
 * matches the approval. It does NOT prove the server will publish that same
 * state — an editor can write between this check and the publish call. Closing
 * that requires the server-side expected-hash contract (If-Match on site and
 * row publish) or a real writer freeze. Client-side verification is a
 * precondition, never the guarantee.
 */

import { createHash } from 'node:crypto'
import { Value } from '@sinclair/typebox/value'
import { canonicalJson } from '../hash/canonical'
import {
  ApprovalRecordSchema,
  ReleaseManifestSchema,
  type ApprovalRecord,
  type ReleaseManifest,
} from './schema'

export interface ObservedState {
  snapshotSha256: string
  documentSha256: string
  rowsDigestSha256: string
  mediaDigestSha256: string
  logicalContractSha256: string
  releaseRecipeSha256: string
  connectorLockSha256: string
  targetBaselineSha256: string
  bindingManifestId: string
  bindingManifestVersion: number
  bindingManifestSha256: string
  projectId: string
  tenantId: string
  domain: string
}

export interface BindingFailure {
  binding: string
  expected: string
  actual: string
}

export class ApprovalRejectedError extends Error {
  override readonly name = 'ApprovalRejectedError'
  readonly failures: BindingFailure[]
  constructor(failures: BindingFailure[]) {
    super(
      `Approval does not bind this release — ${failures.length} mismatch(es): ` +
        failures.map((f) => f.binding).join(', '),
    )
    this.failures = failures
  }
}

export function parseApproval(raw: unknown): ApprovalRecord {
  if (!Value.Check(ApprovalRecordSchema, raw)) {
    const first = [...Value.Errors(ApprovalRecordSchema, raw)][0]
    throw new Error(
      `Approval record is not valid: ${first ? `${first.path} ${first.message}` : 'unknown error'}`,
    )
  }
  return raw
}

export function parseReleaseManifest(raw: unknown): ReleaseManifest {
  if (!Value.Check(ReleaseManifestSchema, raw)) {
    const first = [...Value.Errors(ReleaseManifestSchema, raw)][0]
    throw new Error(
      `Release manifest is not valid: ${first ? `${first.path} ${first.message}` : 'unknown error'}`,
    )
  }
  return raw
}

export function releaseManifestHash(manifest: ReleaseManifest): string {
  return createHash('sha256').update(canonicalJson(manifest)).digest('hex')
}

/**
 * Verify every binding. Returns nothing on success; throws with the full list of
 * failures rather than the first one, so a broken release is diagnosed in one
 * pass instead of one re-run per mismatch.
 */
export function verifyApproval(
  approval: ApprovalRecord,
  observed: ObservedState,
  manifest: ReleaseManifest,
): void {
  const failures: BindingFailure[] = []
  const check = (binding: string, expected: string | number, actual: string | number): void => {
    if (String(expected) !== String(actual)) {
      failures.push({ binding, expected: String(expected), actual: String(actual) })
    }
  }

  check('context.projectId', approval.context.projectId, observed.projectId)
  check('context.tenantId', approval.context.tenantId, observed.tenantId)
  check('context.domain', approval.context.domain, observed.domain)

  check('source.snapshotSha256', approval.source.snapshotSha256, observed.snapshotSha256)

  check('cms.documentSha256', approval.cms.documentSha256, observed.documentSha256)
  check('cms.rowsDigestSha256', approval.cms.rowsDigestSha256, observed.rowsDigestSha256)
  check('cms.mediaDigestSha256', approval.cms.mediaDigestSha256, observed.mediaDigestSha256)
  check(
    'cms.logicalContractSha256',
    approval.cms.logicalContractSha256,
    observed.logicalContractSha256,
  )
  check('cms.bindingManifestId', approval.cms.bindingManifestId, observed.bindingManifestId)
  check(
    'cms.bindingManifestVersion',
    approval.cms.bindingManifestVersion,
    observed.bindingManifestVersion,
  )
  check(
    'cms.bindingManifestSha256',
    approval.cms.bindingManifestSha256,
    observed.bindingManifestSha256,
  )

  check('release.releaseRecipeSha256', approval.release.releaseRecipeSha256, observed.releaseRecipeSha256)
  check('release.connectorLockSha256', approval.release.connectorLockSha256, observed.connectorLockSha256)
  check(
    'release.targetBaselineSha256',
    approval.release.targetBaselineSha256,
    observed.targetBaselineSha256,
  )
  check(
    'release.releaseManifestSha256',
    approval.release.releaseManifestSha256,
    releaseManifestHash(manifest),
  )

  if (approval.attestations.length === 0) {
    failures.push({ binding: 'attestations', expected: '>=1 signer', actual: '0' })
  }

  if (failures.length > 0) throw new ApprovalRejectedError(failures)
}
