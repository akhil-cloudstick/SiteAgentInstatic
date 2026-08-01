/**
 * Toolbar — fixed top bar shared by every admin route.
 *
 * Layout (left → right):
 *   [MMSBUILD brand lockup] [admin nav]
 *   [Plugin buttons] [spacer→] [right slot]    [Account menu]
 *
 * Undo/Redo lives inside the canvas notch (CanvasNotch), not the toolbar —
 * those controls only operate on the visual editor's page tree, so they have
 * no meaning on admin pages outside the canvas (Content, Plugins, …).
 *
 * Composition contract:
 *   - The brand is a FIXED MMS product lockup (mascot + "MMSBUILD" wordmark),
 *     identical on every install — see `BrandLockup`. It is not the per-site
 *     name, so the toolbar needs no site props and stays usable from every
 *     layout without pulling the editor store into non-editor bundles.
 *   - The editor-specific overlay (preview iframe) is passed in by the canvas
 *     layout via `overlay`. AdminPageLayout passes no overlay and the toolbar
 *     shows nothing in that position.
 *   - The `rightSlot` is owned by the caller — `AdminCanvasLayout` builds
 *     zoom / publish / settings buttons; `AdminPageLayout` builds its own
 *     toolbar right slot + settings button.
 *
 * Accessibility (WCAG 2.1 AA):
 * - native <header> banner landmark for the top-level toolbar
 * - aria-label on the nav region
 * - All interactive children have 44×44px minimum touch targets
 */

import { useEffect, useState, type ReactNode } from 'react'
import { FaIcon } from '@ui/components/FaIcon'
import { pluginRuntime } from '@core/plugins/runtime'
import type { RegisteredPluginToolbarButton } from '@core/plugin-sdk'
import { AccountMenuButton } from '@admin/shared/AccountMenuButton'
import { OpenLivePageButton } from '@admin/shared/OpenLivePageButton'
import { SettingsButton } from './SettingsButton'
import { ThemeToggleButton } from './ThemeToggleButton'
import { useEditorSelectPreference } from '@admin/pages/site/preferences/editorPreferences'
import { Link } from '@admin/lib/routing'
import { Button } from '@ui/components/Button'
import { cn } from '@ui/cn'
import type { AdminWorkspace } from '@admin/workspace'
import styles from './Toolbar.module.css'
import { getErrorMessage } from '@core/utils/errorMessage'

/**
 * Nav tab icon size. 17px matches the reference dashboard screen's
 * `.nav-item i { font-size: 17px }` — a touch larger than the label so the
 * icon + label lockup stays balanced on the 60px header track.
 */
const NAV_ICON_SIZE = 17

/** Fixed product wordmark shown beside the mascot at the toolbar's left edge. */
const BRAND_WORDMARK = 'MMSBUILD'

interface ToolbarProps {
  /** Active admin section — drives the default nav slot's highlight. */
  section?: AdminWorkspace
  /** Replaces the default admin section navigation links. */
  adminNavigationSlot?: ReactNode
  /**
   * Full-screen overlay siblings rendered before the toolbar header. Used by
   * AdminCanvasLayout to mount the preview overlay (also editor-only and
   * lazy-loaded). The overlay is a sibling rather than a child so it can
   * cover the whole viewport instead of being clipped by the toolbar's
   * stacking context.
   */
  overlay?: ReactNode
  /**
   * Content rendered immediately before the account menu. Both layouts
   * own this region: AdminCanvasLayout fills it with zoom / publish /
   * settings; AdminPageLayout passes any page-specific toolbar items
   * followed by the SettingsButton.
   */
  rightSlot?: ReactNode
}

type PluginButtonStatus = {
  state: 'running' | 'success' | 'error'
  message: string
}

function pluginButtonKey(button: RegisteredPluginToolbarButton): string {
  return `${button.pluginId}:${button.id}`
}

