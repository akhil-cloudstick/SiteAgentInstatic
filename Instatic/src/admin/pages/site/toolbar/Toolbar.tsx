/**
 * Toolbar — row 2 of the MMSBUILD shared shell: this product's SPECIALIST
 * navigation.
 *
 * Layout (left → right):
 *   [product identity + site context] [CMS nav]
 *   [Plugin buttons] [spacer→] [right slot]  [Open live] [Back to Product Hub]
 *
 * Row 1 is `ProductHubHeader` (`@admin/shared/ProductHubHeader`) and is shared
 * verbatim with Product Hub and MMS Design. It owns the MMSBUILD brand lockup
 * and the five utilities — Help, Notifications, Theme, Settings, Account. The
 * shared-header contract requires each of those to appear EXACTLY ONCE in the
 * shell, so none of them may be added back here.
 *
 * What belongs in this row: the seven CMS destinations (Dashboard, Site,
 * Content, Data, Media, Plugins, Users), the product identity, and local
 * actions. Per-workspace controls — save, preview, publish, canvas mode, zoom —
 * belong BELOW this row in their own workspace toolbar, not here.
 *
 * Undo/Redo has no button anywhere in the chrome — it is keyboard-only
 * (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z), owned by `canvas/useUndoRedoShortcuts` and
 * mounted by CanvasRoot. History only operates on the visual editor's page
 * tree, so it has no meaning on admin pages outside the canvas (Content,
 * Plugins, …) and must never be surfaced in this shared toolbar.
 *
 * Composition contract:
 *   - The identity is the product name from `@core/brand` plus the current
 *     site, read from the tiny `adminUi` store — so this row needs no props
 *     and never pulls the editor store into non-editor bundles.
 *   - The editor-specific overlay (preview iframe) is passed in by the canvas
 *     layout via `overlay`. AdminPageLayout passes no overlay and the toolbar
 *     shows nothing in that position.
 *   - The `rightSlot` is owned by the caller — `AdminCanvasLayout` builds
 *     zoom / publish buttons; `AdminPageLayout` builds its own right slot.
 *
 * Accessibility (WCAG 2.1 AA):
 * - `ProductHubHeader` owns the page's `banner` landmark; this is a labelled
 *   navigation region beneath it
 * - the active destination carries `aria-current="page"`
 * - All interactive children have 44×44px minimum touch targets
 */

import { useEffect, useState, type ReactNode } from 'react'
import { BRAND_NAME } from '@core/brand'
import { FaIcon } from '@ui/components/FaIcon'
import { pluginRuntime } from '@core/plugins/runtime'
import type { RegisteredPluginToolbarButton } from '@core/plugin-sdk'
import { OpenLivePageButton } from '@admin/shared/OpenLivePageButton'
import { hubLinkHref } from '@admin/shared/ProductHubHeader/hubNavigation'
import { useAdminUi } from '@admin/state/adminUi'
import { useHubContext } from '@admin/state/hubContext'
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
   * Content rendered immediately before the trailer. Both layouts own this
   * region: AdminCanvasLayout fills it with presence / sync / preview /
   * publish; AdminPageLayout passes any page-specific toolbar items. None of
   * the five shared utilities may go here — they live in row 1.
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
      <div
        aria-label={`${BRAND_NAME} navigation`}
        role="navigation"
        data-testid="toolbar"
        className={styles.header}
      >
        {/* ── Left section ────────────────────────────────────────────────── */}

        <ProductIdentity />
        <nav className={styles.adminNav} aria-label={`${BRAND_NAME} sections`}>
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
          {/* Specialist actions. "Open live page" is this product's affordance,
              not a shared utility — the contract's utility list is Help,
              Notifications, Theme, Settings and Account, and all five live in
              row 1. It jumps to the live site in a new tab, deep-linking to the
              active page when one is open in the canvas and the site root
              elsewhere. "Back to Product Hub" closes the round trip. Both are
              reachable from every admin route, so they live in this shell
              rather than in any one layout's right slot. */}
          <div className={styles.headerTrailer}>
            <OpenLivePageButton />
            <BackToProductHubButton />
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * Product identity for row 2 — the product name plus the site being worked on.
 *
 * The product name comes from `@core/brand`, the single white-label surface
 * every user-facing product mention flows through. The site name comes from
 * `adminUi`, which both `useSiteSummary` (light layouts) and `usePersistence`
 * (the editor) publish into — so one reader serves every layout.
 *
 * Client and project are shown when the Product Hub hand-off supplied them.
 * They are omitted rather than guessed when it did not: the contract forbids
 * defaulting to another project, and Operator's tenant registry has no client
 * or project record to supply yet.
 */
