/**
 * Toolbar — this product's adapter for row 2 of the shared MMS shell.
 *
 * The row itself is `MmsSpecialistRow` in `@mms/shell` and is rendered
 * identically by MMS Design. Everything below is the CMS-side contents:
 *
 *   [product identity + site] [CMS destinations] [plugin buttons]
 *              [spacer→] [right slot] [Open live] [Back to Product Hub]
 *
 * Row 1 is `ProductHubHeader` (`@admin/shared/ProductHubHeader`), also shared.
 * It owns the MMSBUILD brand lockup and the five utilities — Help,
 * Notifications, Theme, Settings, Account. The shared-header contract requires
 * each of those to appear EXACTLY ONCE in the shell, so none may be added here.
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
 *     site, read from the tiny `adminUi` store — so this row needs no props for
 *     it and never pulls the editor store into non-editor bundles.
 *   - The editor-specific overlay (preview iframe) is passed in by the canvas
 *     layout via `overlay`. AdminPageLayout passes no overlay.
 *   - The `rightSlot` is owned by the caller — `AdminCanvasLayout` builds
 *     zoom / publish buttons; `AdminPageLayout` builds its own right slot.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { BRAND_NAME } from '@core/brand'
import { MmsSpecialistRow, Button, cn, type ShellDestination } from '@mms/shell'
import { pluginRuntime } from '@core/plugins/runtime'
import type { RegisteredPluginToolbarButton } from '@core/plugin-sdk'
import { OpenLivePageButton } from '@admin/shared/OpenLivePageButton'
import { hubLinkHref } from '@admin/shared/ProductHubHeader'
import { useAdminUi } from '@admin/state/adminUi'
import { useHubContext } from '@admin/state/hubContext'
import { useAdminNavigate } from '@admin/lib/useAdminNavigate'
import styles from './Toolbar.module.css'
import { getErrorMessage } from '@core/utils/errorMessage'

/** Where the product identity goes. */
const IDENTITY_HREF = '/cms/dashboard'

interface ToolbarProps {
  /**
   * The CMS destinations, already resolved behind their capability gates by
   * `useAdminSectionDestinations`. Passed as data because the shared row owns
   * the tab chrome — see that hook's header.
   */
  destinations: ShellDestination[]
  /**
   * Full-screen overlay siblings rendered before the row. Used by
   * AdminCanvasLayout to mount the preview overlay (also editor-only and
   * lazy-loaded). The overlay is a sibling rather than a child so it can cover
   * the whole viewport instead of being clipped by the row's stacking context.
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

export function Toolbar({ destinations, overlay, rightSlot }: ToolbarProps) {
  const hubContext = useHubContext()
  const siteName = useAdminUi((s) => s.siteName)
  const navigate = useAdminNavigate()
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
    setPluginStatus(key, { state: 'running', message: `${button.label} running` })

    try {
      const result = await pluginRuntime.runCommand(button.command)
      setPluginStatus(key, {
        state: 'success',
        message:
          result && typeof result === 'object' && result.message
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

  const pluginSlot = pluginButtons.map((button) => {
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
            className={cn(styles.pluginToast, status.state === 'error' && styles.pluginToastError)}
          >
            {status.message}
          </output>
        )}
      </div>
    )
  })

  return (
    <MmsSpecialistRow
      productName={BRAND_NAME}
      // Broadest to narrowest, exactly as the contract orders it: client, then
      // project, then site. Client and project are shown when the Product Hub
      // hand-off supplied them, and omitted rather than guessed when it did not
      // — the contract forbids defaulting to another project.
      scope={[hubContext?.client, hubContext?.project, siteName ?? hubContext?.site]}
      identityHref={IDENTITY_HREF}
      onSelectIdentity={() => navigate(IDENTITY_HREF)}
      destinations={destinations}
      navLabel={`${BRAND_NAME} navigation`}
      rowLabel={`${BRAND_NAME} specialist workspace`}
      // Right-aligned in the CMS. MMS Design places it leftmost instead
      // (DECISIONS 2026-08-10) — the one per-product difference the contract
      // sanctions in this row.
      backToHub={{
        position: 'right',
        href: hubContext
          ? hubContext.returnUrl || hubLinkHref(hubContext.hubBaseUrl, '/hub')
          : undefined,
      }}
      middleSlot={pluginSlot.length > 0 ? pluginSlot : undefined}
      // "Open live page" is this product's affordance, not a shared utility —
      // the contract's utility list is Help, Notifications, Theme, Settings and
      // Account, and all five live in row 1. It jumps to the live site in a new
      // tab, deep-linking to the active page when one is open in the canvas and
      // the site root elsewhere.
      rightSlot={
        <>
          {rightSlot}
          <OpenLivePageButton />
        </>
      }
      overlay={overlay}
    />
  )
}
