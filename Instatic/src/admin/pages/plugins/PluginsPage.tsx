import { useEffect, useRef } from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { Input } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { AdminPageLayout } from '@admin/layouts/AdminPageLayout'
import { PluginCard } from './components/PluginCard/PluginCard'
import { PluginRemoveDialog } from './components/PluginRemoveDialog/PluginRemoveDialog'
import { PluginInstallReview } from './components/PluginInstallReview'
import { PluginRecoveryView } from './components/PluginRecoveryView'
import { PluginSettingsDialog } from './components/PluginSettingsDialog/PluginSettingsDialog'
import { PluginSchedulesDialog } from './components/PluginSchedulesDialog/PluginSchedulesDialog'
import {
  isSandboxRelatedError,
  usePluginsWorkspace,
  type PluginStatusFilter,
  type PluginSortOrder,
} from './hooks/usePluginsWorkspace'
import { notifyCmsPluginsChanged } from './utils/pluginEvents'
import { pluginStatus } from './utils/pluginIconography'
import { useAuthenticatedAdminUser } from '@admin/sessionContext'
import {
  canConfigurePlugins,
  canInstallPlugins,
  canManagePluginLifecycle,
} from '@admin/access'
import styles from './PluginsPage.module.css'

/**
 * Skeleton cards rendered while the plugins payload is in flight. Two fills the
 * approved screen's first grid row; `PluginCard`'s `loading` branch owns the
 * markup, so page-level code only decides the count.
 */
const SKELETON_CARD_COUNT = 2

const STATUS_OPTIONS: Array<{ value: PluginStatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'error', label: 'Error' },
]

const SORT_OPTIONS: Array<{ value: PluginSortOrder; label: string }> = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'name', label: 'Name' },
  { value: 'status', label: 'Status' },
]

