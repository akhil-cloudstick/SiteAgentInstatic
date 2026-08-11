/**
 * Team Access → Activity.
 *
 * Read-only feed of `audit_events`: every security-sensitive change in the
 * admin area (logins, user/role mutations, plugin lifecycle, publishes),
 * rendered as a sentence-case title, an actor, detail chips, and a timestamp.
 *
 * The actor / target labels are looked up against the *current* users and
 * roles maps, falling back to the snapshot label captured at write time when
 * the related row no longer exists — that is why this panel consumes `users`
 * and `roles` even though it never mutates them.
 *
 * The server returns the newest 100 events with no filters, no pagination and
 * no total, so search is client-side over what is already loaded. That matches
 * the approved screen exactly; do not add a pagination control for data the
 * API does not expose.
 */
import { useRef, useState, type UIEvent } from 'react'
import { FaIcon } from '@ui/components/FaIcon'
import { Input } from '@ui/components/Input'
import { Skeleton } from '@ui/components/Skeleton'
import type { CmsAuditEvent } from '@core/persistence'
import { StatusChip } from '../components/StatusChip/StatusChip'
import { auditActor, auditDetails, auditTitle } from '../utils/audit'
import { formatDateTime } from '../utils/format'
import type { UsersPageData } from '../hooks/useUsersPageData'
import styles from './ActivityPanel.module.css'

/**
 * Glyph for an event, chosen by action family so a new action id gets a
 * sensible default rather than a missing icon.
 */
function activityIcon(action: string): string {
  if (action.startsWith('login')) return 'user'
  if (action === 'logout') return 'right-from-bracket'
  if (action.startsWith('password')) return 'key'
  if (action === 'user.suspend') return 'user-lock'
  if (action === 'user.create') return 'user-plus'
  if (action.startsWith('user.')) return 'user-gear'
  if (action.startsWith('role.')) return 'shield-halved'
  if (action.startsWith('plugin.')) return 'puzzle-piece'
  if (action.startsWith('ai.')) return 'wand-magic-sparkles'
  if (action.startsWith('data.')) return 'database'
  if (action === 'publish') return 'bolt'
  return 'user-gear'
}

/**
 * Rows rendered per page. The server hands us the newest 100 events in one
 * response, so this is a RENDER budget, not a fetch one: painting 100 rows —
 * each with a title derived through the user and role maps — is the slow part,
 * and the operator only ever looks at the top of the list first.
 */
const PAGE_SIZE = 10

export function ActivityPanel({ data }: { data: UsersPageData }) {
  const { users, roles, events } = data
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const scrollRef = useRef<HTMLDivElement>(null)

  const usersById = new Map(users.map((user) => [user.id, user]))
  const rolesById = new Map(roles.map((role) => [role.id, role]))

  function describe(event: CmsAuditEvent) {
    return {
      title: auditTitle(event, usersById, rolesById),
      actor: auditActor(event, usersById),
      details: auditDetails(event, rolesById),
    }
  }

  const query = search.trim().toLowerCase()
  const rows = events.map((event) => ({ event, ...describe(event) }))
  const matching = query
    ? rows.filter(({ title, actor, details }) =>
      `${title} ${actor} ${details.join(' ')}`.toLowerCase().includes(query))
    : rows
  const visible = matching.slice(0, visibleCount)
  const hasMore = visible.length < matching.length

  /** Load the next page once the reader is within one page of the end. */
  function onScroll(event: UIEvent<HTMLDivElement>): void {
    if (!hasMore) return
    const el = event.currentTarget
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
    if (remaining > el.clientHeight) return
    setVisibleCount((current) => current + PAGE_SIZE)
  }

  function onSearchChange(value: string): void {
    setSearch(value)
    // A new query is a new list; carrying the old page depth over would show
    // an arbitrary slice of the matches.
    setVisibleCount(PAGE_SIZE)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  return (
    <section
      id="panel-activity"
      role="tabpanel"
      aria-labelledby="tab-activity"
      className={styles.panel}
    >
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h2 id="activity-title">Access activity</h2>
          <p>Read-only account, role and security events for this site.</p>
        </div>
        <StatusChip tone="neutral">
          <FaIcon name="lock" size={12} />
          <span>Audit log</span>
        </StatusChip>
      </header>

      <div className={styles.searchControl}>
        <FaIcon name="magnifying-glass" size={16} className={styles.searchGlyph} />
        <Input
          type="search"
          aria-label="Search access activity"
          placeholder="Search events, actors or details"
          value={search}
          disabled={data.loading}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
        />
      </div>

      <div className={styles.scroller} ref={scrollRef} onScroll={onScroll}>
      <table
        className={styles.table}
        aria-label="Access activity"
        aria-busy={data.loading || undefined}
      >
        <thead className={styles.head}>
          <tr className={styles.headRow}>
            <th scope="col">Event</th>
            <th scope="col">Actor</th>
            <th scope="col">Details</th>
            <th scope="col">Time</th>
          </tr>
        </thead>
        <tbody>
          {data.loading
            ? Array.from({ length: 4 }, (_, index) => (
              <tr key={`skeleton-${index}`} className={styles.row}>
                <td className={styles.eventCell}>
                  <span className={styles.mark} />
                  <Skeleton width={190} height={14} />
                </td>
                <td><Skeleton width={130} height={12} /></td>
                <td><Skeleton width={90} height={29} radius={7} /></td>
                <td><Skeleton width={110} height={12} /></td>
              </tr>
            ))
            : visible.map(({ event, title, actor, details }) => (
              <tr key={event.id} className={styles.row}>
                <td className={styles.eventCell}>
                  <span className={styles.mark}>
                    <FaIcon name={activityIcon(event.action)} size={15} />
                  </span>
                  <strong>{title}</strong>
                </td>
                <td className={styles.actor}>{actor}</td>
                <td className={styles.details}>
                  {details.map((detail) => (
                    <StatusChip key={detail} tone="neutral">{detail}</StatusChip>
                  ))}
                </td>
                <td className={styles.time}>
                  <time>{formatDateTime(event.createdAt)}</time>
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      {hasMore && (
        <p className={styles.moreHint} aria-live="polite">
          Showing {visible.length} of {matching.length} — scroll for more
        </p>
      )}
      </div>

      {!data.loading && visible.length === 0 && (
        <div className={styles.emptyRow}>
          <FaIcon name="clock-rotate-left" size={28} className={styles.emptyGlyph} />
          <strong>{events.length > 0 ? 'No matching activity' : 'No audit events yet'}</strong>
          <p>
            {events.length > 0
              ? 'Change the search to review other access events.'
              : 'Security and access changes across the admin area will appear here.'}
          </p>
        </div>
      )}
    </section>
  )
}