function ProductIdentity() {
  const hubContext = useHubContext()
  const siteName = useAdminUi((s) => s.siteName)

  // Broadest to narrowest, exactly as the contract orders it: client, then
  // project, then site. Blank entries drop out instead of leaving stray
  // separators behind.
  const scope = [hubContext?.client, hubContext?.project, siteName ?? hubContext?.site]
    .filter((part): part is string => Boolean(part))

  return (
    <Link
      className={styles.productIdentity}
      to="/cms/dashboard"
      data-testid="toolbar-product-identity"
    >
      <span className={styles.productName}>{BRAND_NAME}</span>
      {scope.length > 0 && (
        <span className={styles.productScope}>
          {scope.map((part, index) => (
            <span key={part}>
              {index > 0 && <span className={styles.productScopeSep} aria-hidden="true">·</span>}
              {part}
            </span>
          ))}
        </span>
      )}
    </Link>
  )
}

/**
 * Return affordance required by the shared-header contract: back to the exact
 * Hub dashboard, module and view the user arrived from, with role, client,
 * project and originating surface intact. All of that lives in `returnUrl`,
 * which the SSO hand-off pinned to the Hub origin and the server re-pins on
 * every read — so the button never has to reconstruct the scope itself.
 *
 * Renders only when this install actually runs behind a Product Hub. On a
 * self-hosted install there is nowhere to return to, and the contract forbids
 * inventing a destination.
 *
 * Unsaved work: this is a full-page navigation, so every registered
 * `beforeunload` handler runs first — including the editor's persistence flush
 * (`usePersistence`), which ships pending changes before the page goes away.
 * That is the one existing mechanism for protecting in-flight edits; adding a
 * second confirm layer here would double-prompt against it.
 */
function BackToProductHubButton() {
  const hubContext = useHubContext()
  if (!hubContext) return null

  return (
    <Button
      variant="secondary"
      size="sm"
      className={styles.backToHub}
      data-testid="toolbar-back-to-product-hub"
      onClick={() => {
        window.location.assign(hubContext.returnUrl || hubLinkHref(hubContext.hubBaseUrl, '/hub'))
      }}
    >
      <FaIcon name="arrow-left" size={13} />
      <span>Back to Product Hub</span>
    </Button>
  )
}

/**
 * Fallback navigation for a Toolbar mounted without an `adminNavigationSlot`.
 *
 * The destinations are fixed by the shared-header contract: Dashboard, Site,
 * Content, Data, Media, Plugins, Users — and nothing else. AI settings are
 * reachable from Settings and by direct URL; adding an eighth link here would
 * put this row out of step with the other products' specialist rows.
 *
 * Every layout passes `AdminSectionNavigation` instead, which renders the same
 * seven behind their capability gates. This exists so the component is usable
 * standalone (tests, isolated stories) without silently rendering an empty nav.
 */
function DefaultAdminNavigation({ section }: { section: AdminWorkspace }) {
  return (
    <>
      <DefaultNavSlot
        to="/cms/dashboard"
        icon={<FaIcon name="table-cells-large" size={NAV_ICON_SIZE} />}
        label="Dashboard"
        active={section === 'dashboard'}
      />
      <DefaultNavSlot
        to="/cms/site"
        icon={<FaIcon name="window-maximize" size={NAV_ICON_SIZE} />}
        label="Site"
        active={section === 'site'}
      />
      <DefaultNavSlot
        to="/cms/content"
        icon={<FaIcon name="file-lines" size={NAV_ICON_SIZE} />}
        label="Content"
        active={section === 'content'}
      />
      <DefaultNavSlot
        to="/cms/data"
        icon={<FaIcon name="database" size={NAV_ICON_SIZE} />}
        label="Data"
        active={section === 'data'}
      />
      <DefaultNavSlot
        to="/cms/media"
        icon={<FaIcon name="image" size={NAV_ICON_SIZE} />}
        label="Media"
        active={section === 'media'}
      />
      <DefaultNavSlot
        to="/cms/plugins"
        icon={<FaIcon name="cube" size={NAV_ICON_SIZE} />}
        label="Plugins"
        active={section === 'plugins'}
      />
      <DefaultNavSlot
        to="/cms/users"
        icon={<FaIcon name="user" size={NAV_ICON_SIZE} />}
        label="Users"
        active={section === 'users'}
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
      // aria-current marks the ONE current destination in the shell. It never
      // appears on a Product Hub link in row 1: inside this product, the active
      // destination is always a row-2 one.
      <span className={styles.activeSection} aria-current="page">
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
