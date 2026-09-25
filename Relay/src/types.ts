/**
 * Relay records. `null` rather than optional fields throughout, so a record
 * survives a JSON round trip unchanged — the export is re-read by the owner's
 * own code, and "missing" and "null" must not compare differently there.
 */

import type { Go, GoAction } from './go'

export type Role = 'owner' | 'builder' | 'validator'

/** Who made a transition. `system` is the scheduler, which only ever expires GOs. */
export type TransitionActor = Role | 'system'

export interface Actor {
  role: Role
  /** Access identity: an email, or `service:<token id>` for the validator's service token. */
  subject: string
}

export type TicketType = 'ticket' | 'deploy-request'

export type MessageKind = 'comment' | 'info' | 'evidence' | 'reported-instruction'

export type Verdict = 'confirmed' | 'refuted' | 'abstain'

/** The partner plan's evidence block — required on every verdict. */
export interface Evidence {
  claim: string
  /** Recorded before the check ran. */
  prediction: string
  artefacts: string[]
  commands: string[]
  output: string
  verdict: Verdict
  /** What the check could not see. */
  blindSpots: string
}

export interface Ticket {
  id: string
  seq: number
  type: TicketType
  title: string
  body: string
  state: string
  createdBy: Role
  createdAt: string
  updatedAt: string
  /** When the current state was entered — what the stall timer measures from. */
  stateSince: string
  artefacts: string[]
  /** deploy-request only; fixed at creation and never updatable. */
  action: GoAction | null
  target: string | null
  sha256: string | null
  /** deploy-request for a site publish only: the draft site hash the GO must bind. */
  contentDigest: string | null
  deployId: string | null
  validatorStalled: boolean
  lastValidatorAt: string | null
  /** The owner has decided a dispute; it cannot be disputed again. */
  adjudicated: boolean
}

export interface Message {
  id: string
  seq: number
  ticketId: string
  kind: MessageKind
  author: Role
  body: string
  evidence: Evidence | null
  replyTo: string | null
  artefacts: string[]
  /** Server clock only — never taken from the request. */
  createdAt: string
}

export interface TransitionRecord {
  seq: number
  ticketId: string
  from: string
  to: string
  by: TransitionActor
  at: string
  evidenceMessageId: string | null
  deployId: string | null
}

export interface ArtefactMeta {
  sha256: string
  seq: number
  bytes: number
  uploadedBy: Role
  createdAt: string
}

export interface GoRecord {
  ticketId: string
  seq: number
  go: Go
  ownerKeyFingerprint: string
  grantedAt: string
  consumedAt: string | null
  consumedSeq: number | null
}

/**
 * Who may approve a property, and from when (R6).
 *
 * One live row per property; a rotation retires the old row and inserts a new
 * one, so the registry is both the current answer and the history that explains
 * an old receipt. A retired row authorises nothing.
 */
/**
 * A property designated as a test property, or that designation removed.
 *
 * Both are rows and the highest `seq` for a property is the one in force, so
 * the table is append-only in the strict sense — nothing is ever updated, and
 * the history of who allowed what stays readable. The designation is published,
 * so that history is the thing that makes it auditable.
 */
export interface TestPropertyRecord {
  id: string
  seq: number
  property: string
  /** True designates; false removes the designation. */
  designated: boolean
  at: string
  /** The owner who made the call — recorded rather than assumed. */
  by: string
  reason: string | null
  createdAt: string
}

export interface ApproverRecord {
  id: string
  seq: number
  /** The property, or — for a business-level row — the business's own name. */
  property: string
  level: 'project' | 'business'
  /** Properties a business-level approver may approve. Explicit, never inferred. */
  covers: string[] | null
  publicKey: string
  fingerprint: string
  effectiveFrom: string
  retiredAt: string | null
  registeredBy: string
  reason: string | null
  createdAt: string
}

export interface FlagRecord {
  seq: number
  ticketId: string
  validatorStalled: boolean
  at: string
}

export interface IdempotencyRecord {
  subject: string
  key: string
  requestSha256: string
  status: number
  body: string
  createdAt: string
}

/** One line of the JSONL export. Ordered by `seq`, which is global across record types. */
export type ExportLine =
  | {
      type: 'ticket'
      seq: number
      id: string
      ticketType: TicketType
      title: string
      body: string
      createdBy: Role
      createdAt: string
      artefacts: string[]
      action: GoAction | null
      target: string | null
      sha256: string | null
      contentDigest: string | null
      initialState: string
    }
  | ({ type: 'message' } & Message)
  | ({ type: 'transition' } & TransitionRecord)
  | ({ type: 'artefact' } & ArtefactMeta)
  | { type: 'go'; seq: number; ticketId: string; go: Go; ownerKeyFingerprint: string; grantedAt: string }
  | { type: 'go_consumed'; seq: number; ticketId: string; at: string }
  | ({ type: 'flag' } & FlagRecord)

export interface RelayEvent {
  event: 'ticket_created' | 'state_changed' | 'validator_stalled' | 'message_posted'
  ticketId: string
  state: string
  title: string
  at: string
  /**
   * Set on `message_posted`: which message, by whom, and of what kind — never
   * its text. A notification is read by whoever receives it, so its content
   * stays typed fields for the same reason the rest of this event is.
   */
  messageId?: string
  author?: string
  kind?: string
}
