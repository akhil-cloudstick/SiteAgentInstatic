import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, RefObject } from 'react'
import { consumePendingAction } from '@admin/spotlight/pendingAction'
import { StepUpCancelledMessage, useStepUp } from '@admin/shared/StepUp'
import {
  discardCmsPluginStagedPackage,
  inspectCmsPluginPackage,
  installCmsPluginManifest,
  installCmsPluginPack,
  installCmsPluginPackage,
  listCmsPlugins,
  removeCmsPlugin,
  restartCmsPlugin,
  setCmsPluginEnabled,
  stageCmsPluginPackage,
} from '@core/persistence'
import {
  collectEnabledAdminPages,
  parsePluginManifest,
} from '@core/plugins/manifest'
import type {
  CmsPluginsPayload,
  InstalledPlugin,
  PluginManifest,
  PluginPermission,
  StagedPluginPackage,
} from '@core/plugin-sdk'
import { requestCmsSiteReload } from '@admin/state/adminEvents'
import type { WorkspaceLoadState } from '@admin/lib/workspaceLoadState'
import {
  getEditorActivationErrors,
  subscribeEditorActivationErrors,
} from './editorPluginActivationErrors'
import { notifyCmsPluginsChanged } from '../utils/pluginEvents'
import {
  getPluginStreamConnected,
  subscribePluginEvents,
  subscribePluginStreamStatus,
} from '../utils/pluginEventStream'
import { pluginStatus, type PluginStatus } from '../utils/pluginIconography'
import { getErrorMessage } from '@core/utils/errorMessage'
import { ApiError } from '@core/http'
import { pushToast } from '@ui/components/Toast'

/**
 * Per-install state for the confirmation dialog. The dialog renders different
 * copy for upgrade vs. fresh install and highlights NEW permissions against
 * `previouslyGrantedPermissions`. Lives on the workspace hook because the
 * dialog is conceptually a sub-step of the install action.
 */
interface PendingInstall {
  manifest: PluginManifest
  file?: File
  /**
   * If set, this upload upgrades an already-installed plugin from the given
   * version to `manifest.version`. The dialog switches to upgrade-aware copy
   * ("Update X from 1.0.0 to 1.1.0") and the confirm button reflects the verb.
   */
  upgradeFromVersion?: string
  /**
   * Permissions the user previously granted to the existing install. Used by
   * the dialog to compute the diff against the new manifest's requested
   * permissions and prominently highlight any new ones.
   */
  previouslyGrantedPermissions?: PluginPermission[]
  /**
   * `networkAllowedHosts` from the manifest of the existing install (when
   * this is an upgrade). The dialog diffs it against the new manifest's
   * value so an upgrade adding new external hosts shows them as "New".
   */
  previousNetworkAllowedHosts?: string[]
}

/**
 * Confirmation-dialog state for plugin removal. `force: true` means the
 * server will skip the plugin's lifecycle hooks — offered only after a
 * normal uninstall failed on a hook error.
 */
interface PendingRemove {
  plugin: InstalledPlugin
  force: boolean
}

/**
 * A normal uninstall that failed because a lifecycle hook (`deactivate` /
 * `uninstall`) threw or the entry file could not load. Rendered as an alert
 * with a "Remove anyway" action that re-runs the removal with `force: true`.
 */
interface RemoveFailure {
  plugin: InstalledPlugin
  message: string
}

/**
 * Which of the workspace's three views is on screen. The approved screen is a
 * single page with three states, not three routes — and it must stay that way
 * here: `/cms/plugins/:pluginId/:pageId` is already taken by plugin-authored
 * admin pages, so a `/cms/plugins/recovery/:id` route would be parsed as
 * pluginId="recovery".
 */
export type PluginsView = 'installed' | 'review' | 'recovery'

/** Sections of the recovery view's left-hand nav. */
export type RecoverySection = 'overview' | 'issues' | 'schedules' | 'settings'

/** Status filter values in the control-room toolbar. */
export type PluginStatusFilter = 'all' | PluginStatus

/** Sort options in the control-room toolbar. */
export type PluginSortOrder = 'recent' | 'name' | 'status'

/**
 * Mirror the active view into the URL so a recovery screen can be linked to and
 * survives a reload. `replaceState` rather than the admin router: the router
 * owns pathname routing, and pushing history entries for an in-page state
 * change would make Back walk through view switches instead of leaving the
 * workspace — which is what the reference does too.
 */
