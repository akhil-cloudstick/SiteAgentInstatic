/**
 * Activity widget — recent edits, publishes, plugin lifecycle, and
 * user/role changes pulled from `audit_events`. Reads from
 * `useRecentActivityStats()`, its own dashboard endpoint, so slower
 * audit projections do not block the other widgets from rendering.
 *
 * Login/logout events are intentionally excluded server-side — those
 * belong in Account → Sign-in history. The widget is about
 * *operational* changes to the site.
 */
import { DashboardSolidIcon } from 'pixel-art-icons/icons/dashboard-solid'
import type { ReactNode } from 'react'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { UserAvatar } from '@admin/shared/UserAvatar'
import { useCurrentAdminUser } from '@admin/sessionContext'
import { hasCapability } from '@admin/access'
import { useNavigate } from '@admin/lib/routing'
import { queuePendingAction } from '@admin/spotlight/pendingAction'
import { Widget } from '@ui/components/Widget'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { cn } from '@ui/cn'
import {
  useRecentActivityStats,
  type DashboardActivityEntry,
} from '../hooks/useDashboardStats'
import styles from './widgets.module.css'

/**
 * Diameter of the actor avatar in the timeline node. Sized to the approved
 * Recent-activity design (avatar sits left of the actor name). The
 * `<UserAvatar>` primitive double-scales the requested size for the Gravatar
 * URL, so a 34px CSS avatar fetches a 68px image — crisp on retina.
 */
const AVATAR_SIZE = 34

/**
 * The strip shows only the newest events as equal, non-scrolling columns —
 * four fits the full-width tile cleanly. The server returns more; we cap here
 * and "View all activity" links to the full audit log.
 */
const MAX_TIMELINE_ITEMS = 4

/**
 * Pick the verb that fronts each row body. The server has already
 * resolved the target into `targetCode` / `targetText`; this only
 * picks the right English verb for the action.
 *
 * Unknown / future actions fall through to a humanised version of
 * the action string itself ("plugin.foobar" → "plugin foobar") so a
 * newly-added audit event still renders something useful before the
 * widget is updated.
 */
function actionVerb(action: string): string {
  switch (action) {
    case 'data.row.create':
      return 'created'
    case 'data.row.update':
      return 'edited'
    case 'data.row.delete':
      return 'deleted'
    case 'data.row.publish':
      return 'published'
    case 'data.row.schedule':
      return 'scheduled'
    case 'data.row.schedule.cancel':
      return 'unscheduled'
    case 'data.row.status':
      return 'changed status of'
    case 'data.row.move':
      return 'moved'
    case 'data.author.assign':
      return 'reassigned author of'
    case 'data.table.create':
      return 'created collection'
    case 'data.table.update':
      return 'edited collection'
    case 'data.table.delete':
      return 'deleted collection'
    case 'publish':
      return 'published the site'
    case 'plugin.install':
      return 'installed plugin'
    case 'plugin.update':
      return 'updated plugin'
    case 'plugin.enable':
      return 'enabled plugin'
    case 'plugin.disable':
      return 'disabled plugin'
    case 'plugin.delete':
      return 'removed plugin'
    case 'plugin.pack.install':
      return 'installed plugin pack'
    case 'plugin.settings.update':
      return 'updated settings for'
    case 'user.create':
      return 'added user'
    case 'user.update':
      return 'updated user'
    case 'user.delete':
      return 'removed user'
    case 'user.suspend':
      return 'suspended user'
    case 'password.change':
      return 'changed password for'
    case 'role.create':
      return 'created role'
    case 'role.update':
      return 'updated role'
    case 'role.delete':
      return 'removed role'
    case 'role.assign':
      return 'assigned role'
    default:
      return action.replace(/[._]/g, ' ')
  }
}

/**
 * The audit target ("Section: Hero" in the reference) drops to its own
 * clipped second line under the actor row. Returns `null` when the event
 * carries no target, in which case the node is a single line.
 */
function renderTarget(entry: DashboardActivityEntry): ReactNode {
  if (entry.targetCode) return <code>{entry.targetCode}</code>
  if (entry.targetText) return <em>{entry.targetText}</em>
  return null
}

