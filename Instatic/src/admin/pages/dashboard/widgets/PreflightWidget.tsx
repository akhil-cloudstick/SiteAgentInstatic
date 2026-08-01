/**
 * MMSBUILD preflight widget ("Live Release Desk", Screen 1).
 *
 * The release-readiness checklist. Its rows follow the redesign guide's exact
 * set — Domain & SSL, Draft synchronization, Plugin runtime, Client approval,
 * Backup policy — and every value comes from a REAL source or an explicit
 * "unavailable" state. Nothing here is fabricated:
 *   - Draft synchronization  → real publish status (`getCmsPublishStatus`)
 *   - Plugin runtime         → real `installed_plugins` scan (`usePluginsStats`)
 *   - Client approval        → honest "Approval not required" (a Hub/plugin
 *                              workflow concept, not core CMS state)
 *   - Domain & SSL / Backup  → no adapter in this build → honest "na"
 *
 * SEO basics / Mobile view / Broken links rows from the old mock are
 * intentionally NOT shown: there is no scanner, mobile check, or link checker
 * behind them, and the redesign guide says not to fake them. A `na`/`warn` row
 * is presentation only and never blocks publishing.
 */
import { useEffect, useState } from 'react'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { getCmsPublishStatus } from '@core/persistence'
import { Widget } from '@ui/components/Widget'
import { FaIcon } from '@ui/components/FaIcon'
import { usePluginsStats } from '../hooks/useDashboardStats'
import styles from './widgets.module.css'

type ReadinessStatus = 'ok' | 'warn' | 'na'

interface ReadinessRow {
  label: string
  value: string
  status: ReadinessStatus
}

type PublishStatus = Awaited<ReturnType<typeof getCmsPublishStatus>>
type PluginStats = ReturnType<typeof usePluginsStats>

const STATUS_ICON: Record<ReadinessStatus, string> = {
  ok: 'check',
  warn: 'triangle-exclamation',
  na: 'minus',
}

/** Plugin-runtime row from the real `installed_plugins` scan. `null` means the
 * scan is unavailable (loading or forbidden), which we report honestly. */
function pluginRuntimeRow(plugins: PluginStats): ReadinessRow {
  if (plugins === null) {
    return { label: 'Plugin runtime', value: 'Unavailable', status: 'na' }
  }
  if (plugins.errored > 0) {
    return {
      label: 'Plugin runtime',
      value: `${plugins.errored} need attention`,
      status: 'warn',
    }
  }
  if (plugins.total === 0) {
    return { label: 'Plugin runtime', value: 'None installed', status: 'na' }
  }
  return {
    label: 'Plugin runtime',
    value: `${plugins.active} of ${plugins.total} active`,
    status: 'ok',
  }
}

/**
 * Build the readiness rows in the guide's canonical order. Draft sync and
 * plugin runtime are genuine repository state; the rest are honest placeholders
 * until their MMSBUILD adapters exist.
 */
function buildRows(status: PublishStatus, plugins: PluginStats): ReadinessRow[] {
  const upToDate = status.draftMatchesPublished

  return [
    {
      label: 'Domain & SSL',
      value: 'Managed in hosting',
      status: 'na',
    },
    {
      label: 'Draft synchronization',
      value: upToDate ? 'In sync' : 'Changes pending',
      status: upToDate ? 'ok' : 'warn',
    },
    pluginRuntimeRow(plugins),
    {
      label: 'Client approval',
      value: 'Approval not required',
      status: 'na',
    },
    {
      label: 'Backup policy',
      value: 'Not connected',
      status: 'na',
    },
  ]
}

export function PreflightWidget({ span, editing }: DashboardWidgetRendererProps) {
  const [status, setStatus] = useState<PublishStatus | null>(null)
  const { data: plugins } = usePluginsStats()

  useEffect(() => {
    let cancelled = false
    void getCmsPublishStatus()
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch((err) => {
        console.error('[preflight] failed to load publish status:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Gate the card on publish status only — a forbidden/slow plugins endpoint
  // must not freeze the whole checklist; its row degrades to "Unavailable".
  const rows = status ? buildRows(status, plugins) : []

  return (
    <Widget
      widgetId="preflight"
      title="MMSBUILD preflight"
      tint="mint"
      span={span}
      editing={editing}
      className={styles.cardPreflight}
      loading={status === null}
    >
      <ul className={styles.readinessList}>
        {rows.map((row) => (
          <li key={row.label} className={styles.readinessRow} data-status={row.status}>
            <span className={styles.readinessCheck} aria-hidden="true">
              <FaIcon name={STATUS_ICON[row.status]} size={13} />
            </span>
            <span className={styles.readinessLabel}>{row.label}</span>
            <span className={styles.readinessValue}>{row.value}</span>
          </li>
        ))}
      </ul>
    </Widget>
  )
}
