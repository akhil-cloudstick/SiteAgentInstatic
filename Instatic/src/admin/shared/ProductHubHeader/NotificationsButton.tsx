/**
 * NotificationsButton — the second utility in the Product Hub header row.
 *
 * Bell + unread count, per the shared-header contract. The count and list come
 * from `adminNotifications`, whose plugin-health half is derived live from the
 * plugin SSE stream — so the badge lights up the moment a plugin parks, even
 * when the user is on an unrelated admin route.
 *
 * Opening the panel marks everything currently listed as read. Entries stay
 * visible; only the count drops. That distinction matters for the derived
 * plugin entry, which must remain on the list for as long as the plugin is
 * actually down.
 */
import { useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { ContextMenu } from '@ui/components/ContextMenu'
import {
  getAdminNotifications,
  markAdminNotificationsRead,
  subscribeAdminNotifications,
} from '@admin/state/adminNotifications'
import styles from './NotificationsButton.module.css'

/** Badge caps at this value; beyond it the label becomes "N+". */
const BADGE_MAX = 9

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

export function NotificationsButton() {
  const { items, unreadCount } = useSyncExternalStore(
    subscribeAdminNotifications,
    getAdminNotifications,
    getAdminNotifications,
  )
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const badgeLabel = unreadCount > BADGE_MAX ? `${BADGE_MAX}+` : String(unreadCount)
  const ariaLabel = unreadCount === 0
    ? 'Notifications'
    : `Notifications, ${unreadCount} unread`

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
            if (next) markAdminNotificationsRead()
            return next
          })
        }}
      >
        <FaIcon name="bell" size={17} />
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
          {items.length === 0 ? (
            <p className={styles.empty} role="status">You're all caught up.</p>
          ) : (
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
          )}
        </ContextMenu>
      )}
    </>
  )
}
