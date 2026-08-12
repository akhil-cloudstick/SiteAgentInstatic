/**
 * NotificationsButton — the second utility in the shared shell's row 1.
 *
 * Bell + unread count, per the shared-header contract. The product owns where
 * the entries come from (a plugin SSE stream in the CMS, the message centre in
 * MMS Design) and hands them in already sorted; the panel itself is shared so
 * an alert reads the same in both products.
 *
 * Opening the panel marks everything currently listed as read. Entries stay
 * visible; only the count drops. That distinction matters for derived entries —
 * "this plugin is down" must remain listed for as long as it actually is.
 */
import { useRef, useState } from 'react'
import { Button } from '../primitives/Button'
import { FaIcon } from '../primitives/FaIcon'
import { ContextMenu } from '../primitives/ContextMenu'
import type { ShellNotifications } from './types'
import styles from './NotificationsButton.module.css'

/** Badge caps at this value; beyond it the label becomes "N+". */
const BADGE_MAX = 9

/**
 * Relative age, computed at render. `Date.now()` is read here rather than
 * passed in because the panel is only mounted while open — a stale "2m ago"
 * cannot survive a close/reopen.
 */
function relativeAge(iso: string): string {
  if (!iso) return ''
  const deltaMs = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return ''
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function NotificationsButton({
  notifications,
  iconSize,
}: {
  notifications: ShellNotifications
  iconSize: number
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { unreadCount, items, panel } = notifications

  const badgeLabel = unreadCount > BADGE_MAX ? `${BADGE_MAX}+` : String(unreadCount)
  const ariaLabel = unreadCount === 0 ? 'Notifications' : `Notifications, ${unreadCount} unread`

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="lg"
        shape="pill"
        iconOnly
        active={open}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        tooltip="Notifications"
        data-testid="hub-header-notifications"
        className={styles.trigger}
        onClick={() => {
          setOpen((current) => {
            const next = !current
            if (next) {
              notifications.onRead?.()
              notifications.onOpen()
            }
            return next
          })
        }}
      >
        <FaIcon name="bell" size={iconSize} />
        {unreadCount > 0 && (
          // aria-hidden: the count is already in the button's accessible name,
          // so exposing the badge again would read it twice.
          <span className={styles.badge} aria-hidden="true" data-testid="hub-header-unread-badge">
            {badgeLabel}
          </span>
        )}
      </Button>
      {open && (
        // ContextMenu portals itself to the body — no wrapper needed here.
        <ContextMenu
          ariaLabel="Notifications"
          onClose={() => setOpen(false)}
          anchorRef={triggerRef}
          side="bottom"
          align="end"
          width={320}
          zIndex={10000}
        >
          <header className={styles.header}>Notifications</header>
          {panel ?? <NotificationList items={items ?? []} />}
        </ContextMenu>
      )}
    </>
  )
}

function NotificationList({ items }: { items: NonNullable<ShellNotifications['items']> }) {
  if (items.length === 0) {
    return (
      <p className={styles.empty} role="status">
        You&rsquo;re all caught up.
      </p>
    )
  }

  return (
    <ul className={styles.list}>
      {items.map((item) => {
        const age = relativeAge(item.at)
        return (
          <li key={item.id} className={styles.item} data-kind={item.kind}>
            <span className={styles.itemTitle}>{item.title}</span>
            <span className={styles.itemBody}>{item.body}</span>
            {age && <span className={styles.itemAge}>{age}</span>}
          </li>
        )
      })}
    </ul>
  )
}