export function Toolbar({
  section = 'site',
  adminNavigationSlot,
  overlay,
  rightSlot,
}: ToolbarProps) {
  const [pluginButtons, setPluginButtons] = useState<RegisteredPluginToolbarButton[]>(() =>
    pluginRuntime.getToolbarButtons(),
  )
  const [pluginStatuses, setPluginStatuses] = useState<Record<string, PluginButtonStatus>>({})
  const [statusTimers] = useState(() => new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    return pluginRuntime.subscribe(() => {
      setPluginButtons(pluginRuntime.getToolbarButtons())
    })
  }, [])

  useEffect(() => {
    return () => {
      for (const timer of statusTimers.values()) clearTimeout(timer)
      statusTimers.clear()
    }
  }, [statusTimers])

  function setPluginStatus(key: string, status: PluginButtonStatus): void {
    const currentTimer = statusTimers.get(key)
    if (currentTimer) {
      clearTimeout(currentTimer)
      statusTimers.delete(key)
    }

    setPluginStatuses((current) => ({ ...current, [key]: status }))

    if (status.state !== 'running') {
      const timer = setTimeout(() => {
        setPluginStatuses((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
        statusTimers.delete(key)
      }, 4000)
      statusTimers.set(key, timer)
    }
  }

  async function runPluginButtonCommand(button: RegisteredPluginToolbarButton): Promise<void> {
    const key = pluginButtonKey(button)
    setPluginStatus(key, {
      state: 'running',
      message: `${button.label} running`,
    })

    try {
      const result = await pluginRuntime.runCommand(button.command)
      setPluginStatus(key, {
        state: 'success',
        message: result && typeof result === 'object' && result.message
          ? result.message
          : `${button.label} complete`,
      })
    } catch (err) {
      console.error('[plugin-runtime] command failed:', err)
      setPluginStatus(key, {
        state: 'error',
        message: getErrorMessage(err, `${button.label} failed`),
      })
    }
  }

  return (
    <>
      {overlay}
      <header
        aria-label="Editor toolbar"
        data-testid="toolbar"
        className={styles.header}
      >
        {/* ── Left section ────────────────────────────────────────────────── */}

        <BrandLockup />
        <nav className={styles.adminNav} aria-label="Primary navigation">
          {adminNavigationSlot ?? <DefaultAdminNavigation section={section} />}
        </nav>

        <div className={styles.workspaceToolbarItems}>
          {pluginButtons.map((button) => {
            const key = pluginButtonKey(button)
            const status = pluginStatuses[key]
            const statusId = `plugin-command-status-${button.pluginId}-${button.id}`
            return (
              <div key={key} className={styles.pluginButtonWrapper}>
                <Button
                  variant="secondary"
                  size="sm"
                  className={styles.pluginButton}
                  aria-describedby={status ? statusId : undefined}
                  data-state={status?.state}
                  disabled={status?.state === 'running'}
                  onClick={() => {
                    void runPluginButtonCommand(button)
                  }}
                >
                  <span>{status?.state === 'running' ? `${button.label}...` : button.label}</span>
                </Button>
                {status && (
                  <output
                    id={statusId}
                    aria-live="polite"
                    className={cn(
                      styles.pluginToast,
                      status.state === 'error' && styles.pluginToastError,
                    )}
                  >
                    {status.message}
                  </output>
                )}
              </div>
            )
          })}

          {/* ── Spacer ──────────────────────────────────────────────────────── */}
          <div className={styles.spacer} aria-hidden="true" />

          {/* ── Right section — caller-owned ─────────────────────────────── */}
          {rightSlot}
          {/* SettingsButton + OpenLivePageButton + AccountMenuButton are the
              global toolbar trailer — always rendered regardless of `rightSlot`
              or which layout mounted the toolbar. SettingsButton opens the
              global Settings modal (it reads the tiny `adminUi` store, so it
              never drags the editor toolchain into non-editor bundles);
              OpenLivePageButton jumps to the live site in a new tab
              (deep-linking to the active page when one is open in the canvas,
              the site root elsewhere); AccountMenuButton is the account /
              sign-out entry point. All three are reachable from every admin
              route (Site / Content / Data / Media / Plugins / Users / …), so
              they live in the toolbar shell, not in any layout's right slot. */}
          <div className={styles.headerTrailer}>
            <ThemeToggleButton />
            <SettingsButton />
            <OpenLivePageButton />
            <AccountMenuButton />
          </div>
        </div>
      </header>
    </>
  )
}

/**
 * Fixed MMS product brand at the toolbar's left edge. This is a product
 * lockup, not the per-site name: it is identical on every install and clicks
 * through to the dashboard.
 *
 * The approved screen reference ships the lockup as ONE artwork per theme
 * (mascot + wordmark baked into a single PNG) rather than a mascot image
 * beside live text, and the dark asset is drawn slightly larger — so the
 * source and the intrinsic size both swap with the theme. Served from
 * `public/mmsbuild-logo-{light,dark}.png`.
 *
 * The link carries the accessible name, so the image itself is decorative.
 */
function BrandLockup() {
  const isDark = useEditorSelectPreference('theme') === 'dark'

  return (
    <Link
      className={styles.brand}
      to="/admin/dashboard"
      aria-label={BRAND_WORDMARK}
      data-testid="toolbar-brand"
    >
      <img
        className={styles.brandMark}
        src={isDark ? '/mmsbuild-logo-dark.png' : '/mmsbuild-logo-light.png'}
        width={isDark ? 148 : 141}
        height={isDark ? 30 : 25}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    </Link>
  )
}

function DefaultAdminNavigation({ section }: { section: AdminWorkspace }) {
  return (
    <>
      <DefaultNavSlot
        to="/admin/dashboard"
        icon={<FaIcon name="table-cells-large" size={NAV_ICON_SIZE} />}
        label="Dashboard"
        active={section === 'dashboard'}
      />
      <DefaultNavSlot
        to="/admin/site"
        icon={<FaIcon name="window-maximize" size={NAV_ICON_SIZE} />}
        label="Site"
        active={section === 'site'}
      />
      <DefaultNavSlot
        to="/admin/content"
        icon={<FaIcon name="file-lines" size={NAV_ICON_SIZE} />}
        label="Content"
        active={section === 'content'}
      />
      <DefaultNavSlot
        to="/admin/data"
        icon={<FaIcon name="database" size={NAV_ICON_SIZE} />}
        label="Data"
        active={section === 'data'}
      />
      <DefaultNavSlot
        to="/admin/media"
        icon={<FaIcon name="image" size={NAV_ICON_SIZE} />}
        label="Media"
        active={section === 'media'}
      />
      <DefaultNavSlot
        to="/admin/plugins"
        icon={<FaIcon name="cube" size={NAV_ICON_SIZE} />}
        label="Plugins"
        active={section === 'plugins'}
      />
      <DefaultNavSlot
        to="/admin/ai"
        icon={<FaIcon name="robot" size={NAV_ICON_SIZE} />}
        label="AI"
        active={section === 'ai'}
      />
    </>
  )
}

function DefaultNavSlot({
  to,
  icon,
  label,
  active,
}: {
  to: string
  icon: ReactNode
  label: string
  active: boolean
}) {
  if (active) {
    return (
      <span className={styles.activeSection}>
        {icon}
        <span>{label}</span>
      </span>
    )
  }
  return (
    <Link className={styles.adminLink} to={to}>
      {icon}
      <span>{label}</span>
    </Link>
  )
}
