/**
 * The approval record — one immutable object, referenced by every surface.
 *
 * Earlier drafts of this design bound different field sets in the command, the
 * diagram and the governance section. That is worse than binding nothing,
 * because each surface looks authoritative. There is exactly one schema, here.
 *
 * What it binds, and why each field is not optional:
 *
 *   context   — approving draft A on target X must not authorize releasing onto
 *               target Y. Project, tenant and domain are separate because one
 *               project can own several tenants and a tenant can serve several
 *               domains.
 *   source    — the immutable archive the approval was granted against. A fresh
 *               capture is a new snapshot and re-enters approval; it never
 *               silently becomes the next run's input.
 *   cms       — document (site, pages, components — NOT layouts), rows digest
 *               (the 397 post bodies the document hash does not cover), media
 *               digest (byte-level: bytes change while ids do not), and the
 *               logical content contract (a retyped field means the emitted
 *               cells no longer mean what was approved).
 *   release   — the recipe, so the same content built a different way is a
 *               different release; and the connector lock, so a different fork
 *               cannot satisfy an approval granted against this one.
 *   attestations — who signed. An approval with no signer is a formality.
 */

import { Type, type Static } from '@sinclair/typebox'

const Sha256 = Type.String({ pattern: '^[0-9a-f]{64}$' })

export const ApprovalContextSchema = Type.Object({
  organizationId: Type.String({ minLength: 1 }),
  clientId: Type.String({ minLength: 1 }),
  projectId: Type.String({ minLength: 1 }),
  tenantId: Type.String({ minLength: 1 }),
  domain: Type.String({ minLength: 1 }),
})

export const ApprovalSourceSchema = Type.Object({
  snapshotId: Type.String({ minLength: 1 }),
  snapshotSha256: Sha256,
  sourceManifestId: Type.String({ minLength: 1 }),
  sourceManifestVersion: Type.Integer({ minimum: 1 }),
  sourceManifestSha256: Sha256,
})

export const ApprovalCmsSchema = Type.Object({
  logicalContractSha256: Sha256,
  bindingManifestId: Type.String({ minLength: 1 }),
  bindingManifestVersion: Type.Integer({ minimum: 1 }),
  bindingManifestSha256: Sha256,
  documentSha256: Sha256,
  rowsDigestSha256: Sha256,
  mediaDigestSha256: Sha256,
})

export const ApprovalReleaseSchema = Type.Object({
  releaseManifestSha256: Sha256,
  connectorLockSha256: Sha256,
  releaseRecipeSha256: Sha256,
  targetBaselineSha256: Sha256,
})

export const AttestationSchema = Type.Object({
  role: Type.Union([Type.Literal('operator'), Type.Literal('client')]),
  accountId: Type.String({ minLength: 1 }),
  signedAt: Type.String({ minLength: 1 }),
})

export const ApprovalRecordSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  approvalId: Type.String({ minLength: 1 }),
  status: Type.Literal('approved'),
  context: ApprovalContextSchema,
  source: ApprovalSourceSchema,
  cms: ApprovalCmsSchema,
  release: ApprovalReleaseSchema,
  attestations: Type.Array(AttestationSchema, { minItems: 1 }),
})

export type ApprovalRecord = Static<typeof ApprovalRecordSchema>

/**
 * The release manifest the approval binds by hash. It carries the per-row and
 * per-media entries themselves; the approval only carries their digest, so the
 * approval stays small while every individual expected hash remains verifiable.
 */
export const ReleaseManifestSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  rows: Type.Array(
    Type.Object({ rowId: Type.String(), expectedRowHash: Sha256 }),
  ),
  media: Type.Array(Type.Object({ mediaId: Type.String(), byteSha256: Sha256 })),
})

export type ReleaseManifest = Static<typeof ReleaseManifestSchema>
