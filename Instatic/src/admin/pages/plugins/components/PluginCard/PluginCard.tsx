/**
 * `PluginCard` — one tile in the control room's two-column grid.
 *
 * Renders the plugin's identity (gradient icon tile, name, version, status
 * chips), its description and author, the permissions it was granted, its
 * action row, and a kebab menu holding the overflow actions.
 *
 * Every action is delegated to the parent through callbacks — the card owns no
 * lifecycle state. The parent is the one place that runs step-up auth, hits the
 * server, and updates the plugins payload; the card shows the result and
 * reports clicks.
 */
import { useEffect, useRef } from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { Skeleton } from '@ui/components/Skeleton'
import type { InstalledPlugin } from '@core/plugin-sdk'
import {
  PLUGIN_FALLBACK_GLYPH,
  permissionGlyph,
  permissionShortLabel,
  pluginIconUrl,
  pluginStatus,
  pluginTone,
} from '../../utils/pluginIconography'
import styles from './PluginCard.module.css'

/**
 * How many granted permissions the card lists before it stops. The reference's
 * demo plugins declare two or three; a real plugin can declare a dozen, which
 * would push the permission line into four wrapped rows and shove the action
 * row off the bottom of a fixed-height card. The remainder is summarised
 * rather than dropped, and the full set is always visible in the install
 * review and the recovery view.
 */
const MAX_VISIBLE_PERMISSIONS = 4

interface PluginCardLoadingProps {
  loading: true
  plugin?: never
  busy?: never
  editorActivationError?: never
  menuOpen?: never
  canConfigure?: never
  canInstall?: never
  canManageLifecycle?: never
  onToggleMenu?: never
  onOpenSettings?: never
  onOpenSchedules?: never
  onInstallPack?: never
  onRestart?: never
  onOpenRecovery?: never
  onToggle?: never
  onRemove?: never
}

interface PluginCardDataProps {
  loading?: false
  plugin: InstalledPlugin
  /** Disables every action while a lifecycle request for this plugin is in
   *  flight, and swaps the acting button's glyph for a spinner. */
  busy: boolean
  /** Editor-side activation failure. Surfaced on the recovery screen; the card
   *  only uses it to decide whether the plugin needs attention. */
  editorActivationError?: string
  menuOpen: boolean
  canConfigure: boolean
  canInstall: boolean
  canManageLifecycle: boolean
  onToggleMenu: () => void
  onOpenSettings: (plugin: InstalledPlugin) => void
  onOpenSchedules: (plugin: InstalledPlugin) => void
  onInstallPack: (plugin: InstalledPlugin) => void
  onRestart: (plugin: InstalledPlugin) => void
  onOpenRecovery: (plugin: InstalledPlugin) => void
  onToggle: (plugin: InstalledPlugin) => void
  onRemove: (plugin: InstalledPlugin) => void
}

type PluginCardProps = PluginCardLoadingProps | PluginCardDataProps

export function PluginCard(props: PluginCardProps) {
  if (props.loading) return <PluginCardSkeleton />
  return <PluginCardBody {...props} />
}

/**
 * Skeleton mirrors the real card 1:1 — same three-column grid, same 74px icon
 * block, same title/chip/description/action rhythm — so the swap to real data
 * doesn't move anything.
 *
 * The approved screen has no loading state at all; it renders seeded data
 * instantly. Dropping ours would leave a blank workspace for the length of the
 * plugins fetch, so it stays, reshaped to the new geometry.
 */
function PluginCardSkeleton() {
  return (
    <article className={styles.pluginCard} aria-busy="true" aria-label="Loading plugin">
      <Skeleton width={74} height={74} radius={10} />
      <div className={styles.skeletonCopy}>
        <Skeleton width={180} height={18} />
        <div className={styles.skeletonChips}>
          <Skeleton width={64} height={26} radius={999} />
          <Skeleton width={88} height={26} radius={999} />
        </div>
        <Skeleton width="82%" height={13} />
        <Skeleton width="46%" height={13} />
        <div className={styles.skeletonActions}>
          <Skeleton width={104} height={44} radius={7} />
          <Skeleton width={118} height={44} radius={7} />
        </div>
      </div>
      <Skeleton width={44} height={44} radius={7} />
    </article>
  )
}

