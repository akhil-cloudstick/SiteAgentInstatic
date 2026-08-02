/**
 * SyncStatusButton — the header's draft-state pill.
 *
 * The approved Site screen shows four states (Draft synced / Connecting /
 * Offline — reconnecting / Sync failed) behind a small popover. In the mock
 * that popover was a state *picker*, because the mock had no server to ask;
 * here it is read-only, because there is no such thing as choosing your own
 * sync state.
 *
 * The decision table lives in `./syncStatus.ts`.
 */
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FaIcon } from '@ui/components/FaIcon'
import { Button } from '@ui/components/Button'
import { ContextMenu } from '@ui/components/ContextMenu'
import type { PersistenceSaveStatus } from '@admin/pages/site/hooks/usePersistence'
import type { PresenceConnectionState } from '@admin/pages/site/hooks/usePresence'
import { resolveSyncStatus } from './syncStatus'
import styles from './SyncStatusButton.module.css'

interface SyncStatusButtonProps {
  connection: PresenceConnectionState
  saveStatus: PersistenceSaveStatus
}

export function SyncStatusButton({ connection, saveStatus }: SyncStatusButtonProps) {
  const status = resolveSyncStatus(connection, saveStatus)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="lg"
        type="button"
        active={open}
        className={styles.pill}
        data-tone={status.tone}
        data-testid="toolbar-sync-status"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <FaIcon name={status.icon} size={16} className={status.spin ? styles.spin : undefined} />
        <span className={styles.label}>{status.label}</span>
      </Button>
      {/* Announce state changes without requiring the popover to be open —
          losing sync is exactly the thing a non-visual user must hear. */}
      <span role="status" aria-live="polite" className={styles.srOnly}>
        {status.label}
      </span>
      {open && typeof document !== 'undefined' && createPortal(
        <ContextMenu
          ariaLabel="Draft state"
          onClose={() => setOpen(false)}
          anchorRef={triggerRef}
          side="bottom"
          align="start"
          width={220}
          zIndex={10000}
        >
          <div className={styles.menuBody}>
            <p className={styles.menuHeading}>Draft state</p>
            <p className={styles.menuLabel} data-tone={status.tone}>
              <FaIcon name={status.icon} size={14} />
              <span>{status.label}</span>
            </p>
            <p className={styles.menuDetail}>{status.detail}</p>
          </div>
        </ContextMenu>,
        document.body,
      )}
    </>
  )
}
