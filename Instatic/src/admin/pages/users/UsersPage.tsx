/**
 * UsersPage — `/cms/users`, the Team Access workspace.
 *
 * A pixel-match reproduction of the approved MMSBUILD "Adaptive Team Access
 * Workspace" screen. Treat that screen as the specification; the visual
 * contract and the deliberate deviations are documented in
 * `docs/features/auth-and-access.md` and guarded by
 * `src/__tests__/architecture/usersScreenFidelity.test.ts`.
 *
 * The page itself stays a thin shell: it figures out which of the three states
 * the current admin is allowed to see (`users.manage`, `roles.manage`,
 * `audit.read`), loads the underlying data once via `useUsersPageData`, and
 * delegates rendering to the per-state panels in `./panels/`.
 *
 * People, Roles and Activity are three STATES of one workspace, not three
 * pages — hence one tablist, one data load, and one heading band.
 *
 * `data-editor-screen="users"` scopes the approved palette and geometry (see
 * the matching block in `src/styles/globals.css`). It sits on the workspace
 * body, never on the shell, so the two shared header rows keep the Dashboard
 * palette — the re-skin is body-scoped.
 */
import { useEffect, useEffectEvent, useState } from 'react'
import { peekPendingAction, consumePendingAction } from '@admin/spotlight/pendingAction'
import { BRAND_NAME } from '@core/brand'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { AdminPageLayout } from '@admin/layouts/AdminPageLayout'
import { ConfirmDeleteProvider } from '@admin/shared/dialogs/ConfirmDeleteDialog'
import { hasCapability } from '@admin/access'
import { useCurrentAdminUser } from '@admin/sessionContext'
import { ActivityPanel } from './panels/ActivityPanel'
import { RolesPanel } from './panels/RolesPanel'
import { PeoplePanel } from './panels/PeoplePanel'
import { WorkspaceTabs } from './components/WorkspaceTabs/WorkspaceTabs'
import { useUsersPageData } from './hooks/useUsersPageData'
import type { Tab, UsersPageLoadAccess } from './types'
import styles from './UsersPage.module.css'