function PluginCardBody({
  plugin,
  busy,
  menuOpen,
  canConfigure,
  canInstall,
  canManageLifecycle,
  onToggleMenu,
  onOpenSettings,
  onOpenSchedules,
  onInstallPack,
  onRestart,
  onOpenRecovery,
  onToggle,
  onRemove,
}: PluginCardDataProps) {
  const menuWrapRef = useRef<HTMLDivElement | null>(null)
  const status = pluginStatus(plugin)
  const tone = pluginTone(status.status)
  const iconUrl = pluginIconUrl(plugin)

  // The reference's menu has neither outside-click nor Escape — its own
  // design-qa notes the gap. Both are added here: a popover the operator
  // cannot dismiss by looking away is a trap, not a menu.
  useEffect(() => {
    if (!menuOpen) return undefined
    function onPointerDown(event: PointerEvent) {
      if (menuWrapRef.current?.contains(event.target as Node)) return
      onToggleMenu()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onToggleMenu()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen, onToggleMenu])

  const permissions = plugin.grantedPermissions
  const visiblePermissions = permissions.slice(0, MAX_VISIBLE_PERMISSIONS)
  const hiddenPermissionCount = permissions.length - visiblePermissions.length

  // A bundled visual pack that has been imported into the site. Drives both the
  // "Pack synced" chip and, per the approved screen, the Disable button.
  const hasSyncedPack = Boolean(
    plugin.manifest.pack && plugin.grantedPermissions.includes('visualComponents.register'),
  )

  // The approved screen renders Disable only for an active plugin that ships a
  // synced pack. Kept as a named constant because it is the single condition
  // separating "matches the reference exactly" from "every active plugin can be
  // switched off from its card" — flipping it to `status.status === 'active'`
  // is the whole change.
  const showDisable = status.status === 'active' && hasSyncedPack && plugin.enabled

  return (
    <article className={styles.pluginCard} data-status={status.status}>
      <div className={styles.pluginIcon} data-tone={tone}>
        {iconUrl ? (
          <img className={styles.pluginIconImage} src={iconUrl} alt="" loading="lazy" />
        ) : (
          <FaIcon name={PLUGIN_FALLBACK_GLYPH} size={37} />
        )}
      </div>

      <div className={styles.pluginCopy}>
        <div className={styles.pluginTitle}>
          <h2>{plugin.name}</h2>
          <span className={styles.version} aria-label={`Version ${plugin.version}`}>
            v{plugin.version}
          </span>
        </div>

        <div className={styles.chips}>
          <span className={styles.statusChip} data-status={status.status}>
            {status.label}
          </span>
          {hasSyncedPack && (
            <span className={styles.statusChip} data-status="active">Pack synced</span>
          )}
          {status.status === 'error' && plugin.recentCrashes && plugin.recentCrashes.length > 0 && (
            <b className={styles.crashNote}>
              Stopped after {plugin.recentCrashes.length} crash
              {plugin.recentCrashes.length === 1 ? '' : 'es'}
            </b>
          )}
        </div>

        <p className={styles.description}>
          {plugin.manifest.description ?? `${plugin.id} v${plugin.version}`}
        </p>
        {plugin.manifest.author?.name && (
          <small className={styles.author}>Author: {plugin.manifest.author.name}</small>
        )}

        {permissions.length > 0 && (
          <div className={styles.permissionLine}>
            {visiblePermissions.map((permission, index) => (
              <span key={permission}>
                <FaIcon name={permissionGlyph(permission)} size={11} />
                {permissionShortLabel(permission)}
                {index < visiblePermissions.length - 1 && (
                  <b className={styles.permissionSeparator} aria-hidden="true">•</b>
                )}
              </span>
            ))}
            {hiddenPermissionCount > 0 && <span>+{hiddenPermissionCount} more</span>}
          </div>
        )}

        <div className={styles.cardActions}>
          {status.status === 'active'
            && canConfigure
            && plugin.manifest.settings
            && plugin.manifest.settings.length > 0 && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => onOpenSettings(plugin)}
              aria-label={`Edit settings for ${plugin.name}`}
            >
              <FaIcon name="gear" size={14} />
              <span>Settings</span>
            </Button>
          )}

          {status.status === 'active'
            && canConfigure
            && plugin.grantedPermissions.includes('cms.schedule') && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => onOpenSchedules(plugin)}
              aria-label={`View schedules for ${plugin.name}`}
            >
              <FaIcon name="calendar" size={14} />
              <span>Schedules</span>
            </Button>
          )}

          {/* Re-syncing a disabled plugin's pack would inject its components
              into the site — the opposite of what "disabled" means. The server
              rejects it too; hiding the button keeps the two agreeing. */}
          {hasSyncedPack && canInstall && plugin.enabled && status.status !== 'error' && (
            <Button
              variant="secondary"
              disabled={!canManageLifecycle || busy}
              onClick={() => onInstallPack(plugin)}
              aria-label={`Re-sync the bundled pack from ${plugin.name}`}
            >
              <FaIcon name={busy ? 'spinner' : 'arrows-rotate'} size={14} className={busy ? 'fa-spin' : undefined} />
              <span>Re-sync pack</span>
            </Button>
          )}

          {showDisable && (
            <Button
              variant="secondary"
              disabled={!canManageLifecycle || busy}
              onClick={() => onToggle(plugin)}
              aria-label={`Disable ${plugin.name}`}
            >
              <span>Disable</span>
            </Button>
          )}

          {status.status === 'disabled' && (
            <Button
              variant="secondary"
              disabled={!canManageLifecycle || busy}
              onClick={() => onToggle(plugin)}
              aria-label={`Enable ${plugin.name}`}
            >
              <FaIcon name="play" size={14} />
              <span>Enable</span>
            </Button>
          )}

          {status.status === 'error' && (
            <>
              <Button
                variant="primary"
                disabled={!canManageLifecycle || !plugin.enabled || busy}
                onClick={() => onRestart(plugin)}
                aria-label={`Restart ${plugin.name}`}
              >
                <FaIcon name={busy ? 'spinner' : 'arrows-rotate'} size={14} className={busy ? 'fa-spin' : undefined} />
                <span>Restart</span>
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => onOpenRecovery(plugin)}
                aria-label={`Open recovery for ${plugin.name}`}
              >
                <FaIcon name="download" size={14} />
                <span>Reinstall</span>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className={styles.cardMenuWrap} ref={menuWrapRef}>
        <Button
          variant="ghost"
          iconOnly
          className={styles.kebab}
          aria-label={`More actions for ${plugin.name}`}
          aria-expanded={menuOpen}
          onClick={onToggleMenu}
        >
          <FaIcon name="ellipsis" size={16} />
        </Button>
        {menuOpen && (
          <div className={styles.cardMenu} role="menu">
            <Button
              variant="ghost"
              role="menuitem"
              className={styles.cardMenuItem}
              onClick={() => {
                onToggleMenu()
                if (status.status === 'error') onOpenRecovery(plugin)
                else onOpenSettings(plugin)
              }}
            >
              <FaIcon name="circle-info" size={14} />
              <span>View details</span>
            </Button>
            <Button
              variant="ghost"
              role="menuitem"
              tone="danger"
              className={styles.cardMenuItem}
              disabled={!canInstall || busy}
              onClick={() => {
                onToggleMenu()
                onRemove(plugin)
              }}
            >
              <FaIcon name="trash" size={14} />
              <span>Remove plugin</span>
            </Button>
          </div>
        )}
      </div>
    </article>
  )
}
