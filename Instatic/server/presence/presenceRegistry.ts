/**
 * Presence registry — who currently has a workspace open.
 *
 * In-memory by design. Presence is true only for as long as a browser tab is
 * alive, so persisting it would mean storing a fact that is already stale by
 * the time it is written, plus a migration and a cleanup job for no gain. A
 * server restart empties the roster; every connected client re-announces on
 * its next heartbeat, which is at most `HEARTBEAT_INTERVAL_MS` away.
 *
 * Shape mirrors `server/plugins/eventBroadcaster.ts`: a module-level store
 * plus a subscribe/broadcast pair, so the SSE endpoint owns delivery and tests
 * can assert on the roster without opening a connection.
 *
 * Liveness is heartbeat-based rather than connection-based on purpose. An SSE
 * stream can stay open through a suspended laptop or a proxy that buffers, so
 * "the socket is open" is a weaker signal than "this tab said hello 20 seconds
 * ago". A peer that misses `PEER_TTL_MS` is dropped whether or not its stream
 * looks alive.
 */
import type { PresencePeer, PresenceScope } from '@core/presence'

/** How often a client is expected to check in. Mirrored by `usePresence`. */
export const HEARTBEAT_INTERVAL_MS = 20_000

/** Miss ~2.5 heartbeats and you are gone. Tolerates one dropped request. */
export const PEER_TTL_MS = 50_000

interface StoredPeer extends PresencePeer {
  scope: PresenceScope
}

type RosterListener = (scope: PresenceScope) => void

const peersByScope = new Map<PresenceScope, Map<string, StoredPeer>>()
const listeners = new Set<RosterListener>()

function scopeMap(scope: PresenceScope): Map<string, StoredPeer> {
  const existing = peersByScope.get(scope)
  if (existing) return existing
  const created = new Map<string, StoredPeer>()
  peersByScope.set(scope, created)
  return created
}

function notify(scope: PresenceScope): void {
  for (const listener of listeners) {
    try {
      listener(scope)
    } catch (err) {
      console.error('[presence] subscriber threw:', err)
    }
  }
}

/**
 * Drop peers whose last heartbeat is older than the TTL. Called on every read
 * and every write instead of on a timer: with no connected clients there is
 * nothing to expire, and with connected clients the heartbeats themselves
 * provide a better clock than an interval that would keep the process awake.
 *
 * Returns true when something was actually removed, so callers only broadcast
 * on a real change.
 */
function evictExpired(scope: PresenceScope, now: number): boolean {
  const map = peersByScope.get(scope)
  if (!map) return false

  let changed = false
  for (const [sessionId, peer] of map) {
    if (now - peer.lastSeen > PEER_TTL_MS) {
      map.delete(sessionId)
      changed = true
    }
  }
  return changed
}

/**
 * Record (or refresh) a peer. Returns true when the roster changed in a way
 * other clients need to see — a new arrival or an eviction. A plain heartbeat
 * from a known peer only moves `lastSeen`, which nobody renders, so it does
 * not trigger a broadcast.
 */
export function touchPeer(peer: StoredPeer): boolean {
  const map = scopeMap(peer.scope)
  const isNew = !map.has(peer.sessionId)
  map.set(peer.sessionId, peer)

  const changed = evictExpired(peer.scope, peer.lastSeen) || isNew
  if (changed) notify(peer.scope)
  return changed
}

/** Remove a peer immediately — the `pagehide` path, so tabs vanish at once. */
export function removePeer(scope: PresenceScope, sessionId: string): boolean {
  const map = peersByScope.get(scope)
  if (!map?.delete(sessionId)) return false
  notify(scope)
  return true
}

/**
 * The current roster for a scope, freshly evicted and ordered oldest-first so
 * the avatar stack is stable: a new peer appends rather than reshuffling
 * everyone.
 */
export function getRoster(scope: PresenceScope, now: number = Date.now()): PresencePeer[] {
  if (evictExpired(scope, now)) notify(scope)

  return [...(peersByScope.get(scope)?.values() ?? [])]
    .map(({ scope: _scope, ...peer }) => peer)
    .sort((a, b) => a.lastSeen - b.lastSeen || a.sessionId.localeCompare(b.sessionId))
}

/** Subscribe to roster changes. Returns an unsubscribe function. */
export function subscribePresence(listener: RosterListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test seam — reset module state between cases. */
export function __resetPresenceForTesting(): void {
  peersByScope.clear()
  listeners.clear()
}