function syncViewQuery(view: PluginsView, pluginId: string | null): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (view === 'installed') {
    url.searchParams.delete('view')
    url.searchParams.delete('plugin')
  } else {
    url.searchParams.set('view', view)
    if (pluginId) url.searchParams.set('plugin', pluginId)
    else url.searchParams.delete('plugin')
  }
  window.history.replaceState({}, '', url)
}

function readViewQuery(): { view: PluginsView; pluginId: string | null } {
  if (typeof window === 'undefined') return { view: 'installed', pluginId: null }
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('view')
  // `review` is deliberately NOT restorable from the URL: a review screen with
  // no in-memory package would render an empty shell and invite the operator to
  // approve nothing. Recovery restores fine — it reads from the plugin list.
  const view: PluginsView = raw === 'recovery' ? 'recovery' : 'installed'
  return { view, pluginId: params.get('plugin') }
}

/**
 * Read-only view-model returned to `PluginsPage`. Splits state, mutators that
 * drive dialogs, and async actions so the render component stays declarative.
 */
interface PluginsWorkspaceVM extends WorkspaceLoadState {
  fileInputRef: RefObject<HTMLInputElement | null>
  payload: CmsPluginsPayload
  uploading: boolean
  busyPluginId: string | null
  editorActivationErrors: Record<string, string>
  pendingInstall: PendingInstall | null
  settingsPluginId: string | null
  schedulesPluginId: string | null
  pendingRemove: PendingRemove | null
  removeFailure: RemoveFailure | null

  // Which view is on screen, and the plugin the recovery view is about.
  view: PluginsView
  recoveryPlugin: InstalledPlugin | null
  recoverySection: RecoverySection

  // Control-room toolbar state + the list it produces.
  search: string
  statusFilter: PluginStatusFilter
  sort: PluginSortOrder
  visiblePlugins: InstalledPlugin[]

  /** Which card's kebab menu is open. At most one at a time. */
  openMenuPluginId: string | null

  /** Whether the lifecycle SSE stream is currently connected. */
  liveConnected: boolean

  /** The package waiting for approval on the recovery view's plugin, if any. */
  recoveryStagedPackage: StagedPluginPackage | null
  reviewStagedPackage: (staged: StagedPluginPackage) => void
  discardStagedPackage: (pluginId: string) => Promise<void>

  // Dialog open / close mutators.
  setPendingInstall: (value: PendingInstall | null) => void
  setSettingsPluginId: (value: string | null) => void
  setSchedulesPluginId: (value: string | null) => void
  setPendingRemove: (value: PendingRemove | null) => void
  setRemoveFailure: (value: RemoveFailure | null) => void

  // View + toolbar mutators.
  goToInstalled: () => void
  goToRecovery: (plugin: InstalledPlugin) => void
  setRecoverySection: (value: RecoverySection) => void
  setSearch: (value: string) => void
  setStatusFilter: (value: PluginStatusFilter) => void
  setSort: (value: PluginSortOrder) => void
  setOpenMenuPluginId: (value: string | null) => void

  // Async actions.
  loadPlugins: () => Promise<void>
  handleUpload: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  installPendingPlugin: (
    pending: PendingInstall,
    grantedPermissions?: PluginPermission[],
  ) => Promise<void>
  togglePlugin: (plugin: InstalledPlugin) => Promise<void>
  restartPlugin: (plugin: InstalledPlugin) => Promise<void>
  installPluginPack: (plugin: InstalledPlugin) => Promise<void>
  executeRemovePlugin: (plugin: InstalledPlugin, force: boolean) => Promise<void>
}

const emptyPayload: CmsPluginsPayload = { plugins: [], adminPages: [], stagedPackages: [] }

function notifyCmsSiteReload(): void {
  requestCmsSiteReload()
}

/**
 * Heuristic — does this error message look like it came from the plugin
 * sandbox layer? Used by `PluginsPage` to decide whether to attach the
 * sandbox-docs hint next to the error alert.
 */
export function isSandboxRelatedError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('sandbox') ||
    lower.includes("'node:") ||
    lower.includes('"node:') ||
    lower.includes("'bun:") ||
    lower.includes('could not load module') ||
    lower.includes('forbidden literal') ||
    lower.includes('requires permission') ||
    lower.includes('networkallowedhosts')
  )
}

