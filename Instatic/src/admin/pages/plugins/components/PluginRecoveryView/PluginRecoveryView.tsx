/**
 * `PluginRecoveryView` — the focused screen for a plugin the host has parked.
 *
 * A plugin that exhausts its crash budget (3 crashes in 5 minutes) stops being
 * auto-respawned and waits for an operator. This screen is that conversation:
 * what failed, when, what is still working, and the three ways out — restart,
 * disable, or replace the package.
 *
 * Every fact on it comes from the plugins payload. Nothing is inferred and
 * nothing is invented: when there is no crash history, no staged update, or no
 * schedule permission, the screen says so rather than filling the space.
 */
import type { ReactNode } from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import type { InstalledPlugin, StagedPluginPackage } from '@core/plugin-sdk'
import { useAdminUi } from '@admin/state/adminUi'
import type { RecoverySection } from '../../hooks/usePluginsWorkspace'
import {
  PLUGIN_FALLBACK_GLYPH,
  permissionShortLabel,
  pluginIconUrl,
  pluginStatus,
  pluginTone,
} from '../../utils/pluginIconography'
import styles from './PluginRecoveryView.module.css'

/**
 * The host's crash budget, documented in `docs/features/plugin-system.md` and
 * enforced in the worker pool. Stated here so the screen reports the real rule
 * rather than a number chosen to look plausible.
 */
const CRASH_THRESHOLD = 3
const CRASH_WINDOW_LABEL = '5 minutes'

interface PluginRecoveryViewProps {
  plugin: InstalledPlugin
  section: RecoverySection
  onSectionChange: (section: RecoverySection) => void
  /** Total installed plugins, for the "sibling plugins" recovery check. */
  siblingCount: number
  liveConnected: boolean
  busy: boolean
  editorActivationError?: string
  stagedPackage: StagedPluginPackage | null
  canConfigure: boolean
  canInstall: boolean
  canManageLifecycle: boolean
  error?: ReactNode
  onBack: () => void
  onRestart: () => void
  onToggle: () => void
  onReinstall: () => void
  onReviewStaged: (staged: StagedPluginPackage) => void
  onDiscardStaged: () => void
  onOpenSettings: () => void
  onOpenSchedules: () => void
  onRemove: () => void
}

function formatTime(iso: string): { time: string; date: string } {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return { time: iso, date: '' }
  return {
    time: parsed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    date: parsed.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
  }
}