/**
 * Absolute timestamp for a timeline node — "Today, 11:24 AM",
 * "Yesterday, 4:02 PM", or "Mar 3, 9:15 AM" for older events. Matches the
 * approved Recent-activity design (sans, mixed-case), rather than the mono
 * relative label the other widgets use.
 */
function formatActivityTime(iso: string): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return ''
  const date = new Date(ts)
  // Uppercase the meridiem ("11:24 am" → "11:24 AM") to match the design; some
  // locales lower-case it by default.
  const time = date
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .replace(/\s?([ap]\.?m\.?)$/i, (_m, meridiem: string) => ` ${meridiem.toUpperCase()}`)

  const now = new Date()
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`

  const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${day}, ${time}`
}

export function ActivityWidget({ span, editing }: DashboardWidgetRendererProps) {
  const { data: stats, loading } = useRecentActivityStats()
  const navigate = useNavigate()
  const currentUser = useCurrentAdminUser()
  const rows = stats?.rows ?? []
  const isLoading = loading
  const isEmpty = !isLoading && rows.length === 0

  // The full audit log lives in Users → Audit (same `audit.read` capability
  // the activity endpoint requires). Unrestricted sessions (no current user)
  // always see it; otherwise gate on the capability so we never link to a tab
  // the viewer can't open.
  const canReadAudit = !currentUser || hasCapability(currentUser, 'audit.read')

  function viewAllActivity(): void {
    // Deep-link to the Audit tab via the cross-workspace pending-action bus —
    // the Users page reads this on mount and selects the Audit tab.
    queuePendingAction('users.viewAudit')
    navigate('/admin/users')
  }

  return (
    <Widget
      widgetId="activity"
      title="Recent activity"
      icon={DashboardSolidIcon}
      tint="peach"
      span={span}
      editing={editing}
      className={styles.cardActivity}
      loading={isLoading}
    >
      {isEmpty ? (
        <p className={cn(styles.feedTime, styles.feedEmpty)}>
          Nothing yet — your recent changes show up here.
        </p>
      ) : (
        <>
          <ol className={styles.feed}>
            {rows.slice(0, MAX_TIMELINE_ITEMS).map((r, i) => {
              const target = renderTarget(r)
              return (
                <li key={r.id} className={styles.feedRow}>
                  {/* Newest event is the green circle-check; the rest are
                      flat grey discs — `.timeline-dot` in the reference. */}
                  <span
                    className={cn(styles.feedMarker, i === 0 && styles.feedMarkerActive)}
                    aria-hidden="true"
                  >
                    <FaIcon name={i === 0 ? 'circle-check' : 'circle'} size={15} />
                  </span>
                  <div>
                    <time className={styles.feedTimestamp} dateTime={r.createdAt}>
                      {formatActivityTime(r.createdAt)}
                    </time>
                    <span className={styles.feedEntry}>
                      {r.actor ? (
                        <UserAvatar
                          user={r.actor}
                          size={AVATAR_SIZE}
                          initialsOnly
                          className={styles.feedAvatar}
                          alt={`Avatar for ${r.actor.displayName || r.actor.email}`}
                        />
                      ) : (
                        <span className={styles.feedSystemAvatar} title="System" aria-hidden="true">
                          <FaIcon name="gear" size={14} />
                        </span>
                      )}
                      <span className={styles.feedBody}>
                        <strong className={styles.feedActor}>
                          {r.actor ? r.actor.displayName || r.actor.email : 'System'}
                        </strong>{' '}
                        {actionVerb(r.action)}
                        {target && <small className={styles.feedTarget}>{target}</small>}
                      </span>
                    </span>
                  </div>
                </li>
              )
            })}
          </ol>
          {canReadAudit && (
            <Button
              variant="ghost"
              className={styles.viewAllBtn}
              onClick={viewAllActivity}
            >
              View all activity
              <FaIcon name="arrow-right" size={14} />
            </Button>
          )}
        </>
      )}
    </Widget>
  )
}