function updatePluginInPayload(
  payload: CmsPluginsPayload,
  plugin: InstalledPlugin,
): CmsPluginsPayload {
  const existing = payload.plugins.findIndex(
    (candidate) => candidate.id === plugin.id,
  )
  const plugins =
    existing === -1
      ? [plugin, ...payload.plugins]
      : payload.plugins.map((candidate) =>
          candidate.id === plugin.id ? plugin : candidate,
        )
  // Staged packages are untouched by a single-plugin mutation — a lifecycle
  // action neither creates nor clears a pending upload.
  return {
    plugins,
    adminPages: collectEnabledAdminPages(plugins),
    stagedPackages: payload.stagedPackages,
  }
}

/**
 * Shape returned by the plugin-mutating endpoints. They may return either the
 * full collection (after lifecycle hooks rewrite multiple plugin rows) or a
 * single row (after a localized edit). `applyPluginResult` collapses both
 * cases into a payload update.
 */
interface PluginMutationResult {
  plugins: InstalledPlugin[]
  adminPages: CmsPluginsPayload['adminPages']
  plugin?: InstalledPlugin
}

export function usePluginsWorkspace(): PluginsWorkspaceVM {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { runStepUp } = useStepUp()

  const [payload, setPayload] = useState<CmsPluginsPayload>(emptyPayload)
  const [loading, setLoading] = useState(true)
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingInstall, setPendingInstall] = useState<PendingInstall | null>(null)
  const [settingsPluginId, setSettingsPluginId] = useState<string | null>(null)
  const [schedulesPluginId, setSchedulesPluginId] = useState<string | null>(null)
  const [pendingRemove, setPendingRemove] = useState<PendingRemove | null>(null)
  const [removeFailure, setRemoveFailure] = useState<RemoveFailure | null>(null)

  // View state. Seeded from the URL once so a recovery link survives a reload.
  const [initialQuery] = useState(readViewQuery)
  const [view, setView] = useState<PluginsView>(initialQuery.view)
  const [recoveryPluginId, setRecoveryPluginId] = useState<string | null>(initialQuery.pluginId)
  const [recoverySection, setRecoverySection] = useState<RecoverySection>('overview')

  // Control-room toolbar. `sort` defaults to 'recent', matching the reference.
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<PluginStatusFilter>('all')
  const [sort, setSort] = useState<PluginSortOrder>('recent')
  const [openMenuPluginId, setOpenMenuPluginId] = useState<string | null>(null)

  const liveConnected = useSyncExternalStore(
    subscribePluginStreamStatus,
    getPluginStreamConnected,
    getPluginStreamConnected,
  )

  // Editor-side activation failures (per pluginId → error message). Populated
  // by `useInstalledEditorPlugins` after each refresh; surfaced on the plugin
  // card alongside the server-side `lastError`.
  const editorActivationErrors = useSyncExternalStore(
    subscribeEditorActivationErrors,
    getEditorActivationErrors,
    getEditorActivationErrors,
  )

  // The plugin the recovery view is about. Resolved from the list rather than
  // held as a snapshot so the view tracks live SSE refreshes — a plugin that
  // recovers while its recovery screen is open updates in place.
  const recoveryPlugin: InstalledPlugin | null =
    payload.plugins.find((candidate) => candidate.id === recoveryPluginId) ?? null

  const recoveryStagedPackage: StagedPluginPackage | null =
    payload.stagedPackages.find((staged) => staged.pluginId === recoveryPluginId) ?? null

  // Filter → search → sort, in the reference's order. `sort === 'recent'`
  // returns 0, preserving the server's order: the reference ships it as the
  // default label-only option and we match it.
  const visiblePlugins: InstalledPlugin[] = payload.plugins
    .filter((plugin) => statusFilter === 'all' || pluginStatus(plugin).status === statusFilter)
    .filter((plugin) => {
      if (!search.trim()) return true
      const haystack = [
        plugin.name,
        plugin.manifest.description ?? '',
        plugin.manifest.author?.name ?? '',
      ].join(' ').toLowerCase()
      return haystack.includes(search.toLowerCase())
    })
    // `.filter()` already returned a fresh array, so sorting in place cannot
    // mutate `payload.plugins`.
    .sort((a, b) => {
      if (sort === 'status') return pluginStatus(a).status.localeCompare(pluginStatus(b).status)
      if (sort === 'name') return a.name.localeCompare(b.name)
      return 0
    })

  function goToInstalled(): void {
    setView('installed')
    setRecoveryPluginId(null)
    setRecoverySection('overview')
    syncViewQuery('installed', null)
  }

  function goToRecovery(plugin: InstalledPlugin): void {
    setOpenMenuPluginId(null)
    setRecoveryPluginId(plugin.id)
    setRecoverySection('overview')
    setView('recovery')
    syncViewQuery('recovery', plugin.id)
  }

  function goToReview(): void {
    setOpenMenuPluginId(null)
    setView('review')
    syncViewQuery('review', null)
  }

  function applyPluginResult(result: PluginMutationResult): void {
    if (result.plugins.length > 0) {
      setPayload((current) => ({ plugins: result.plugins, adminPages: result.adminPages, stagedPackages: current.stagedPackages }))
      return
    }
    if (result.plugin) {
      const plugin = result.plugin
      setPayload((current) => updatePluginInPayload(current, plugin))
    }
  }

  async function loadPlugins(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      setPayload(await listCmsPlugins())
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load plugins'))
    }
    setLoading(false)
  }

  /**
   * Shared per-plugin async action ladder. Every "click a button on the plugin
   * card" handler funnels through here so the busy state, step-up retry,
   * step-up cancellation, and error-surfacing behaviour stay in one place.
   */
  async function runPluginAction(
    pluginId: string,
    fn: () => Promise<PluginMutationResult>,
    fallbackError: string,
  ): Promise<void> {
    setBusyPluginId(pluginId)
    setError(null)
    try {
      applyPluginResult(await runStepUp(fn))
      notifyCmsPluginsChanged()
    } catch (err) {
      if (!(err instanceof Error && err.message === StepUpCancelledMessage)) {
        setError(getErrorMessage(err, fallbackError))
      }
    }
    setBusyPluginId(null)
  }

  async function installPendingPlugin(
    pending: PendingInstall,
    grantedPermissions?: PluginPermission[],
  ): Promise<void> {
    setUploading(true)
    setError(null)
    try {
      const pendingFile = pending.file
      const pendingManifest = pending.manifest
      const resolvedGrantedPermissions =
        grantedPermissions ?? pendingManifest.permissions
      // Installing / upgrading a plugin is a sensitive action — the server
      // requires a fresh `step_up` auth window. `runStepUp` runs the action
      // optimistically first; if the server replies `step_up_required`, it
      // pops a password-confirm dialog and retries.
      const result = await runStepUp(() =>
        pendingFile
          ? installCmsPluginPackage(pendingFile, resolvedGrantedPermissions)
          : installCmsPluginManifest(pendingManifest, resolvedGrantedPermissions),
      )
      if (result.plugins.length > 0) {
        setPayload((current) => ({ plugins: result.plugins, adminPages: result.adminPages, stagedPackages: current.stagedPackages }))
      } else if (result.plugin) {
        const plugin = result.plugin
        setPayload((current) => updatePluginInPayload(current, plugin))
      } else {
        await loadPlugins()
      }
      notifyCmsPluginsChanged()
      // Auto-install path on the server may have also imported the bundled
      // pack — refresh the editor's site state so any newly imported VCs /
      // pages / classes appear immediately.
      if (
        pending.manifest.pack &&
        resolvedGrantedPermissions.includes('visualComponents.register')
      ) {
        notifyCmsSiteReload()
      }
      setPendingInstall(null)
      // The review screen has served its purpose — return to the control room
      // so the operator lands on the card they just created.
      goToInstalled()
    } catch (err) {
      // User dismissed the step-up dialog — treat as no-op, not an error.
      if (!(err instanceof Error && err.message === StepUpCancelledMessage)) {
        setError(getErrorMessage(err, 'Could not install plugin'))
      }
    }
    setUploading(false)
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    setUploading(true)
    setError(null)
    try {
      const isZip = file.name.toLowerCase().endsWith('.zip')
      const manifest = isZip
        ? await inspectCmsPluginPackage(file)
        : parsePluginManifest(JSON.parse(await file.text()))

      // Detect upgrade vs. fresh install client-side so we can render the
      // right copy in the confirmation dialog. The server detects upgrades
      // independently — this is purely a UX hint.
      const existing = payload.plugins.find((p) => p.id === manifest.id)
      const upgradeFromVersion =
        existing && existing.version !== manifest.version ? existing.version : undefined
      const previouslyGrantedPermissions = existing
        ? existing.grantedPermissions
        : undefined
      const previousNetworkAllowedHosts = existing?.manifest.networkAllowedHosts

      // EVERY install and upgrade goes through the review dialog — including
      // a zero-permission declarative plugin, which renders "No permissions
      // requested" so the operator consciously approves what lands in their
      // CMS. Nothing installs silently.
      setPendingInstall({
        manifest,
        file: isZip ? file : undefined,
        upgradeFromVersion,
        previouslyGrantedPermissions,
        ...(previousNetworkAllowedHosts !== undefined
          ? { previousNetworkAllowedHosts }
          : {}),
      })
      // Park the package on the host so the pending decision survives a
      // refresh and is visible to whoever holds the capability to approve it.
      // Only ZIPs are staged: a bare manifest carries no bytes to store, and
      // re-picking the file is trivial. A staging failure must not block the
      // review — the in-memory package still works for this session.
      if (isZip) {
        try {
          await stageCmsPluginPackage(manifest.id, file)
        } catch (err) {
          console.error('[plugins] could not stage uploaded package:', err)
        }
      }

      // A package that opened cleanly takes over the whole screen — the
      // reference makes review a destination, not a banner above the list, so
      // approving is a deliberate act rather than an afterthought.
      goToReview()
    } catch (err) {
      setError(getErrorMessage(err, 'Could not install plugin'))
    }
    setUploading(false)
  }

  /**
   * Re-open the review screen for a package that was staged earlier — possibly
   * in another session, by another operator. The bytes stay on the host; only
   * the manifest is needed to render the review, and approval re-uploads
   * through the normal install path.
   */
  function reviewStagedPackage(staged: StagedPluginPackage): void {
    const existing = payload.plugins.find((p) => p.id === staged.pluginId)
    setPendingInstall({
      manifest: staged.manifest,
      ...(staged.fromVersion && staged.fromVersion !== staged.manifest.version
        ? { upgradeFromVersion: staged.fromVersion }
        : {}),
      ...(existing ? { previouslyGrantedPermissions: existing.grantedPermissions } : {}),
      ...(existing?.manifest.networkAllowedHosts !== undefined
        ? { previousNetworkAllowedHosts: existing.manifest.networkAllowedHosts }
        : {}),
    })
    goToReview()
  }

  async function discardStagedPackage(pluginId: string): Promise<void> {
    setError(null)
    try {
      await discardCmsPluginStagedPackage(pluginId)
      setPayload((current) => ({
        ...current,
        stagedPackages: current.stagedPackages.filter((s) => s.pluginId !== pluginId),
      }))
    } catch (err) {
      setError(getErrorMessage(err, 'Could not discard the staged package'))
    }
  }

  async function togglePlugin(plugin: InstalledPlugin): Promise<void> {
    await runPluginAction(
      plugin.id,
      () => setCmsPluginEnabled(plugin.id, !plugin.enabled),
      'Could not update plugin',
    )
  }

  /**
   * Manually restart a plugin parked in `error` state. Resets the host's
   * crash budget for this plugin, clears its historical crash events, then
   * re-loads + re-activates. Used from the "Restart" button on the plugin
   * card.
   */
  async function restartPlugin(plugin: InstalledPlugin): Promise<void> {
    await runPluginAction(
      plugin.id,
      () => restartCmsPlugin(plugin.id),
      'Could not restart plugin',
    )
    // A restart is the whole point of the recovery screen. Once it has run,
    // that screen has nothing left to say — go back to the list, as the
    // reference does.
    if (view === 'recovery' && recoveryPluginId === plugin.id) goToInstalled()
  }

  async function installPluginPack(plugin: InstalledPlugin): Promise<void> {
    setBusyPluginId(plugin.id)
    setError(null)
    try {
      const summary = await runStepUp(() => installCmsPluginPack(plugin.id))
      const installedCount =
        summary.installed.visualComponents.length +
        summary.installed.pages.length +
        summary.installed.classes.length +
        summary.installed.layouts.length
      const replacedCount =
        summary.replaced.visualComponents.length +
        summary.replaced.pages.length +
        summary.replaced.classes.length +
        summary.replaced.layouts.length
      pushToast({
        kind: 'success',
        title: `Installed pack from ${plugin.name}`,
        body: `${installedCount} item(s) installed, ${replacedCount} replaced.`,
        location: 'plugins:install-pack',
      })
      notifyCmsPluginsChanged()
      // The pack writes Visual Components, pages, classes, and layouts
      // directly to the draft site at the DB level. Tell the editor's persistence layer to
      // re-pull so the new content shows up in the Site Explorer / canvas
      // without a full browser reload.
      notifyCmsSiteReload()
    } catch (err) {
      if (!(err instanceof Error && err.message === StepUpCancelledMessage)) {
        setError(getErrorMessage(err, 'Could not install plugin pack'))
      }
    }
    setBusyPluginId(null)
  }

  async function executeRemovePlugin(plugin: InstalledPlugin, force: boolean): Promise<void> {
    setBusyPluginId(plugin.id)
    setError(null)
    setRemoveFailure(null)
    try {
      await runStepUp(() => removeCmsPlugin(plugin.id, force))
      setPayload((current) => ({
        plugins: current.plugins.filter((candidate) => candidate.id !== plugin.id),
        adminPages: current.adminPages.filter((page) => page.pluginId !== plugin.id),
        // The server sweeps the staged row as part of the uninstall; mirror it
        // locally so a removed plugin can't leave an orphaned "update waiting".
        stagedPackages: current.stagedPackages.filter(
          (staged) => staged.pluginId !== plugin.id,
        ),
      }))
      notifyCmsPluginsChanged()
      // A recovery screen for a plugin that no longer exists would render an
      // empty shell — leave it the moment the removal lands.
      if (view === 'recovery' && recoveryPluginId === plugin.id) goToInstalled()
    } catch (err) {
      if (!(err instanceof Error && err.message === StepUpCancelledMessage)) {
        const message = getErrorMessage(err, 'Could not remove plugin')
        // A 400 from the DELETE endpoint means a lifecycle hook
        // (`deactivate` / `uninstall`) threw, or the entry file could not
        // load — the one failure class where the server offers the
        // force-remove escape hatch. Surface it as a removal failure with
        // a "Remove anyway" action instead of a dead-end error.
        if (!force && err instanceof ApiError && err.status === 400) {
          setRemoveFailure({ plugin, message })
        } else {
          setError(message)
        }
        // The DELETE flow mutates several server-side things before it can
        // fail (lifecycle status, worker state). Re-fetch the canonical list
        // so the card reflects reality regardless of the failure mode.
        await loadPlugins()
      }
    }
    setBusyPluginId(null)
  }

  // Auto-open the file picker when the spotlight queued a `plugins.install`
  // action from another workspace. Defer to the next tick so the input ref
  // is mounted before we trigger .click() on it.
  useEffect(() => {
    const pending = consumePendingAction('plugins.install')
    if (!pending) return
    const id = setTimeout(() => fileInputRef.current?.click(), 0)
    return () => clearTimeout(id)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPlugins()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  // Live refresh — when ANY plugin event arrives (crash, recovered, parked,
  // restarted, installed, updated, uninstalled, enabled, disabled), re-fetch
  // the list so the user sees the latest state without leaving the page. The
  // EventSource is shared across consumers (PluginsNavBadge, toast bridge)
  // so we don't open one socket per subscriber.
  useEffect(() => {
    const unsubscribe = subscribePluginEvents(() => {
      void loadPlugins()
    })
    return unsubscribe
  }, [])

  return {
    fileInputRef,
    payload,
    loading,
    uploading,
    busyPluginId,
    error,
    editorActivationErrors,
    pendingInstall,
    settingsPluginId,
    schedulesPluginId,
    pendingRemove,
    removeFailure,
    view,
    recoveryPlugin,
    recoverySection,
    search,
    statusFilter,
    sort,
    visiblePlugins,
    openMenuPluginId,
    liveConnected,
    recoveryStagedPackage,
    reviewStagedPackage,
    discardStagedPackage,
    setPendingInstall,
    setSettingsPluginId,
    setSchedulesPluginId,
    setPendingRemove,
    setRemoveFailure,
    goToInstalled,
    goToRecovery,
    setRecoverySection,
    setSearch,
    setStatusFilter,
    setSort,
    setOpenMenuPluginId,
    loadPlugins,
    handleUpload,
    installPendingPlugin,
    togglePlugin,
    restartPlugin,
    installPluginPack,
    executeRemovePlugin,
  }
}
