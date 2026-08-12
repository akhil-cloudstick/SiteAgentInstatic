/**
 * useAdminSectionDestinations — the CMS's row-2 destinations, as data.
 *
 * Row 2 itself is `MmsSpecialistRow` in `@mms/shell`, shared verbatim with MMS
 * Design: it owns the tab chrome (metrics, underline, hover ink, active weight,
 * 44px targets) so the two products' navigations cannot drift. What each
 * product owns is WHICH destinations exist, resolved behind its own capability
 * gates — that is this hook.
 *
 * It used to render the tabs itself. Returning data instead is what let the
 * chrome move into the shared package without the shared package learning what
 * a page tree or a media asset is.
 *
 * The destinations are fixed by the shared-header contract: Dashboard, Site,
 * Content, Data, Media, Plugins, Users, plus any plugin-contributed admin
 * pages. AI settings are reachable from Settings and by direct URL; adding
 * another first-party link here would put this row out of step with the other
 * products' specialist rows.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ShellDestination } from '@mms/shell'
import { listCmsPlugins } from '@core/persistence/cmsPlugins'
import type { CmsCurrentUser } from '@core/persistence'
import type { PluginAdminPageRoute } from '@core/plugin-sdk'
import { useAdminNavigate } from '@admin/lib/useAdminNavigate'
import { useCurrentAdminUser } from '@admin/sessionContext'
import { canAccessWorkspace } from '@admin/access'
import {
  getPluginsInErrorCount,
  subscribePluginIssues,
} from '@admin/pages/plugins/utils/pluginIssuesStore'
import { CMS_PLUGINS_CHANGED_EVENT } from '@admin/pages/plugins/utils/pluginEvents'
import type { AdminWorkspace } from '@admin/workspace'

// Session-scoped cache of the plugin admin pages list. Without it the nav
// re-fetched (and briefly emptied) every time the consumer re-mounted —
// typical case: navigating between admin layout families unmounts the previous
// Toolbar, which drops this state and reseeds from `[]` while the next fetch
// lands. Caching at module scope means the existing pages render immediately on
// remount; the CMS_PLUGINS_CHANGED_EVENT path still refreshes when plugins
// genuinely change.
let cachedPluginPages: PluginAdminPageRoute[] = []
const cachedPluginPagesListeners = new Set<() => void>()
function setCachedPluginPages(next: PluginAdminPageRoute[]): void {
  const unchanged =
    cachedPluginPages.length === next.length &&
    cachedPluginPages.every((page, index) => page.route === next[index]?.route)
  if (unchanged) return
  cachedPluginPages = next
  for (const listener of cachedPluginPagesListeners) listener()
}

interface AdminSectionDestinationsOptions {
  section: AdminWorkspace
  currentUser?: CmsCurrentUser | null
  onWorkspaceNavigateStart?: () => unknown
}

/** First-party destinations, in the order the contract fixes them. */
const FIRST_PARTY: Array<{ id: AdminWorkspace; label: string; icon: string; to: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: 'table-cells-large', to: '/cms/dashboard' },
  { id: 'site', label: 'Site', icon: 'window-maximize', to: '/cms/site' },
  { id: 'content', label: 'Content', icon: 'file-lines', to: '/cms/content' },
  { id: 'data', label: 'Data', icon: 'database', to: '/cms/data' },
  { id: 'media', label: 'Media', icon: 'image', to: '/cms/media' },
  { id: 'plugins', label: 'Plugins', icon: 'cube', to: '/cms/plugins' },
  { id: 'users', label: 'Users', icon: 'user', to: '/cms/users' },
]

export function useAdminSectionDestinations({
  section,
  currentUser,
  onWorkspaceNavigateStart,
}: AdminSectionDestinationsOptions): ShellDestination[] {
  // Hydrate from the session cache so the nav doesn't flash empty on remount.
  const [pluginPages, setPluginPages] = useState<PluginAdminPageRoute[]>(() => cachedPluginPages)
  const sessionUser = useCurrentAdminUser()
  const navigate = useAdminNavigate()
  const effectiveUser = currentUser ?? sessionUser ?? null
  const unrestricted = !effectiveUser
  const canAccess = (workspace: AdminWorkspace) =>
    unrestricted || canAccessWorkspace(effectiveUser, workspace)
  const canAccessPlugins = canAccess('plugins')

  const pluginIssues = useSyncExternalStore(
    subscribePluginIssues,
    getPluginsInErrorCount,
    getPluginsInErrorCount,
  )

  useEffect(() => {
    let cancelled = false

    // Subscribe to the module-level cache so other mounts (or the
    // CMS_PLUGINS_CHANGED refresh below) update every visible navigation in
    // lockstep.
    function onCacheChange(): void {
      if (!cancelled) setPluginPages(cachedPluginPages)
    }
    cachedPluginPagesListeners.add(onCacheChange)

    async function loadPluginPages() {
      if (!canAccessPlugins) {
        setCachedPluginPages([])
        return
      }
      try {
        const payload = await listCmsPlugins()
        if (!cancelled) setCachedPluginPages(payload.adminPages)
      } catch {
        // Navigation remains usable when plugins cannot be loaded.
      }
    }

    function refreshPluginPages() {
      void loadPluginPages()
    }

    // Only fetch when the cache is empty (first session mount or after a
    // sign-out clear) or on CMS_PLUGINS_CHANGED. Subsequent navigations hit the
    // cached list instantly.
    if (cachedPluginPages.length === 0) refreshPluginPages()
    window.addEventListener(CMS_PLUGINS_CHANGED_EVENT, refreshPluginPages)
    return () => {
      cancelled = true
      cachedPluginPagesListeners.delete(onCacheChange)
      window.removeEventListener(CMS_PLUGINS_CHANGED_EVENT, refreshPluginPages)
    }
  }, [canAccessPlugins])

  async function select(to: string): Promise<void> {
    try {
      const result = onWorkspaceNavigateStart?.()
      if (isPromiseLike(result)) await result
      navigate(to)
    } catch (err) {
      console.error('[AdminSectionNavigation] Navigation start hook failed:', err)
    }
  }

  const destinations: ShellDestination[] = []

  for (const item of FIRST_PARTY) {
    if (!canAccess(item.id)) continue
    destinations.push({
      id: item.id,
      label: item.label,
      icon: item.icon,
      href: item.to,
      active: section === item.id,
      // A red dot beside Plugins whenever any plugin is in `error` lifecycle
      // state, fed by the live SSE-driven store so it lights up the moment a
      // plugin's worker exhausts its crash budget — even from another page.
      badgeLabel:
        item.id === 'plugins' && pluginIssues > 0
          ? `${pluginIssues} plugin${pluginIssues === 1 ? '' : 's'} in error state`
          : undefined,
      onSelect: () => void select(item.to),
    })
  }

  if (canAccessPlugins) {
    for (const page of pluginPages) {
      destinations.push({
        id: `${page.pluginId}:${page.id}`,
        label: page.navLabel ?? page.title,
        icon: 'cube',
        href: page.route,
        active: false,
        onSelect: () => void select(page.route),
      })
    }
  }

  return destinations
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (typeof value !== 'object' || value === null) return false
  if (!('then' in value)) return false
  return typeof (value as { then: unknown }).then === 'function'
}
