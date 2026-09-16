import type { Blobs, Store } from './store'
import type { RelayEvent } from './types'

export interface RelayConfig {
  /** Base64 raw Ed25519 key. Empty means no GO can be granted. */
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
