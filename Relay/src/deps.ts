import type { Blobs, Store } from './store'
import type { RelayEvent } from './types'

export interface RelayConfig {
  /**
   * The owner's own identity, shown on the queue and on `/api/whoami` so a
   * swapped key is visible without logging in.
   *
   * It approves NOTHING on its own. Which key approves a property is resolved
   * from the approver registry and only from there (R6) — there is no default
   * approver and no fallback, because "a fallback that widens scope on error is
   * a master key by another name" (PRD 5.3).
   */
  ownerPublicKey: string
  stallMinutes: number
  goMaxTtlHours: number
}

/** Everything the handlers touch, injected — so the state machine runs under `bun test` with no Worker. */
export interface Deps {
  store: Store
  blobs: Blobs
  config: RelayConfig
  now: () => Date
  /** Fire-and-forget. A notifier outage must never fail a write. */
  notify: (event: RelayEvent) => void
}
