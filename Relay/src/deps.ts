import type { Blobs, Store } from './store'
import type { RelayEvent } from './types'

export interface RelayConfig {
  /**
   * Base64 raw Ed25519 key of the approver for every property without one of
   * its own. Empty means only properties listed in `propertyApprovers` can be
   * approved.
   */
  ownerPublicKey: string
  /**
   * Per-property approvers, by the target name a deploy-request names. A
   * property listed here is approved by its own key alone — the platform key
   * does not approve it, and a key that is unusable refuses rather than falling
   * back, so a misconfigured property never becomes approvable by the platform.
   * The Connector resolves the approver on exactly this rule.
   */
  propertyApprovers: Record<string, string>
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
