import { describe, expect, test } from 'bun:test'
import {
  verifyApproval,
  parseApproval,
  releaseManifestHash,
  ApprovalRejectedError,
  type ObservedState,
} from '../src/approval/verify'
import type { ApprovalRecord, ReleaseManifest } from '../src/approval/schema'

const h = (c: string): string => c.repeat(64)

const manifest: ReleaseManifest = {
  schemaVersion: 1,
  rows: [{ rowId: 'r1', expectedRowHash: h('1') }],
  media: [{ mediaId: 'm1', byteSha256: h('2') }],
}

const approval: ApprovalRecord = {
  schemaVersion: 1,
  approvalId: 'ap-1',
  status: 'approved',
  context: {
    organizationId: 'org',
    clientId: 'cli',
    projectId: 'proj',
    tenantId: 'ten',
    domain: 'example.com',
  },
  source: {
    snapshotId: 'snap-1',
    snapshotSha256: h('a'),
    sourceManifestId: 'sm-1',
    sourceManifestVersion: 1,
    sourceManifestSha256: h('b'),
  },
  cms: {
    logicalContractSha256: h('c'),
    bindingManifestId: 'bm-1',
    bindingManifestVersion: 2,
    bindingManifestSha256: h('d'),
    documentSha256: h('e'),
    rowsDigestSha256: h('f'),
    mediaDigestSha256: h('0'),
  },
  release: {
    releaseManifestSha256: releaseManifestHash(manifest),
    connectorLockSha256: h('3'),
    releaseRecipeSha256: h('4'),
    targetBaselineSha256: h('5'),
  },
  attestations: [{ role: 'operator', accountId: 'op', signedAt: '2026-08-26T00:00:00Z' }],
}

const observed: ObservedState = {
  snapshotSha256: h('a'),
  documentSha256: h('e'),
  rowsDigestSha256: h('f'),
  mediaDigestSha256: h('0'),
  logicalContractSha256: h('c'),
  releaseRecipeSha256: h('4'),
  connectorLockSha256: h('3'),
  targetBaselineSha256: h('5'),
  bindingManifestId: 'bm-1',
  bindingManifestVersion: 2,
  bindingManifestSha256: h('d'),
  projectId: 'proj',
  tenantId: 'ten',
  domain: 'example.com',
}

describe('verifyApproval', () => {
  test('accepts a fully matching release', () => {
    expect(() => verifyApproval(approval, observed, manifest)).not.toThrow()
  })

  // Each binding must fail independently — a gate that only checks some of
  // them is the gate that lets draft A's approval release draft B.
  test.each([
    ['context.projectId', { projectId: 'other-project' }],
    ['context.tenantId', { tenantId: 'other-tenant' }],
    ['context.domain', { domain: 'evil.example' }],
    ['source.snapshotSha256', { snapshotSha256: h('9') }],
    ['cms.documentSha256', { documentSha256: h('9') }],
    ['cms.rowsDigestSha256', { rowsDigestSha256: h('9') }],
    ['cms.mediaDigestSha256', { mediaDigestSha256: h('9') }],
    ['cms.logicalContractSha256', { logicalContractSha256: h('9') }],
    ['cms.bindingManifestId', { bindingManifestId: 'other' }],
    ['cms.bindingManifestVersion', { bindingManifestVersion: 99 }],
    ['cms.bindingManifestSha256', { bindingManifestSha256: h('9') }],
    ['release.releaseRecipeSha256', { releaseRecipeSha256: h('9') }],
    ['release.connectorLockSha256', { connectorLockSha256: h('9') }],
    ['release.targetBaselineSha256', { targetBaselineSha256: h('9') }],
  ])('rejects when %s differs', (binding, drift) => {
    try {
      verifyApproval(approval, { ...observed, ...(drift as Partial<ObservedState>) }, manifest)
      throw new Error('expected rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(ApprovalRejectedError)
      expect((err as ApprovalRejectedError).failures.map((f) => f.binding)).toContain(binding)
    }
  })

  test('rejects a tampered release manifest even when its digest field is untouched', () => {
    const tampered: ReleaseManifest = {
      ...manifest,
      rows: [{ rowId: 'r1', expectedRowHash: h('9') }],
    }
    expect(() => verifyApproval(approval, observed, tampered)).toThrow(ApprovalRejectedError)
  })

  test('reports every failure at once, not just the first', () => {
    try {
      verifyApproval(
        approval,
        { ...observed, projectId: 'x', documentSha256: h('9'), tenantId: 'y' },
        manifest,
      )
      throw new Error('expected rejection')
    } catch (err) {
      expect((err as ApprovalRejectedError).failures.length).toBe(3)
    }
  })
})

describe('parseApproval', () => {
  test('rejects a record missing attestations', () => {
    expect(() => parseApproval({ ...approval, attestations: [] })).toThrow()
  })

  test('rejects a non-sha256 hash', () => {
    expect(() =>
      parseApproval({ ...approval, cms: { ...approval.cms, documentSha256: 'nope' } }),
    ).toThrow()
  })

  test('rejects a record that is not status=approved', () => {
    expect(() => parseApproval({ ...approval, status: 'pending' })).toThrow()
  })
})
