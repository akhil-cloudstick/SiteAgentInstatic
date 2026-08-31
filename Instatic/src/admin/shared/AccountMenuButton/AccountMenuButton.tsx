/**
 * AccountMenuButton — toolbar avatar trigger + account dropdown.
 *
 * The last item in `Toolbar.tsx`'s trailer. Renders a 28×28 circular button
 * showing the user's initials. Clicking opens a compact dropdown:
 *
 *   ┌──────────────────────────────┐
 *   │ Display Name                 │
 *   │ email@example.com            │
 *   │ [OWNER]                      │
 *   ├──────────────────────────────┤
 *   │ Account & security           │  → /cms/account (soft nav)
 *   │ Sign out                     │  → CMS logout, then the HUB's /logout
 *   │ Sign out all devices         │  → POST /auth/logout-all, status inline
 *   └──────────────────────────────┘
 *
 * "Sign out" ends the HUB session, not just the CMS one. Clearing only
 * `instatic_admin_session` leaves `sa_hub` alive, and the hub's silent re-SSO
 * signs the user straight back in — so the sign-out has to land on the hub's
 * /logout. See `signOutEverywhere` in core/persistence/cmsAuth.ts.
 *
 * It deliberately hard-navigates instead of using the router: the post-logout
 * flow needs a fresh app boot so no session state survives in module memory.
 *
 * "Sign out all devices" preserves the current cookie server-side so the
 * user issuing the action stays signed in here. Status is surfaced inline.
 *
 * The button stays signed-out-safe: when there is no current user (admin
 * shell hasn't hydrated yet), the component returns null.
 */
import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@ui/components/Button'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@ui/components/ContextMenu'
import { LockSolidIcon } from 'pixel-art-icons/icons/lock-solid'
import { PowerOffIcon } from 'pixel-art-icons/icons/power-off'
import { MonitorSolidIcon } from 'pixel-art-icons/icons/monitor-solid'
import { useAuthenticatedAdminUser } from '@admin/sessionContext'
import { useAdminNavigate } from '@admin/lib/useAdminNavigate'
import { StepUpCancelledMessage, useStepUp } from '@admin/shared/StepUp'
import { UserAvatar } from '@admin/shared/UserAvatar'
import { useHubContext } from '@admin/state/hubContext'
import { logoutAllOtherCmsSessions, signOutEverywhere } from '@core/persistence'
import styles from './AccountMenuButton.module.css'
import { getErrorMessage } from '@core/utils/errorMessage'

const ACCOUNT_ROUTE = '/cms/account'

export function AccountMenuButton(): ReactNode {
  const user = useAuthenticatedAdminUser()
  const navigate = useAdminNavigate()
  const { runStepUp } = useStepUp()
  const hubContext = useHubContext()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<null | 'logout' | 'logout-all'>(null)
  const [status, setStatus] = useState<{ tone: 'info' | 'error'; message: string } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const displayName = user.displayName.trim() || user.email
  const roleLabel = user.role.name

  function close(): void {
    setOpen(false)
    setStatus(null)
  }

  async function handleSignOut(): Promise<void> {
    if (busy) return
    setBusy('logout')
    setStatus(null)
    try {
      // Signs out of the HUB, not just the CMS — clearing only the CMS cookie
      // leaves `sa_hub` alive, and the hub silently signs the user back in.
      await signOutEverywhere(hubContext?.hubBaseUrl ?? null)
    } catch (err) {
      console.error('[account-menu] sign out failed:', err)
      setBusy(null)
      setStatus({
        tone: 'error',
        message: getErrorMessage(err, 'Could not sign out.'),
      })
    }
  }

  async function handleSignOutAllDevices(): Promise<void> {
    if (busy) return
    setBusy('logout-all')
    setStatus(null)
    try {
      const revokedCount = await runStepUp(() => logoutAllOtherCmsSessions())
      setBusy(null)
      const noun = revokedCount === 1 ? 'device' : 'devices'
      setStatus({
        tone: 'info',
        message: revokedCount === 0
          ? 'No other devices were signed in.'
          : `Signed out ${revokedCount} ${noun}.`,
      })
    } catch (err) {
      setBusy(null)
      // Cancelled step-up is a normal flow, not an error to surface.
      if (err instanceof Error && err.message === StepUpCancelledMessage) return
      console.error('[account-menu] sign out all devices failed:', err)
      setStatus({
        tone: 'error',
        message: getErrorMessage(err, 'Could not sign out other devices.'),
      })
    }
  }

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="xs"
        type="button"
        active={open}
        aria-label={`Account menu for ${displayName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={styles.trigger}
        data-testid="account-menu-trigger"
        data-active={open ? 'true' : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {/* 32px inside the 44px ring: UserAvatar derives its initials from
            `size * 0.4`, so 32 lands on the reference's 13px initials. */}
        <UserAvatar user={user} size={32} initialsOnly alt={null} className={styles.triggerAvatar} />
      </Button>
      {open && typeof document !== 'undefined' && createPortal(
        <ContextMenu
          ariaLabel="Account menu"
          onClose={close}
          anchorRef={triggerRef}
          side="bottom"
          align="end"
          width={240}
          zIndex={10000}
        >
          <header className={styles.header}>
            <span className={styles.headerName}>{displayName}</span>
            <span className={styles.headerEmail}>{user.email}</span>
            <span className={styles.headerRoleRow}>
              <span className={styles.roleBadge}>{roleLabel}</span>
            </span>
          </header>
          <ContextMenuSeparator />
          {/* No Settings item here. Settings is a row-1 utility again under the
              MMSBUILD shared-header contract (Help → Notifications → Theme →
              Settings → Account), which requires each utility to appear exactly
              once in the shell — see `ProductHubHeader/SettingsButton`. */}
          <ContextMenuItem
            onClick={() => {
              close()
              navigate(ACCOUNT_ROUTE)
            }}
            data-testid="account-menu-go-to-account"
          >
            <LockSolidIcon size={12} aria-hidden="true" />
            <span>Account &amp; security</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => void handleSignOut()}
            disabled={busy !== null}
            data-testid="account-menu-sign-out"
          >
            <PowerOffIcon size={12} aria-hidden="true" />
            <span>{busy === 'logout' ? 'Signing out…' : 'Sign out'}</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => void handleSignOutAllDevices()}
            disabled={busy !== null}
            data-testid="account-menu-sign-out-all"
          >
            <MonitorSolidIcon size={12} aria-hidden="true" />
            <span>{busy === 'logout-all' ? 'Signing out other devices…' : 'Sign out all devices'}</span>
          </ContextMenuItem>
          {status && (
            <p
              className={status.tone === 'error' ? `${styles.status} ${styles.statusError}` : styles.status}
              role={status.tone === 'error' ? 'alert' : 'status'}
            >
              {status.message}
            </p>
          )}
        </ContextMenu>,
        document.body,
      )}
    </>
  )
}

