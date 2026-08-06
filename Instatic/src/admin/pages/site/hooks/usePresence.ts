/**
 * usePresence — who else has this workspace open, and whether our own draft
 * channel is healthy.
 *
 * Two moving parts, matching the server:
 *   1. An `EventSource` on `/cms/api/cms/presence/events` that receives the
 *      whole roster on every change (the browser handles reconnect/backoff).
 *   2. A heartbeat POST every `HEARTBEAT_INTERVAL_MS` that keeps this tab in
 *      the roster, plus a `leave` beacon on `pagehide`.
 *
 * The heartbeat — not the socket — is what decides liveness. An SSE stream can
 * survive a suspended laptop or sit behind a buffering proxy, so "the socket is
 * open" would happily report a peer who closed their laptop ten minutes ago.
 *
 * `connection` is deliberately derived from whether our own heartbeats are
 * landing, because that is the honest question the header's sync pill asks:
 * *is my draft still talking to the server?* A failed heartbeat means an edit
 * might not be saved, which is exactly when Publish should be blocked.
 */
import { useEffect, useState } from 'react'
import { apiRequest } from '@core/http'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import { PresenceRosterSchema, type PresencePeer, type PresenceScope } from '@core/presence'

/** Mirrors `server/presence/presenceRegistry.ts`; the server is authoritative. */
const HEARTBEAT_INTERVAL_MS = 20_000

/** Consecutive heartbeat failures before we call the channel dead rather than flaky. */
const FAILURES_BEFORE_OFFLINE = 2

export type PresenceConnectionState = 'connecting' | 'online' | 'offline' | 'failed'

export interface PresenceState {
  /** Other people in this workspace — never includes us. */
  peers: PresencePeer[]
  connection: PresenceConnectionState
}

const EMPTY_PEERS: PresencePeer[] = []

export function usePresence(scope: PresenceScope): PresenceState {
  const [peers, setPeers] = useState<PresencePeer[]>(EMPTY_PEERS)
  const [connection, setConnection] = useState<PresenceConnectionState>('connecting')

  useEffect(() => {
    // One id per tab, per mount. Two tabs from the same person are two peers
    // server-side but collapse to one avatar below — the roster is "who", not
    // "how many windows".
    const sessionId = crypto.randomUUID()
    let disposed = false
    let failures = 0

    async function beat(leave = false): Promise<void> {
      try {
        await apiRequest('/cms/api/cms/presence/heartbeat', {
          method: 'POST',
          body: { scope, sessionId, leave },
        })
        if (disposed) return
        failures = 0
        setConnection('online')
      } catch {
        if (disposed || leave) return
        failures += 1
        // One dropped request is a blip, not an outage; the pill should not
        // flap on a single lost packet.
        setConnection(failures >= FAILURES_BEFORE_OFFLINE ? 'offline' : 'connecting')
      }
    }

    void beat()
    const timer = setInterval(() => { void beat() }, HEARTBEAT_INTERVAL_MS)

    // No EventSource means no roster — server-side rendering and the jsdom
    // test environment both land here. Presence is an enhancement, so the
    // editor must mount without it rather than throwing on the way up.
    const source = typeof EventSource === 'undefined'
      ? null
      : new EventSource(
          `/cms/api/cms/presence/events?scope=${encodeURIComponent(scope)}`,
          { withCredentials: true },
        )

    source?.addEventListener('roster', (event) => {
      if (disposed) return
      let raw: unknown
      try {
        raw = JSON.parse((event as MessageEvent).data)
      } catch (err) {
        console.warn('[presence] unparseable roster frame:', err)
        return
      }
      const result = safeParseValue(PresenceRosterSchema, raw)
      if (!result.ok) {
        console.warn('[presence] unexpected roster shape', result.errors)
        return
      }
      // Drop ourselves, then collapse a person's multiple tabs to one avatar.
      const others = new Map<string, PresencePeer>()
      for (const peer of result.value.peers) {
        if (peer.sessionId === sessionId) continue
        const seen = others.get(peer.userId)
        if (!seen || peer.lastSeen > seen.lastSeen) others.set(peer.userId, peer)
      }
      setPeers([...others.values()])
    })

    // EventSource reconnects on its own; a transport error only means the
    // roster is momentarily stale, which the heartbeat state already covers.
    source?.addEventListener('error', () => {
      if (!disposed && failures >= FAILURES_BEFORE_OFFLINE) setConnection('failed')
    })

    // `pagehide` (not `beforeunload`) is the one event that reliably fires on
    // mobile Safari and on bfcache navigation, so the peer disappears at once
    // instead of lingering for the TTL.
    const onPageHide = () => { void beat(true) }
    window.addEventListener('pagehide', onPageHide)

    return () => {
      disposed = true
      clearInterval(timer)
      window.removeEventListener('pagehide', onPageHide)
      source?.close()
      void beat(true)
    }
  }, [scope])

  return { peers, connection }
}
