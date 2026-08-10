/**
 * adminNotifications — the store behind the Product Hub header's bell.
 *
 * The shared-header contract requires a Notifications utility with an unread
 * count. Toasts already exist and are the right surface for "the thing you just
 * did failed" — they are transient by design. This store is the durable half:
 * things that stay true until acknowledged, and that a user arriving on any
 * admin route should still be told about.
 *
 * Two producers today:
 *
 *  1. **Plugin lifecycle errors** — derived, not pushed. `pluginIssuesStore` is
 *     already fed by the plugin SSE stream and already knows which plugins are
 *     parked or crashed, so the bell subscribes to it rather than duplicating
 *     that bookkeeping. A plugin recovering removes its entry automatically,
 *     which a push-only model could not do.
 *  2. **`pushAdminNotification`** — the explicit producer for one-shot events
 *     worth surviving a toast's four seconds. Publish failure is the first
 *     caller.
 *
 * Deliberately not persisted: an admin notification describes the state of the
 * running install, and a reload re-derives the derived half from live data.
 * Storing the acknowledged set would mean re-showing stale entries after a
 * server restart cleared the underlying condition.
 *
 * Plain `useSyncExternalStore` rather than Zustand — the shape is a list plus a
 * read-marker, the header is the only consumer, and this keeps the module out
 * of any store's dependency graph so `AdminPageLayout` stays light.
 */
import {
  getPluginsInErrorCount,
  subscribePluginIssues,
} from '@admin/pages/plugins/utils/pluginIssuesStore'

export interface AdminNotification {
  id: string
  kind: 'error' | 'warning' | 'info'
  title: string
  body: string
  /** ISO timestamp — rendered as a relative age in the panel. */
  at: string
}

interface NotificationsSnapshot {
  items: AdminNotification[]
  unreadCount: number
}

/** Explicitly pushed entries, newest first. */
let pushed: AdminNotification[] = []
/** Ids the user has seen. Entries stay in the list; only the count drops. */
let acknowledged = new Set<string>()
/** Plugin-error count as of the last `pluginIssuesStore` emit. */
let pluginErrorCount = getPluginsInErrorCount()
/** True once the user has opened the panel while the plugin count was current. */
let acknowledgedPluginErrorCount = 0

let snapshot: NotificationsSnapshot = buildSnapshot()

const listeners = new Set<() => void>()

/**
 * Cap the retained list. An install that fails to publish in a loop should not
 * grow this array without bound; the newest entries are the actionable ones.
 */
const MAX_RETAINED = 50

/** Synthetic id for the derived plugin-health entry — stable, so it dedupes. */
const PLUGIN_HEALTH_ID = 'plugin-health'

function buildSnapshot(): NotificationsSnapshot {
  const items: AdminNotification[] = []

  if (pluginErrorCount > 0) {
    const noun = pluginErrorCount === 1 ? 'plugin' : 'plugins'
    items.push({
      id: PLUGIN_HEALTH_ID,
      kind: 'error',
      title: `${pluginErrorCount} ${noun} stopped`,
      body: 'Open the Plugins workspace to review and restart them.',
      // Derived entries have no single moment of occurrence — the plugin store
      // holds membership, not timestamps — so the panel renders them without an
      // age and this stays the empty string rather than a fabricated "now".
      at: '',
    })
  }
  items.push(...pushed)

  const unreadPluginErrors = pluginErrorCount > acknowledgedPluginErrorCount ? 1 : 0
  const unreadPushed = pushed.filter((item) => !acknowledged.has(item.id)).length

  return { items, unreadCount: unreadPluginErrors + unreadPushed }
}

function emit(): void {
  snapshot = buildSnapshot()
  for (const listener of listeners) listener()
}

// Derived source: mirror the live plugin-health count into this store. Module
// scope on purpose — the subscription must survive the header unmounting during
// a workspace change, or the bell would reset every navigation.
subscribePluginIssues(() => {
  const next = getPluginsInErrorCount()
  if (next === pluginErrorCount) return
  pluginErrorCount = next
  // A count that drops below what the user already acknowledged means the
  // condition partly cleared; re-arm so a NEW failure counts as unread again.
  if (next < acknowledgedPluginErrorCount) acknowledgedPluginErrorCount = next
  emit()
})

export function subscribeAdminNotifications(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getAdminNotifications(): NotificationsSnapshot {
  return snapshot
}

export function pushAdminNotification(
  input: Omit<AdminNotification, 'id' | 'at'> & { id?: string },
): void {
  const id = input.id ?? `n-${Date.now()}-${pushed.length}`
  pushed = [
    { id, kind: input.kind, title: input.title, body: input.body, at: new Date().toISOString() },
    ...pushed.filter((item) => item.id !== id),
  ].slice(0, MAX_RETAINED)
  acknowledged.delete(id)
  emit()
}

/** Mark everything currently listed as seen. Called when the panel opens. */
export function markAdminNotificationsRead(): void {
  acknowledged = new Set(pushed.map((item) => item.id))
  acknowledgedPluginErrorCount = pluginErrorCount
  emit()
}

export function clearAdminNotifications(): void {
  pushed = []
  acknowledged = new Set()
  acknowledgedPluginErrorCount = pluginErrorCount
  emit()
}