export function PluginRecoveryView({
  plugin,
  section,
  onSectionChange,
  siblingCount,
  liveConnected,
  busy,
  editorActivationError,
  stagedPackage,
  canConfigure,
  canInstall,
  canManageLifecycle,
  error,
  onBack,
  onRestart,
  onToggle,
  onReinstall,
  onReviewStaged,
  onDiscardStaged,
  onOpenSettings,
  onOpenSchedules,
  onRemove,
}: PluginRecoveryViewProps) {
  // The shell already hydrates the site identity into `adminUi`; read it rather
  // than firing a second fetch from a view that only needs the name.
  const siteName = useAdminUi((s) => s.siteName)
  const status = pluginStatus(plugin)
  const tone = pluginTone(status.status)
  const iconUrl = pluginIconUrl(plugin)
  const crashes = plugin.recentCrashes ?? []
  const hasSchedules = plugin.grantedPermissions.includes('cms.schedule')
  const budgetExhausted = crashes.length >= CRASH_THRESHOLD
  const lastEvent = crashes[0] ? formatTime(crashes[0].occurredAt) : null

  const settingsCount = plugin.manifest.settings?.length ?? 0

  const navItems: Array<{
    id: RecoverySection
    label: string
    icon: string
    disabled: boolean
    title?: string
  }> = [
    { id: 'overview', label: 'Overview', icon: 'circle-info', disabled: false },
    {
      id: 'issues',
      label: `Recent issues (${crashes.length})`,
      icon: 'triangle-exclamation',
      disabled: crashes.length === 0,
      ...(crashes.length === 0 ? { title: 'No crashes have been recorded' } : {}),
    },
    {
      id: 'schedules',
      label: 'Schedules',
      icon: 'calendar',
      disabled: !hasSchedules || !canConfigure,
      ...(hasSchedules ? {} : { title: 'This plugin has no cms.schedule permission' }),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: 'gear',
      disabled: settingsCount === 0 || !canConfigure,
      ...(settingsCount === 0 ? { title: 'This plugin declares no settings' } : {}),
    },
  ]

  function selectSection(next: RecoverySection) {
    if (next === 'settings') {
      onOpenSettings()
      return
    }
    if (next === 'schedules') {
      onOpenSchedules()
      return
    }
    onSectionChange(next)
    if (next === 'issues') {
      // The crash timeline is the answer to "recent issues"; bring it into view
      // rather than making the operator hunt for it in the middle column.
      requestAnimationFrame(() => {
        document
          .querySelector(`.${styles.timeline}`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    }
  }

  return (
    <div className={styles.wrap}>
      <section className={styles.heading}>
        <div className={styles.breadcrumbs}>
          <Button variant="ghost" className={styles.breadcrumbLink} onClick={onBack}>
            <span>Plugins</span>
          </Button>
          <FaIcon name="chevron-right" size={9} />
          <span className={styles.breadcrumbCurrent}>{plugin.name}</span>
        </div>
        <div className={styles.titleRow}>
          <div className={styles.titleText}>
            <h1>Plugin recovery</h1>
            <p className={styles.titleLead}>
              Review the failure, restore service, or safely replace this plugin.
            </p>
          </div>
          <div className={styles.siteContext}>
            <FaIcon name="calendar" size={13} />
            <span>{lastEvent ? `${lastEvent.date}, ${lastEvent.time}` : 'No recorded events'}</span>
            <i className={styles.siteContextDivider} aria-hidden="true" />
            <FaIcon name="building" size={13} />
            <span>Site: {siteName ?? 'Untitled site'}</span>
          </div>
        </div>
      </section>

      {error && <div className={styles.errorSlot}>{error}</div>}

      <div className={styles.grid}>
        <aside className={styles.summary}>
          <h2>Plugin</h2>
          <div className={styles.summaryIdentity}>
            <span className={styles.summaryIcon} data-tone={tone}>
              {iconUrl ? (
                <img className={styles.summaryIconImage} src={iconUrl} alt="" loading="lazy" />
              ) : (
                <FaIcon name={PLUGIN_FALLBACK_GLYPH} size={23} />
              )}
            </span>
            <div className={styles.summaryName}>
              <strong>{plugin.name}</strong>
              <span className={styles.summaryVersion}>v{plugin.version}</span>
            </div>
          </div>
          <span className={styles.summaryStatus} data-status={status.status}>
            {status.label}
          </span>

          <dl>
            <div>
              <dt>Publisher</dt>
              <dd>{plugin.manifest.author?.name ?? 'Not declared'}</dd>
            </div>
            <div>
              <dt>Enabled</dt>
              <dd>
                <span className={styles.enabledPill} data-on={plugin.enabled}>
                  {plugin.enabled ? 'On' : 'Off'}
                </span>
              </dd>
            </div>
          </dl>

          <h3>Permissions</h3>
          {plugin.grantedPermissions.length === 0 ? (
            <p className={styles.permissionRow}>No permissions granted.</p>
          ) : (
            plugin.grantedPermissions.map((permission) => (
              <p key={permission} className={styles.permissionRow}>
                <FaIcon name="circle-check" size={12} />
                {permissionShortLabel(permission)}
              </p>
            ))
          )}

          <nav className={styles.summaryNav} aria-label="Plugin recovery sections">
            {navItems.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                align="start"
                className={styles.summaryNavItem}
                data-active={section === item.id}
                aria-pressed={section === item.id}
                disabled={item.disabled}
                tooltip={item.title}
                onClick={() => selectSection(item.id)}
              >
                <FaIcon name={item.icon} size={14} />
                <span>{item.label}</span>
              </Button>
            ))}
          </nav>
        </aside>

        <div className={styles.center}>
          <section className={styles.serviceStopped}>
            <div className={styles.stoppedHeading}>
              <span className={styles.stoppedIcon}>
                <FaIcon name="exclamation" size={22} />
              </span>
              <div>
                <h2>{status.status === 'error' ? 'Service stopped' : 'Service running'}</h2>
                <p>
                  {budgetExhausted
                    ? `Parked after ${crashes.length} crashes in ${CRASH_WINDOW_LABEL}`
                    : status.status === 'error'
                      ? 'Parked after a lifecycle failure'
                      : 'This plugin is not currently parked'}
                </p>
              </div>
            </div>

            <div className={styles.errorGrid}>
              <dl>
                <div>
                  <dt>Last error</dt>
                  <dd>{plugin.lastError ?? 'No error recorded'}</dd>
                </div>
                {editorActivationError && (
                  <div>
                    <dt>Editor activation</dt>
                    <dd>{editorActivationError}</dd>
                  </div>
                )}
                <div>
                  <dt>Crash threshold</dt>
                  <dd>{CRASH_THRESHOLD} crashes in {CRASH_WINDOW_LABEL}</dd>
                </div>
                <div>
                  <dt>Recovery</dt>
                  <dd>{status.status === 'error' ? 'Manual restart required' : 'None required'}</dd>
                </div>
              </dl>

              <div className={styles.timeline}>
                <p className={styles.timelineHeading}>
                  Recent crashes ({crashes.length}
                  {crashes.length > 0 ? ` in ${CRASH_WINDOW_LABEL}` : ''})
                </p>
                {crashes.length === 0 ? (
                  <p className={styles.recoveryNote}>No crashes have been recorded.</p>
                ) : (
                  crashes.map((crash) => {
                    const stamp = formatTime(crash.occurredAt)
                    return (
                      <div key={crash.id} className={styles.timelineRow}>
                        <span className={styles.timelineDot} aria-hidden="true" />
                        <strong className={styles.timelineTime}>{stamp.time}</strong>
                        <small className={styles.timelineDate}>{stamp.date}</small>
                        <b className={styles.timelineReason}>{crash.reason}</b>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            <div className={styles.recoveryButtons}>
              <Button
                variant="primary"
                size="lg"
                disabled={!canManageLifecycle || !plugin.enabled || busy}
                onClick={onRestart}
              >
                <FaIcon
                  name={busy ? 'spinner' : 'arrows-rotate'}
                  size={14}
                  className={busy ? 'fa-spin' : undefined}
                />
                <span>Restart plugin</span>
              </Button>
              <Button
                variant="secondary"
                size="lg"
                disabled={!canManageLifecycle || busy}
                onClick={onToggle}
              >
                <FaIcon name={plugin.enabled ? 'pause' : 'play'} size={14} />
                <span>{plugin.enabled ? 'Disable' : 'Enable'}</span>
              </Button>
              <Button
                variant="secondary"
                size="lg"
                disabled={!canInstall || busy}
                onClick={onReinstall}
              >
                <FaIcon name="cube" size={14} />
                <span>Reinstall package</span>
              </Button>
            </div>
            <p className={styles.recoveryNote}>
              Restart clears the crash budget and runs activate again.
            </p>
          </section>

          <section className={styles.checks}>
            <h2>Recovery checks</h2>
            <div className={styles.check} data-tone={budgetExhausted ? 'warning' : 'success'}>
              <FaIcon name={budgetExhausted ? 'circle-exclamation' : 'circle-check'} size={19} />
              <span>
                <strong>
                  {budgetExhausted ? 'Crash budget exhausted' : 'Crash budget available'}
                </strong>
                <small>
                  {crashes.length} crash{crashes.length === 1 ? '' : 'es'} recorded within{' '}
                  {CRASH_WINDOW_LABEL}.
                </small>
              </span>
            </div>
            <div className={styles.check} data-tone={siblingCount > 1 ? 'success' : 'warning'}>
              <FaIcon name={siblingCount > 1 ? 'circle-check' : 'circle-exclamation'} size={19} />
              <span>
                <strong>
                  {siblingCount > 1 ? 'Sibling plugins running' : 'No sibling plugins installed'}
                </strong>
                <small>
                  {siblingCount > 1
                    ? 'Other plugin statuses remain available from the installed-plugin list.'
                    : 'This is the only installed plugin, so nothing else is affected.'}
                </small>
              </span>
            </div>
            <div
              className={styles.check}
              data-tone={status.status === 'error' ? 'warning' : 'success'}
            >
              <FaIcon
                name={status.status === 'error' ? 'circle-exclamation' : 'circle-check'}
                size={19}
              />
              <span>
                <strong>
                  {status.status === 'error'
                    ? 'Routes and schedules removed while parked'
                    : 'Routes and schedules registered'}
                </strong>
                <small>
                  {status.status === 'error'
                    ? 'Temporary routes and schedules stay unavailable until restart.'
                    : 'The plugin is serving its registered routes and schedules.'}
                </small>
              </span>
            </div>
          </section>
        </div>

        <aside className={styles.uploadedUpdate}>
          <div className={styles.updateHeading}>
            <span className={styles.updateIcon}>
              <FaIcon name="arrow-up-from-bracket" size={17} />
            </span>
            <h2>Uploaded update</h2>
          </div>

          {stagedPackage ? (
            <>
              <div className={styles.versionChange}>
                <div className={styles.versionColumn}>
                  <small>Current</small>
                  <strong>{plugin.version}</strong>
                </div>
                <FaIcon name="arrow-right" size={14} className={styles.versionArrow} />
                <div className={styles.versionColumn}>
                  <small>Package</small>
                  <strong>{stagedPackage.manifest.version}</strong>
                </div>
                <span className={styles.versionBadge}>Uploaded</span>
              </div>

              <ul className={styles.updateList}>
                {(() => {
                  const granted = new Set(plugin.grantedPermissions)
                  const added = stagedPackage.manifest.permissions.filter((p) => !granted.has(p))
                  const currentHosts = new Set(plugin.manifest.networkAllowedHosts ?? [])
                  const nextHosts = new Set(stagedPackage.manifest.networkAllowedHosts ?? [])
                  const removedHosts = [...currentHosts].filter((h) => !nextHosts.has(h))
                  return (
                    <>
                      <li data-tone={added.length > 0 ? 'warning' : 'success'}>
                        <FaIcon
                          name={added.length > 0 ? 'circle-exclamation' : 'circle-check'}
                          size={14}
                        />
                        {added.length > 0
                          ? `${added.length} new permission${added.length === 1 ? '' : 's'}`
                          : 'No new permissions'}
                      </li>
                      {removedHosts.length > 0 && (
                        <li data-tone="warning">
                          <FaIcon name="circle-minus" size={14} />
                          {removedHosts.length} host{removedHosts.length === 1 ? '' : 's'} removed
                        </li>
                      )}
                      <li>
                        <FaIcon name="circle-check" size={14} />
                        Settings and stored data preserved
                      </li>
                      <li data-tone="info">
                        <FaIcon name="circle-info" size={14} />
                        Migrate runs before re-activation
                      </li>
                    </>
                  )
                })()}
              </ul>

              <div className={styles.updateActions}>
                <Button
                  variant="primary"
                  size="lg"
                  className={styles.updateCta}
                  disabled={!canInstall || busy}
                  onClick={() => onReviewStaged(stagedPackage)}
                >
                  <FaIcon name="arrow-up-from-bracket" size={14} />
                  <span>Review and update</span>
                </Button>
                <Button
                  variant="ghost"
                  disabled={!canInstall || busy}
                  onClick={onDiscardStaged}
                >
                  <span>Discard package</span>
                </Button>
              </div>
              <p className={styles.updateNote}>
                If the update fails, Instatic restores the previous version and removes
                the new package files.
              </p>
            </>
          ) : (
            <>
              <p className={styles.updateEmpty}>
                No update package has been uploaded for this plugin. Upload one to
                review its manifest and permissions before anything is replaced.
              </p>
              <Button
                variant="secondary"
                size="lg"
                className={styles.updateCta}
                disabled={!canInstall || busy}
                onClick={onReinstall}
              >
                <FaIcon name="arrow-up-from-bracket" size={14} />
                <span>Upload package</span>
              </Button>
            </>
          )}
        </aside>
      </div>

      <section className={styles.removeStrip}>
        <div className={styles.removeStripText}>
          <FaIcon name="triangle-exclamation" size={22} />
          <span>
            <strong>Remove plugin</strong>
            <small>Normal removal runs deactivate and uninstall hooks.</small>
          </span>
        </div>
        <Button
          variant="ghost"
          tone="danger"
          disabled={!canInstall || busy}
          onClick={onRemove}
        >
          <FaIcon name="trash" size={14} />
          <span>Remove plugin</span>
        </Button>
      </section>

      <footer className={styles.footer} data-connected={liveConnected}>
        <span className={styles.footerDot} />
        <b className={styles.footerItem}>
          {liveConnected
            ? 'Live lifecycle updates connected'
            : 'Lifecycle event stream disconnected'}
        </b>
        <i className={styles.footerDivider} aria-hidden="true" />
        <span className={styles.footerItem}>
          Last event: {lastEvent ? `${lastEvent.date}, ${lastEvent.time}` : 'none recorded'}
        </span>
        <i className={styles.footerDivider} aria-hidden="true" />
        <span className={styles.footerItem}>Recent issues: {crashes.length}</span>
        <i className={styles.footerDivider} aria-hidden="true" />
        <span className={styles.footerItem}>
          Threshold: {CRASH_THRESHOLD} in {CRASH_WINDOW_LABEL}
        </span>
        <Button
          variant="secondary"
          className={styles.footerAction}
          disabled={crashes.length === 0}
          onClick={() => selectSection('issues')}
        >
          <FaIcon name="clock-rotate-left" size={14} />
          <span>Open recent issues</span>
        </Button>
      </footer>
    </div>
  )
}
