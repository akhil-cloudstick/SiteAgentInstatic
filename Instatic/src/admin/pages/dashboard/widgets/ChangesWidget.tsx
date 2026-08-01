/**
 * "Changes in this version" widget (MMSBUILD "Live Release Desk", Screen 1).
 *
 * The per-version change manifest, rendered exactly as the approved screen
 * draws it: a count badge beside the title, then rows of icon well /
 * title + location / status chip / timestamp / chevron.
 *
 * The rows are REAL. Instatic has no revision-manifest table, but it does
 * have `audit_events` and an `action = 'publish'` boundary, so the server
 * reader (`server/handlers/cms/dashboard/changes.ts`) slices the audit
 * trail at the most recent publish — everything after it is, by
 * definition, in the draft but not yet live. Nothing is fabricated.
 *
 * When the slice is empty (a freshly-published site with no edits since)
 * the card falls back to the reference's own `.empty-state`.
 */
import { FileTextSolidIcon } from 'pixel-art-icons/icons/file-text-solid'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '@ui/components/Widget'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { useNavigate } from '@admin/lib/routing'
import {
  useChangeManifestStats,
  type DashboardChangeEntry,
} from '../hooks/useDashboardStats'
import styles from './widgets.module.css'

/** Status chip copy, per the reference's Added / Updated labels. */
const KIND_LABEL: Record<DashboardChangeEntry['kind'], string> = {
  added: 'Added',
  updated: 'Updated',
  removed: 'Removed',
}

/**
 * "Today, 11:24 AM" / "Yesterday, 4:02 PM" / "Mar 3, 9:15 AM" — the same
 * absolute format the Recent activity strip uses, so the two cards read
 * as one timeline.
 */
function formatChangeTime(iso: string): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return ''
  const date = new Date(ts)
  const time = date
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .replace(/\s?([ap]\.?m\.?)$/i, (_m, meridiem: string) => ` ${meridiem.toUpperCase()}`)

  const now = new Date()
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`

  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`
}

export function ChangesWidget({ span, editing }: DashboardWidgetRendererProps) {
  const { data: stats, loading } = useChangeManifestStats()
  const navigate = useNavigate()
  const isLoading = loading
  const rows = stats?.rows ?? []
  const isEmpty = !isLoading && rows.length === 0

  return (
    <Widget
      widgetId="changes"
      title="Changes in this version"
      icon={FileTextSolidIcon}
      tint="lilac"
      span={span}
      editing={editing}
      className={styles.cardChanges}
      loading={isLoading}
      action={
        stats && stats.total > 0 ? (
          <span className={styles.countBadge}>{stats.total}</span>
        ) : undefined
      }
    >
      {isEmpty ? (
        // One calm state whether the slice was genuinely empty or the
        // request didn't answer — see WidgetPlaceholder on why we don't
        // hand the user our plumbing.
        <div className={styles.emptyState} role="status" data-reason={stats ? 'empty' : 'unavailable'}>
          <FaIcon name="file-circle-plus" size={24} className={styles.emptyIcon} />
          <strong className={styles.emptyTitle}>No changes in this version</strong>
          <span className={styles.emptyDetail}>
            {stats?.since
              ? 'Everything in your draft is already published. New edits show up here.'
              : 'Edits, additions, and removals show up here as you work.'}
          </span>
        </div>
      ) : (
        <ul className={styles.changeList}>
          {rows.map((change) => (
            <li key={change.id} className={styles.changeRow} data-kind={change.kind}>
              <span className={styles.changeIcon} aria-hidden="true">
                <FaIcon name={change.icon} size={16} />
              </span>
              <span className={styles.changeCopy}>
                <strong className={styles.changeTitle}>{change.title}</strong>
                <small className={styles.changeLocation}>{change.location}</small>
              </span>
              <span className={styles.changeStatus}>{KIND_LABEL[change.kind]}</span>
              <time className={styles.changeTime} dateTime={change.createdAt}>
                {formatChangeTime(change.createdAt)}
              </time>
              {/* The reference's row chevron. It opens the surface the change
                  happened on — the site editor — rather than a per-change
                  detail view, which Instatic has no route for. */}
              <Button
                variant="ghost"
                iconOnly
                className={styles.changeOpen}
                aria-label={`Open ${change.title}`}
                onClick={() => navigate('/admin/site')}
              >
                <FaIcon name="chevron-right" size={13} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  )
}