export function UsersPage() {
  const currentUser = useCurrentAdminUser()
  const unrestricted = !currentUser
  const canManageUsers = unrestricted || hasCapability(currentUser, 'users.manage')
  const canManageRoles = unrestricted || hasCapability(currentUser, 'roles.manage')
  const canReadAudit = unrestricted || hasCapability(currentUser, 'audit.read')
  const canReadRoleOptions = canManageUsers || canManageRoles

  const loadAccess: UsersPageLoadAccess = { canManageUsers, canReadRoleOptions, canReadAudit }
  const data = useUsersPageData(loadAccess)

  const availableTabs: Tab[] = []
  if (canManageUsers) availableTabs.push('people')
  if (canManageRoles) availableTabs.push('roles')
  if (canReadAudit) availableTabs.push('activity')

  const [tab, setTab] = useState<Tab>('people')
  const activeTab = availableTabs.includes(tab) ? tab : availableTabs[0] ?? 'people'

  // The create-account sheet is owned here rather than by PeoplePanel: the
  // page header's primary action opens it, and a cross-workspace spotlight
  // action can open it before the panel has mounted.
  const [createOpen, setCreateOpen] = useState(false)

  // Cross-workspace spotlight actions can target this page. Peek (don't
  // consume) at the pending action so the appropriate state is selected before
  // the panel itself mounts and consumes the action. Microtask defer to keep
  // the setState off the commit phase without risking the macrotask race
  // that setTimeout(0) would expose to fast cross-page navigations.
  //
  // useEffectEvent reads the latest availableTabs at mount-fire time without
  // making the effect dependent on it (rebinding tabs while the page is
  // already mounted shouldn't re-trigger the pending-action routing).
  const consumePendingTabSelection = useEffectEvent(() => {
    const newRolePending =
      peekPendingAction('users.newRole') && availableTabs.includes('roles')
    const invitePending =
      peekPendingAction('users.invite') && availableTabs.includes('people')
    // "View all activity" (from the dashboard Activity widget) deep-links to
    // the Activity state. Unlike invite/newRole — which the receiving surface
    // consumes to open a dialog — there is no follow-up action here, so we
    // consume it right after selecting the state.
    const viewAuditPending =
      peekPendingAction('users.viewAudit') && availableTabs.includes('activity')
    if (!newRolePending && !invitePending && !viewAuditPending) return
    queueMicrotask(() => {
      if (newRolePending) setTab('roles')
      else if (invitePending) setTab('people')
      else if (viewAuditPending) {
        setTab('activity')
        consumePendingAction('users.viewAudit')
      }
    })
  })
  useEffect(() => {
    consumePendingTabSelection()
  }, [])

  // Same guard as the old UsersTab: only spend the queued invite once the
  // capability is known, or openCreate's guard would swallow it for nothing.
  const consumeInvitePending = useEffectEvent(() => {
    if (!consumePendingAction('users.invite')) return
    queueMicrotask(() => setCreateOpen(true))
  })
  useEffect(() => {
    if (!canManageUsers) return
    consumeInvitePending()
  }, [canManageUsers])

  function selectTab(next: Tab): void {
    if (next === activeTab) return
    setCreateOpen(false)
    setTab(next)
  }

  return (
    <AdminPageLayout workspace="users" mode="users">
      {/* The workbench's discard-unsaved and delete-role guards dispatch
          through this. `AdminPageLayout` does not mount it (the canvas layouts
          do), and without a provider `useConfirmDelete` falls back to running
          the action immediately — which for a discard guard means losing the
          edits silently. */}
      <ConfirmDeleteProvider>
      <div className={styles.workspaceScope} data-editor-screen="users">
        <main className={styles.workspace} id="team-access-main">
          <header className={styles.heading}>
            <div className={styles.headingCopy}>
              {/* The product name comes from `@core/brand`, the single
                  white-label surface — the approved screen's literal product
                  string would be the only place in the admin that hardcodes
                  it. */}
              <p className={styles.eyebrow}>{BRAND_NAME} · BACKSTAGE ACCESS</p>
              <h1 id="users-title">Team access</h1>
              <p className={styles.headingLede}>Manage who can work on this website.</p>
            </div>

            {availableTabs.length > 1 && (
              <div className={styles.headingTabs}>
                <WorkspaceTabs tabs={availableTabs} active={activeTab} onChange={selectTab} />
              </div>
            )}

            <div className={styles.headingAction}>
              {activeTab === 'people' && canManageUsers && (
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  className={styles.primaryAction}
                  onClick={() => setCreateOpen(true)}
                >
                  <FaIcon name="user-plus" size={15} />
                  <span>Create account</span>
                </Button>
              )}
              {activeTab === 'roles' && (
                <p className={styles.headingNote}>
                  <FaIcon name="lock" size={12} />
                  <span>Owner access is locked and cannot be edited.</span>
                </p>
              )}
              {activeTab === 'activity' && (
                <p className={styles.headingNote}>
                  <FaIcon name="lock" size={12} />
                  <span>Read-only audit evidence</span>
                </p>
              )}
            </div>
          </header>

          {data.error && <p className={styles.error} role="alert">{data.error}</p>}

          {/* Each panel owns its own skeleton, matching its real layout 1:1 so
              the column ladder stays put when the data arrives. */}
          {activeTab === 'people' && (
            <PeoplePanel
              data={data}
              canManageUsers={canManageUsers}
              createOpen={createOpen}
              onOpenCreate={() => setCreateOpen(true)}
              onCloseCreate={() => setCreateOpen(false)}
            />
          )}
          {activeTab === 'roles' && (
            <RolesPanel
              data={data}
              canManageRoles={canManageRoles}
              canManageUsers={canManageUsers}
              onViewActivity={canReadAudit ? () => selectTab('activity') : null}
            />
          )}
          {activeTab === 'activity' && <ActivityPanel data={data} />}
        </main>
      </div>
      </ConfirmDeleteProvider>
    </AdminPageLayout>
  )
}