export function PluginsPage() {
  const currentUser = useAuthenticatedAdminUser()
  const canConfigure = canConfigurePlugins(currentUser)
  const canInstall = canInstallPlugins(currentUser)
  const canManageLifecycle = canManagePluginLifecycle(currentUser)
  const vm = usePluginsWorkspace()
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Destructured up front, not read as `vm.x` in the markup below: the view
  // model carries `fileInputRef`, which makes every property access on `vm`
  // during render a ref read as far as `react-hooks/refs` is concerned. The
  // ref itself is only ever touched inside event handlers.
  const {
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
  } = vm

  // Switching view swaps the entire page. Without resetting the scroller the
  // operator lands halfway down a screen they have never seen — the reference
  // calls `window.scrollTo(0, 0)` on every transition; here the scroll
  // container is the layout body, so we walk up to it.
  useEffect(() => {
    bodyRef.current?.closest('[data-page-mode]')?.scrollTo({ top: 0 })
  }, [view])

  const errorBanner = error && (
    <div role="alert">
      <p className={styles.error}>{error}</p>
      {isSandboxRelatedError(error) && (
        <p className={styles.errorHint}>
          This looks like a plugin sandbox issue — some capabilities are
          restricted inside plugin code.
        </p>
      )}
    </div>
  )

  return (
    <AdminPageLayout workspace="plugins" mode="plugins">
      <div
        ref={bodyRef}
        className={styles.pluginsBody}
        data-editor-screen="plugins"
        data-testid="plugins-admin-canvas"
      >
        {/* Mounted for every view: the recovery screen's "Reinstall package"
            and the empty state's CTA both open this same picker. */}
        {canInstall && (
          <input
            ref={fileInputRef}
            className={styles.fileInput}
            aria-label="Plugin file"
            type="file"
            accept="application/json,.json,.plugin.json,.pbplugin,.zip,application/zip"
            onChange={(event) => void vm.handleUpload(event)}
          />
        )}

        {view === 'review' && pendingInstall && (
          <PluginInstallReview
            pending={pendingInstall}
            uploading={uploading}
            canInstall={canInstall}
            error={errorBanner}
            onCancel={() => {
              vm.setPendingInstall(null)
              vm.goToInstalled()
            }}
            onApprove={() => void vm.installPendingPlugin(pendingInstall!)}
          />
        )}

        {view === 'recovery' && recoveryPlugin && (
          <PluginRecoveryView
            plugin={recoveryPlugin}
            section={recoverySection}
            onSectionChange={vm.setRecoverySection}
            siblingCount={payload.plugins.length}
            liveConnected={liveConnected}
            busy={busyPluginId === recoveryPlugin.id}
            editorActivationError={editorActivationErrors[recoveryPlugin.id]}
            stagedPackage={recoveryStagedPackage}
            canConfigure={canConfigure}
            canInstall={canInstall}
            canManageLifecycle={canManageLifecycle}
            error={errorBanner}
            onBack={vm.goToInstalled}
            onRestart={() => void vm.restartPlugin(recoveryPlugin!)}
            onToggle={() => void vm.togglePlugin(recoveryPlugin!)}
            onReinstall={() => fileInputRef.current?.click()}
            onReviewStaged={(staged) => vm.reviewStagedPackage(staged)}
            onDiscardStaged={() => void vm.discardStagedPackage(recoveryPlugin!.id)}
            onOpenSettings={() => vm.setSettingsPluginId(recoveryPlugin!.id)}
            onOpenSchedules={() => vm.setSchedulesPluginId(recoveryPlugin!.id)}
            onRemove={() => vm.setPendingRemove({ plugin: recoveryPlugin!, force: false })}
          />
        )}

        {/* The recovery view can outlive its plugin for one render — an SSE
            refresh that removes the row lands before the effect that navigates
            away. Fall back to the control room instead of a blank screen. */}
        {(view === 'installed'
          || (view === 'recovery' && !recoveryPlugin)
          || (view === 'review' && !pendingInstall)) && (
          <div className={styles.wrap}>
            <section className={styles.pageHeading}>
              <div className={styles.headingText}>
                <p className={styles.eyebrow}>Extensions</p>
                <h1 id="plugins-title">Plugins</h1>
                <p className={styles.pageLead}>Extensions running on this website</p>
              </div>
              {canInstall && (
                <Button
                  variant="primary"
                  size="lg"
                  className={styles.uploadButton}
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Upload plugin package"
                >
                  <FaIcon name="arrow-up-from-bracket" size={14} />
                  <span>{uploading ? 'Opening package' : 'Upload plugin package'}</span>
                </Button>
              )}
            </section>

            <dl className={styles.metrics} aria-label="Plugin status summary">
              <PluginMetric
                icon="cube"
                value={payload.plugins.length}
                label="installed"
                detail="Total plugins installed"
                tone="green"
              />
              <PluginMetric
                icon="circle-check"
                value={payload.plugins.filter((p) => pluginStatus(p).status === 'active').length}
                label="active"
                detail="Plugins currently running"
                tone="green"
              />
              <PluginMetric
                icon="triangle-exclamation"
                value={payload.plugins.filter((p) => pluginStatus(p).status === 'error').length}
                label="needs attention"
                detail="Requires your review"
                tone="amber"
              />
              <PluginMetric
                icon="arrows-rotate"
                value={liveConnected ? 'Live' : 'Offline'}
                label="status"
                detail={
                  liveConnected
                    ? 'Lifecycle events connected'
                    : 'Lifecycle events disconnected'
                }
                tone="blue"
              />
            </dl>

            <div className={styles.trustBanner}>
              <FaIcon name="shield-halved" size={18} />
              <span>
                Plugins can add CMS, editor and publishing features. Install only
                trusted packages.
              </span>
            </div>

            {(errorBanner || removeFailure) && (
              <div className={styles.alerts}>
                {errorBanner}
                {removeFailure && (
                  <div role="alert" className={styles.removeFailure}>
                    <p className={styles.error}>{removeFailure.message}</p>
                    <p className={styles.errorHint}>
                      Removing anyway skips the plugin&rsquo;s cleanup code — external
                      resources it created (webhooks, third-party registrations) may
                      remain.
                    </p>
                    <div className={styles.removeFailureActions}>
                      <Button
                        variant="destructive"
                        disabled={busyPluginId === removeFailure.plugin.id}
                        onClick={() =>
                          vm.setPendingRemove({ plugin: removeFailure!.plugin, force: true })
                        }
                      >
                        <span>Remove anyway</span>
                      </Button>
                      <Button variant="secondary" onClick={() => vm.setRemoveFailure(null)}>
                        <span>Dismiss</span>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className={styles.filters}>
              <label className={styles.searchField}>
                <FaIcon name="magnifying-glass" size={13} />
                <span className={styles.srOnly}>Search installed plugins</span>
                <Input
                  value={search}
                  placeholder="Search installed plugins"
                  onChange={(event) => vm.setSearch(event.target.value)}
                />
              </label>
              <Select
                className={styles.filterSelect}
                menuClassName={styles.filterMenu}
                aria-label="Plugin status"
                value={statusFilter}
                options={STATUS_OPTIONS}
                onChange={(event) => vm.setStatusFilter(event.target.value as PluginStatusFilter)}
              />
              <Select
                className={`${styles.filterSelect} ${styles.sortSelect}`}
                menuClassName={styles.filterMenu}
                aria-label="Sort plugins"
                value={sort}
                options={SORT_OPTIONS}
                onChange={(event) => vm.setSort(event.target.value as PluginSortOrder)}
              />
            </div>

            {loading ? (
              <section className={styles.pluginGrid} aria-busy="true" aria-label="Loading plugins">
                {Array.from({ length: SKELETON_CARD_COUNT }, (_, i) => (
                  <PluginCard key={i} loading />
                ))}
              </section>
            ) : visiblePlugins.length > 0 ? (
              <section className={styles.pluginGrid} aria-label="Installed plugins">
                {visiblePlugins.map((plugin) => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    busy={busyPluginId === plugin.id}
                    editorActivationError={editorActivationErrors[plugin.id]}
                    menuOpen={openMenuPluginId === plugin.id}
                    canConfigure={canConfigure}
                    canInstall={canInstall}
                    canManageLifecycle={canManageLifecycle}
                    onToggleMenu={() =>
                      vm.setOpenMenuPluginId(openMenuPluginId === plugin.id ? null : plugin.id)
                    }
                    onOpenSettings={(p) => vm.setSettingsPluginId(p.id)}
                    onOpenSchedules={(p) => vm.setSchedulesPluginId(p.id)}
                    onInstallPack={(p) => void vm.installPluginPack(p)}
                    onRestart={(p) => void vm.restartPlugin(p)}
                    onOpenRecovery={(p) => vm.goToRecovery(p)}
                    onToggle={(p) => void vm.togglePlugin(p)}
                    onRemove={(p) => vm.setPendingRemove({ plugin: p, force: false })}
                  />
                ))}
              </section>
            ) : payload.plugins.length > 0 ? (
              <div className={styles.emptyState} role="status">
                <FaIcon name="magnifying-glass" size={30} />
                <h2>No plugins match</h2>
                <p>
                  No installed plugin matches the current search and status filter.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    vm.setSearch('')
                    vm.setStatusFilter('all')
                  }}
                >
                  <span>Clear filters</span>
                </Button>
              </div>
            ) : (
              <div className={styles.emptyState} role="status">
                <FaIcon name="plug-circle-xmark" size={30} />
                <h2>No plugins installed yet</h2>
                <p>
                  Upload a signed ZIP package to review its manifest and permissions
                  before anything is installed.
                </p>
                {canInstall && (
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FaIcon name="arrow-up-from-bracket" size={14} />
                    <span>Upload plugin package</span>
                  </Button>
                )}
              </div>
            )}

            <div className={styles.liveFooter} data-connected={liveConnected}>
              <span className={styles.liveDot} />
              <FaIcon name="clock" size={12} />
              <span className={styles.liveFooterText}>
                {liveConnected
                  ? 'Live lifecycle updates connected'
                  : 'Lifecycle event stream disconnected'}
              </span>
              <small className={styles.liveFooterCount}>
                {payload.plugins.length} installed ·{' '}
                {payload.plugins.filter((p) => pluginStatus(p).status === 'error').length}{' '}
                recent issue
                {payload.plugins.filter((p) => pluginStatus(p).status === 'error').length === 1
                  ? ''
                  : 's'}
              </small>
            </div>
          </div>
        )}

        {!canManageLifecycle && (
          <div className={styles.roleBanner} role="status">
            <FaIcon name="lock" size={14} />
            <span>
              <strong>Read-only role</strong> You can review installed plugins, but
              lifecycle and package actions require the corresponding Plugins
              capability.
            </span>
          </div>
        )}

        {settingsPluginId && (
          <PluginSettingsDialog
            pluginId={settingsPluginId}
            pluginName={
              payload.plugins.find((p) => p.id === settingsPluginId)?.name ??
              settingsPluginId
            }
            onClose={() => vm.setSettingsPluginId(null)}
            onSaved={() => {
              notifyCmsPluginsChanged()
              void vm.loadPlugins()
            }}
          />
        )}

        {schedulesPluginId && (
          <PluginSchedulesDialog
            pluginId={schedulesPluginId}
            pluginName={
              payload.plugins.find((p) => p.id === schedulesPluginId)?.name ??
              schedulesPluginId
            }
            canManageLifecycle={canManageLifecycle}
            onClose={() => vm.setSchedulesPluginId(null)}
          />
        )}

        {pendingRemove && (
          <PluginRemoveDialog
            plugin={pendingRemove.plugin}
            force={pendingRemove.force}
            busy={busyPluginId === pendingRemove.plugin.id}
            onClose={() => vm.setPendingRemove(null)}
            onConfirm={async () => {
              const target = pendingRemove
              if (!target) return
              vm.setPendingRemove(null)
              await vm.executeRemovePlugin(target.plugin, target.force)
            }}
          />
        )}
      </div>
    </AdminPageLayout>
  )
}

function PluginMetric({
  icon,
  value,
  label,
  detail,
  tone,
}: {
  icon: string
  value: number | string
  label: string
  detail: string
  tone: 'green' | 'amber' | 'blue'
}) {
  return (
    <div className={styles.metric} data-tone={tone}>
      <span className={styles.metricDisc}>
        <FaIcon name={icon} size={28} />
      </span>
      <div className={styles.metricBody}>
        <dt className={styles.metricValueRow}>
          <strong className={styles.metricValue}>{value}</strong>
          <b className={styles.metricLabel}>{label}</b>
        </dt>
        <dd className={styles.metricDetail}>{detail}</dd>
      </div>
    </div>
  )
}
