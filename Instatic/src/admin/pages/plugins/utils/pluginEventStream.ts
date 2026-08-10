/**
 * Plugin event stream — a singleton EventSource subscription to the
 * server's `/cms/api/cms/plugins/events` SSE endpoint. Every admin tab
 * subscribes ONCE; multiple consumers (PluginsPage live-refresh, toast
 * dispatcher, nav badge) attach via `subscribePluginEvents`.
 *
 * The browser's EventSource auto-reconnects on transport errors with
 * native exponential backoff. We don't need bespoke retry logic.
 *
 * Lazy connect: the connection is only opened on the first subscriber
 * and closed when the last subscriber unsubscribes — so admin pages
 * that don't care about plugin events don't pay for the open socket.
 */

import { safeParseValue } from '@core/utils/typeboxHelpers'
import {
  PLUGIN_EVENT_KINDS,
  PluginEventSchema,
  type PluginEvent,
} from '@core/plugins/events'

export type { PluginEvent }

type Listener = (event: PluginEvent) => void
type StatusListener = () => void

const listeners = new Set<Listener>()
let source: EventSource | null = null

/**
 * Connection state, exposed so the Plugins workspace can report whether the
 * lifecycle stream is actually live rather than asserting that it is.
 *
 * Held as a plain boolean snapshot (not read from `source.readyState` on
 * demand) because `useSyncExternalStore` requires `getSnapshot` to be stable
 * between renders — reading a mutating property would return a fresh value
 * mid-render and loop.
 */
const statusListeners = new Set<StatusListener>()
let connected = false

function setConnected(next: boolean): void {
  if (connected === next) return
  connected = next
  for (const listener of statusListeners) {
    try { listener() } catch (err) {
      console.error('[plugin-events] status listener threw:', err)
    }
  }
}

/** True while the EventSource is OPEN. False before the first connect, and
 *  whenever the transport has dropped and is retrying. */
export function getPluginStreamConnected(): boolean {
  return connected
}

export function subscribePluginStreamStatus(listener: StatusListener): () => void {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

function ensureConnected(): void {
  if (source) return
  source = new EventSource('/cms/api/cms/plugins/events', { withCredentials: true })
  // EventSource auto-reconnects on transport errors; `onerror` fires on every
  // drop and `onopen` on every successful (re)connect, so the pair tracks the
  // real state across the whole retry cycle without bespoke retry logic.
  source.onopen = () => setConnected(true)
  source.onerror = () => setConnected(false)
  for (const kind of PLUGIN_EVENT_KINDS) {
    source.addEventListener(kind, (event) => {
      try {
        const result = safeParseValue(PluginEventSchema, JSON.parse((event as MessageEvent).data))
        if (!result.ok) {
          console.warn('[plugin-events] unexpected event shape', result.errors)
          return
        }
        const payload = result.value
        for (const listener of listeners) {
          try { listener(payload) } catch (err) {
            console.error('[plugin-events] listener threw:', err)
          }
        }
      } catch (err) {
        console.error(`[plugin-events] failed to parse "${kind}" payload:`, err)
      }
    })
  }
  // EventSource sets readyState to 0 (CONNECTING) on transport errors and
  // auto-reconnects. We don't need explicit handling.
}

function disconnectIfIdle(): void {
  if (listeners.size > 0) return
  source?.close()
  source = null
  // A closed-by-us stream is not "connected" — without this the last consumer
  // to unmount would leave the flag stuck true for the next one to read.
  setConnected(false)
}

export function subscribePluginEvents(listener: Listener): () => void {
  listeners.add(listener)
  ensureConnected()
  return () => {
    listeners.delete(listener)
    disconnectIfIdle()
  }
}
