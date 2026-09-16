/**
 * The scheduled pass: expire GOs and flag a validator that has gone quiet.
 *
 * Expiry is also enforced at the moment of use (`/transition` to executing,
 * `GET .../go`, and independently in the Connector), so this pass only makes
 * the record say what is already true. The stall flag is the partner plan's
 * timer: a ticket left in `validating` with no validator activity for
 * `STALL_MINUTES` is flagged and the notifier fires once.
 */

import type { Deps } from './deps'

export async function runScheduled(deps: Deps): Promise<{ expired: string[]; stalled: string[] }> {
  const now = deps.now()
  const at = now.toISOString()
  const expired: string[] = []
  const stalled: string[] = []

  for (const t of await deps.store.listTickets()) {
    if (t.type === 'deploy-request' && t.state === 'go_granted') {
      const record = await deps.store.getGo(t.id)
      if (record && Date.parse(record.go.expiresAt) <= now.getTime()) {
        const moved = await deps.store.applyTransition(
          {
            seq: await deps.store.nextSeq(),
            ticketId: t.id,
            from: 'go_granted',
            to: 'expired',
            by: 'system',
            at,
            evidenceMessageId: null,
            deployId: null,
          },
          {},
        )
        if (moved) {
          expired.push(t.id)
          deps.notify({ event: 'state_changed', ticketId: t.id, state: 'expired', title: t.title, at })
        }
      }
    }

    if (t.type === 'ticket' && t.state === 'validating' && !t.validatorStalled) {
      const lastSeen = Math.max(Date.parse(t.stateSince), t.lastValidatorAt ? Date.parse(t.lastValidatorAt) : 0)
      if (now.getTime() - lastSeen >= deps.config.stallMinutes * 60_000) {
        await deps.store.setStalled({ seq: await deps.store.nextSeq(), ticketId: t.id, validatorStalled: true, at })
        stalled.push(t.id)
        deps.notify({ event: 'validator_stalled', ticketId: t.id, state: t.state, title: t.title, at })
      }
    }
  }

  return { expired, stalled }
}
