/**
 * The state machine — every legal move, who may make it, and what it needs.
 *
 * A move that is not in this table does not exist. The API has no other way to
 * change a ticket's state, so the table IS the enforcement: a caller that skips
 * the UI meets exactly these rules.
 *
 * Two moves are deliberately unreachable through `/transition`:
 *   - `awaiting_go → go_granted` happens only in `/go`, which verifies the
 *     owner's signature. No role can simply declare a GO.
 *   - `go_granted → expired` belongs to `system` — the scheduler — so nobody
 *     can expire a GO early to force a re-sign, or hold one open.
 */

import type { TicketType, TransitionActor, TransitionRecord, Verdict } from './types'

export interface Rule {
  type: TicketType
  from: readonly string[]
  to: string
  roles: readonly TransitionActor[]
  /** A verdict move must cite an evidence message on the same ticket. */
  evidence?: 'required' | 'optional'
  /** The evidence's verdict must say this, or the move is refused. */
  verdict?: Verdict
  /** Moving here records the deploy id the import or publish returned. */
  deployId?: true
}

export const RULES: readonly Rule[] = [
  // ticket — a claim to validate
  { type: 'ticket', from: ['open'], to: 'validating', roles: ['validator'] },
  { type: 'ticket', from: ['validating'], to: 'confirmed', roles: ['validator'], evidence: 'required', verdict: 'confirmed' },
  { type: 'ticket', from: ['validating'], to: 'refuted', roles: ['validator'], evidence: 'required', verdict: 'refuted' },
  { type: 'ticket', from: ['validating'], to: 'needs_info', roles: ['validator'], evidence: 'optional' },
  { type: 'ticket', from: ['needs_info'], to: 'validating', roles: ['builder', 'validator'] },
  {
    type: 'ticket',
    from: ['open', 'validating', 'needs_info', 'confirmed', 'refuted'],
    to: 'disputed',
    roles: ['builder', 'validator'],
  },
  { type: 'ticket', from: ['disputed'], to: 'confirmed', roles: ['owner'] },
  { type: 'ticket', from: ['disputed'], to: 'refuted', roles: ['owner'] },

  // deploy-request — one import or one publish, never both
  { type: 'deploy-request', from: ['awaiting_go'], to: 'go_granted', roles: ['owner'] },
  { type: 'deploy-request', from: ['awaiting_go'], to: 'refused', roles: ['owner'] },
  { type: 'deploy-request', from: ['go_granted'], to: 'revoked', roles: ['owner'] },
  { type: 'deploy-request', from: ['go_granted'], to: 'expired', roles: ['system'] },
  { type: 'deploy-request', from: ['go_granted'], to: 'executing', roles: ['builder'] },
  { type: 'deploy-request', from: ['executing'], to: 'verifying_live', roles: ['builder'], deployId: true },
  { type: 'deploy-request', from: ['executing'], to: 'failed', roles: ['builder'] },
  {
    type: 'deploy-request',
    from: ['verifying_live'],
    to: 'done',
    roles: ['validator'],
    evidence: 'required',
    verdict: 'confirmed',
  },
  {
    type: 'deploy-request',
    from: ['verifying_live'],
    to: 'failed',
    roles: ['validator'],
    evidence: 'required',
    verdict: 'refuted',
  },
  { type: 'deploy-request', from: ['verifying_live'], to: 'disputed', roles: ['builder', 'validator'] },
  { type: 'deploy-request', from: ['disputed'], to: 'done', roles: ['owner'] },
  { type: 'deploy-request', from: ['disputed'], to: 'failed', roles: ['owner'] },
]

export function initialState(type: TicketType): string {
  return type === 'ticket' ? 'open' : 'awaiting_go'
}

export function findRule(type: TicketType, from: string, to: string): Rule | undefined {
  return RULES.find((r) => r.type === type && r.to === to && r.from.includes(from))
}

/** Moves a person could make from here, excluding the ones that need a signed GO or a typed payload. */
export function simpleMovesFor(type: TicketType, state: string, role: TransitionActor): Rule[] {
  return RULES.filter(
    (r) =>
      r.type === type &&
      r.from.includes(state) &&
      r.roles.includes(role) &&
      r.to !== 'go_granted' &&
      r.evidence !== 'required' &&
      !r.deployId,
  )
}

/** The owner deciding a dispute closes it to further dispute. Shared by the store path and the export replay. */
export function setsAdjudicated(tr: Pick<TransitionRecord, 'from' | 'by'>): boolean {
  return tr.from === 'disputed' && tr.by === 'owner'
}
