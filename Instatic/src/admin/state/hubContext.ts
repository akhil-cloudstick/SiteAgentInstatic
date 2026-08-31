/**
 * useHubContext — the Product Hub scope this session was opened with.
 *
 * One fetch per session, shared across every mount via a module-level cache
 * and a `useSyncExternalStore` subscription. The Product Hub header row is
 * mounted by all three admin layouts, and navigating between layout families
 * unmounts and remounts it; without the cache the header would re-fetch (and
 * briefly lose its Hub navigation) on every workspace change. Same pattern the
 * plugin-pages cache in `AdminSectionNavigation` uses.
 *
 * `null` is a legitimate, terminal answer — a self-hosted install has no Hub in
 * front of it. The shared-header contract forbids substituting a default
 * client, project, or Hub destination, so a failed or empty fetch leaves the
 * header in its no-Hub shape rather than guessing.
 *
 * Deliberately free of any `@site/store` import: this hook is consumed by
 * AdminPageLayout, whose bundle contract keeps the ~165 KB editor store out of
 * non-editor pages.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { fetchCmsHubContext } from '@core/persistence/cmsHubContext'
import type { HubContext } from '@core/hubContext'

type HubContextSnapshot = HubContext | null

let cachedHubContext: HubContextSnapshot = null
let inFlight: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): HubContextSnapshot {
  return cachedHubContext
}

/**
 * The cached scope for callers that are not components — Spotlight commands run
 * from a callback, not a render, so they cannot use the hook.
 *
 * Deliberately does not trigger the fetch: anything reaching for this runs long
 * after the header mounted and armed it. `null` means "no Hub" exactly as it
 * does for the hook, and callers must treat it as a terminal answer.
 */
export function readHubContext(): HubContextSnapshot {
  return cachedHubContext
}

/**
 * The store's single write path. The loader below calls it with what the server
 * returned; tests call it directly to place a session in a known Hub scope
 * without standing up a server.
 */
export function setHubContext(next: HubContextSnapshot): void {
  // Reference equality is enough to skip a no-op notify: a fresh object is only
  // produced when the server actually returned a context.
  if (next === cachedHubContext) return
  cachedHubContext = next
  emit()
}

/**
 * Drop the session cache and re-arm the one-shot fetch. Tests mount the header
 * many times in one process and must not inherit a previous case's scope.
 */
export function resetHubContext(): void {
  inFlight = null
  setHubContext(null)
}

async function loadHubContext(): Promise<void> {
  try {
    setHubContext(await fetchCmsHubContext())
  } catch (err) {
    // A hub-context read is never load-bearing — the header simply stays in its
    // no-Hub shape. Log and move on rather than toasting a failure the user
    // cannot act on.
    console.error('[hub-context] failed to load Product Hub context:', err)
  }
}

/**
 * `window.__instaticHub` is emitted by `server/static.ts` ONLY when a Product
 * Hub origin is configured. Without it there is nothing to fetch — a plain
 * self-hosted install would spend a round-trip on every admin load to be told
 * `null`. The session cookie is HttpOnly so the client cannot work this out for
 * itself; the server tells us.
 */
function runsBehindHub(): boolean {
  if (typeof window === 'undefined') return false
  return (window as unknown as { __instaticHub?: number }).__instaticHub === 1
}

export function useHubContext(): HubContextSnapshot {
  const hubContext = useSyncExternalStore(subscribe, snapshot, snapshot)

  useEffect(() => {
    if (!runsBehindHub()) return
    // One fetch per page load, shared by every concurrent mount.
    if (inFlight === null) inFlight = loadHubContext()
  }, [])

  return hubContext
}
