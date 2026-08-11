/**
 * Team Access → People.
 *
 * The approved screen's roster: a filter band fused to a five-column table of
 * every CMS account, showing identity, access (status + role), security (MFA),
 * last login, and the row actions. The owner row carries a protected notice
 * instead of a menu — owner accounts are permanent and immutable from this UI.
 *
 * Every mutation goes through `runStepUp` so the server-side step-up auth gate
 * gets a chance to re-prompt for the admin's password when the session has no
 * fresh window. Cancelling the step-up dialog resolves silently (we match on
 * `StepUpCancelledMessage`).
 *
 * Filtering is client-side over the already-loaded collection — no new
 * endpoint and no parallel directory. Every field it filters on is real:
 * `status`, `role.id` and `mfaEnabled` all ship on every row of `GET /users`.
 */
import { useState, type FormEvent } from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { Input } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { Skeleton, SkeletonCircle } from '@ui/components/Skeleton'
import { pushToast } from '@ui/components/Toast'
import {
  createCmsUser,
  deleteCmsUser,
  updateCmsUser,
  type CmsCurrentUser,
} from '@core/persistence'
import { StepUpCancelledMessage, useStepUp } from '@admin/shared/StepUp'
import { UserAvatar } from '@admin/shared/UserAvatar'
import { getErrorMessage } from '@core/utils/errorMessage'
import { StatusChip } from '../components/StatusChip/StatusChip'
import { RowActionMenu } from '../components/RowActionMenu'
import { UserDialog } from '../components/UserDialog'
import { CreateAccountSheet } from '../components/CreateAccountSheet/CreateAccountSheet'
import {
  displayUserName,
  formatDateTime,
  isOwnerUser,
  statusLabel,
} from '../utils/format'
import { avatarTone, mfaChipTone, roleChipTone, statusChipTone } from '../utils/tones'
import {
  emptyUserForm,
  type AvatarTone,
  type UserDialogMode,
  type UserFormState,
} from '../types'
import type { UsersPageData } from '../hooks/useUsersPageData'
import styles from './PeoplePanel.module.css'

interface PeoplePanelProps {
  data: UsersPageData
  canManageUsers: boolean
  createOpen: boolean
  onOpenCreate: () => void
  onCloseCreate: () => void
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active', textValue: 'Active' },
  { value: 'suspended', label: 'Suspended', textValue: 'Suspended' },
] as const

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All status', textValue: 'All status' },
  { value: 'active', label: 'Active', textValue: 'Active' },
  { value: 'suspended', label: 'Suspended', textValue: 'Suspended' },
]

const SECURITY_FILTER_OPTIONS = [
  { value: 'all', label: 'All security', textValue: 'All security' },
  { value: 'mfa', label: 'MFA on', textValue: 'MFA on' },
  { value: 'no-mfa', label: 'MFA off', textValue: 'MFA off' },
]

/** Static lookup so the tone class survives CSS-module hashing. */
const AVATAR_TONE_CLASS: Record<AvatarTone, string> = {
  green: styles.avatarGreen,
  blue: styles.avatarBlue,
  violet: styles.avatarViolet,
  orange: styles.avatarOrange,
}

/**
 * Edit / reset-password save. Create has its own path (`handleCreate` below)
 * because the side sheet owns its own validation and error surface — folding
 * both into one function meant a `mode` branch on every argument.
 */
async function saveUser(
  dialogMode: Exclude<UserDialogMode, 'create'>,
  editingUserId: string | null,
  userForm: UserFormState,
  runStepUp: <T>(action: () => Promise<T>) => Promise<T>,
  setUsers: (updater: (current: CmsCurrentUser[]) => CmsCurrentUser[]) => void,
  closeDialog: () => void,
  refresh: () => void,
  setBusy: (busy: boolean) => void,
  setError: (error: string | null) => void,
): Promise<void> {
  setBusy(true)
  setError(null)
  try {
    if (!editingUserId) throw new Error('No user selected')
    if (dialogMode === 'reset') {
      await runStepUp(() => updateCmsUser(editingUserId, { password: userForm.password }))
    } else {
      const user = await runStepUp(() => updateCmsUser(editingUserId, {
        email: userForm.email,
        displayName: userForm.displayName,
        roleId: userForm.roleId,
        status: userForm.status,
        ...(userForm.password ? { password: userForm.password } : {}),
      }))
      setUsers((current) => current.map((candidate) => candidate.id === user.id ? user : candidate))
    }
    closeDialog()
    void refresh()
  } catch (err) {
    if (err instanceof Error && err.message === StepUpCancelledMessage) return
    setError(getErrorMessage(err, 'Could not save user'))
  } finally {
    setBusy(false)
  }
}

async function toggleUserStatus(
  user: CmsCurrentUser,
  runStepUp: <T>(action: () => Promise<T>) => Promise<T>,
  setUsers: (updater: (current: CmsCurrentUser[]) => CmsCurrentUser[]) => void,
  refresh: () => void,
  setBusy: (busy: boolean) => void,
): Promise<void> {
  setBusy(true)
  const suspending = user.status === 'active'
  try {
    const updated = await runStepUp(() => updateCmsUser(user.id, {
      status: suspending ? 'suspended' : 'active',
    }))
    setUsers((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate))
    void refresh()
  } catch (err) {
    if (err instanceof Error && err.message === StepUpCancelledMessage) return
    // An operation the user triggered that then failed: toast it. Inline
    // `role="alert"` is reserved for field-local validation inside a form.
    pushToast({
      kind: 'error',
      title: suspending ? 'Could not suspend account' : 'Could not activate account',
      body: getErrorMessage(err, 'Could not update user'),
    })
  } finally {
    setBusy(false)
  }
}

async function deleteUser(
  user: CmsCurrentUser,
  runStepUp: <T>(action: () => Promise<T>) => Promise<T>,
  setUsers: (updater: (current: CmsCurrentUser[]) => CmsCurrentUser[]) => void,
  refresh: () => void,
  setBusy: (busy: boolean) => void,
): Promise<void> {
  setBusy(true)
  try {
    await runStepUp(() => deleteCmsUser(user.id))
    setUsers((current) => current.filter((candidate) => candidate.id !== user.id))
    void refresh()
  } catch (err) {
    if (err instanceof Error && err.message === StepUpCancelledMessage) return
    pushToast({
      kind: 'error',
      title: 'Could not delete account',
      body: getErrorMessage(err, 'Could not delete user'),
    })
  } finally {
    setBusy(false)
  }
}

export function PeoplePanel({
  data,
  canManageUsers,
  createOpen,
  onOpenCreate,
  onCloseCreate,
}: PeoplePanelProps) {
  const { users, roles, defaultAssignableRoleId, setUsers, setError, refresh, error } = data
  const { runStepUp } = useStepUp()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [securityFilter, setSecurityFilter] = useState('all')

  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [userForm, setUserForm] = useState<UserFormState>(() => ({
    ...emptyUserForm,
    roleId: defaultAssignableRoleId,
  }))
  const [dialogMode, setDialogMode] = useState<Exclude<UserDialogMode, 'create'> | null>(null)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)

  // The Owner role is setup-only — the server rejects assigning it, so it is
  // never an option here.
  const assignableRoles = roles.filter((role) => role.slug !== 'owner')
  const assignableRoleOptions = assignableRoles.map((role) => ({
    value: role.id,
    label: role.name,
    textValue: role.name,
  }))
  const roleFilterOptions = [
    { value: 'all', label: 'All roles', textValue: 'All roles' },
    ...assignableRoleOptions,
  ]

  const query = search.trim().toLowerCase()
  const visibleUsers = users.filter((user) => {
    const haystack = `${displayUserName(user)} ${user.email}`.toLowerCase()
    if (query && !haystack.includes(query)) return false
    if (statusFilter !== 'all' && user.status !== statusFilter) return false
    if (roleFilter !== 'all' && user.role.id !== roleFilter) return false
    if (securityFilter === 'mfa' && !user.mfaEnabled) return false
    if (securityFilter === 'no-mfa' && user.mfaEnabled) return false
    return true
  })

  function closeDialog(): void {
    setDialogMode(null)
    setEditingUserId(null)
    setUserForm({ ...emptyUserForm, roleId: defaultAssignableRoleId })
  }

  function openDialogFor(user: CmsCurrentUser, mode: Exclude<UserDialogMode, 'create'>): void {
    if (!canManageUsers || isOwnerUser(user)) return
    setEditingUserId(user.id)
    setUserForm({
      email: user.email,
      displayName: user.displayName,
      password: '',
      roleId: user.role.slug === 'owner' ? defaultAssignableRoleId : user.role.id,
      status: user.status,
    })
    setDialogMode(mode)
    setError(null)
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!canManageUsers || !dialogMode) return
    if ((dialogMode === 'reset' || userForm.password) && userForm.password.length < 12) {
      setError('Password must be at least 12 characters')
      return
    }
    await saveUser(
      dialogMode, editingUserId, userForm, runStepUp, setUsers,
      closeDialog, refresh, setBusy, setError,
    )
  }

  /**
   * Direct creation — no invitation queue. The account is active immediately
   * and no email is sent; the operator shares the initial password out of band.
   */
  async function handleCreate(form: UserFormState): Promise<void> {
    if (!canManageUsers) return
    setBusy(true)
    setCreateError(null)
    try {
      const user = await runStepUp(() => createCmsUser({
        email: form.email.trim(),
        displayName: form.displayName.trim(),
        password: form.password,
        roleId: form.roleId,
      }))
      setUsers((current) => [...current, user])
      onCloseCreate()
      void refresh()
      pushToast({
        kind: 'success',
        title: 'Account created',
        body: `${displayUserName(user)} was created as an active CMS account. No email was sent.`,
      })
    } catch (err) {
      if (err instanceof Error && err.message === StepUpCancelledMessage) return
      // Kept inline rather than toasted: the sheet stays open on failure and
      // the message belongs beside the fields the operator must correct
      // (duplicate email, rejected password). Same treatment `UserDialog` gives
      // its own save errors.
      setCreateError(getErrorMessage(err, 'Could not create account'))
    } finally {
      setBusy(false)
    }
  }

  function closeCreate(): void {
    setCreateError(null)
    onCloseCreate()
  }

  const rosterIsEmpty = !data.loading && visibleUsers.length === 0
  const emptyBecauseFiltered = rosterIsEmpty && users.length > 0

  return (
    <section
      id="panel-people"
      role="tabpanel"
      aria-labelledby="tab-people"
      className={styles.panel}
    >
      <div className={styles.controls}>
        <div className={styles.searchControl}>
          <FaIcon name="magnifying-glass" size={16} className={styles.searchGlyph} />
          <Input
            type="search"
            aria-label="Search team members"
            placeholder="Search team members…"
            value={search}
            disabled={data.loading}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </div>

        <Select
          aria-label="Filter by account status"
          value={statusFilter}
          options={STATUS_FILTER_OPTIONS}
          disabled={data.loading}
          className={styles.filterSelect}
          menuClassName={styles.selectMenu}
          onChange={(event) => setStatusFilter(event.currentTarget.value)}
        />
        <Select
          aria-label="Filter by role"
          value={roleFilter}
          options={roleFilterOptions}
          disabled={data.loading}
          className={styles.filterSelect}
          menuClassName={styles.selectMenu}
          onChange={(event) => setRoleFilter(event.currentTarget.value)}
        />
        <Select
          aria-label="Filter by security"
          value={securityFilter}
          options={SECURITY_FILTER_OPTIONS}
          disabled={data.loading}
          className={styles.filterSelect}
          menuClassName={styles.selectMenu}
          onChange={(event) => setSecurityFilter(event.currentTarget.value)}
        />

        {/* Phone-tier primary action. The page header's button is hidden below
            780px so this full-width one takes over. */}
        {canManageUsers && (
          <Button
            type="button"
            variant="primary"
            size="lg"
            className={styles.createMobile}
            onClick={onOpenCreate}
          >
            <FaIcon name="user-plus" size={15} />
            <span>Create account</span>
          </Button>
        )}
      </div>

      <p className={styles.srOnly} aria-live="polite">
        {data.loading ? '' : `${visibleUsers.length} team members shown.`}
      </p>

      <div className={styles.tableCard}>
        <table
          className={styles.table}
          aria-label="CMS team access roster"
          aria-busy={data.loading || undefined}
        >
          <thead className={styles.head}>
            <tr className={styles.headRow}>
              <th scope="col">Team member</th>
              <th scope="col">Access</th>
              <th scope="col">Security</th>
              <th scope="col">Last login</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.loading
              ? Array.from({ length: 3 }, (_, index) => (
                <tr key={`skeleton-${index}`} className={styles.row}>
                  <td className={styles.identityCell}>
                    <SkeletonCircle size={58} />
                    <span className={styles.identity}>
                      <Skeleton width={150} height={16} />
                      <Skeleton width={190} height={12} />
                    </span>
                  </td>
                  <td className={styles.chipCell}>
                    <Skeleton width={64} height={29} radius={7} />
                    <Skeleton width={72} height={29} radius={7} />
                  </td>
                  <td className={styles.chipCell}>
                    <Skeleton width={78} height={29} radius={7} />
                  </td>
                  <td className={styles.lastLogin}><Skeleton width={104} height={12} /></td>
                  <td className={styles.actionsCell}>
                    <Skeleton width={48} height={48} radius={8} />
                  </td>
                </tr>
              ))
              : visibleUsers.map((user) => {
                const owner = isOwnerUser(user)
                const label = displayUserName(user)
                return (
                  <tr key={user.id} className={styles.row} aria-label={`User ${user.email}`}>
                    <td className={styles.identityCell}>
                      {/* The approved roster draws a single initial on a
                          tinted disc. An UPLOADED avatar still wins — that is
                          real data the mock had no concept of — but the
                          Gravatar identicon does not: a generated pattern is
                          noise where the design calls for a letter. */}
                      <UserAvatar
                        user={user}
                        size={58}
                        alt={null}
                        maxInitials={1}
                        initialsOnly={!user.avatarUrl}
                        className={AVATAR_TONE_CLASS[avatarTone(user.id)]}
                      />
                      <span className={styles.identity}>
                        <strong title={label}>{label}</strong>
                        <small title={user.email}>{user.email}</small>
                      </span>
                    </td>

                    <td className={styles.chipCell}>
                      <StatusChip tone={statusChipTone(user.status)}>
                        {statusLabel(user.status)}
                      </StatusChip>
                      <StatusChip tone={roleChipTone(user.role)}>{user.role.name}</StatusChip>
                    </td>

                    <td className={styles.chipCell}>
                      <FaIcon name="shield-halved" size={18} className={styles.securityGlyph} />
                      <StatusChip tone={mfaChipTone(user.mfaEnabled)}>
                        MFA {user.mfaEnabled ? 'on' : 'off'}
                      </StatusChip>
                    </td>

                    <td className={styles.lastLogin}>
                      <time>{formatDateTime(user.lastLoginAt)}</time>
                    </td>

                    <td className={styles.actionsCell}>
                      {owner ? (
                        <span className={styles.ownerProtected}>
                          <FaIcon name="shield-halved" size={18} className={styles.ownerGlyph} />
                          <strong>Owner protected</strong>
                          <small>Permanent · Cannot be changed or removed</small>
                        </span>
                      ) : canManageUsers && (
                        <RowActionMenu
                          triggerLabel={`Actions for ${label}`}
                          menuLabel={`User actions for ${label}`}
                          disabled={busy}
                          triggerClassName={styles.rowMenuTrigger}
                          menuClassName={styles.rowMenu}
                          items={[
                            {
                              label: 'Edit',
                              icon: <FaIcon name="pen" size={12} />,
                              onSelect: () => openDialogFor(user, 'edit'),
                            },
                            {
                              label: 'Reset password',
                              icon: <FaIcon name="key" size={12} />,
                              onSelect: () => openDialogFor(user, 'reset'),
                            },
                            {
                              label: user.status === 'active' ? 'Suspend' : 'Activate',
                              icon: <FaIcon name={user.status === 'active' ? 'pause' : 'play'} size={12} />,
                              onSelect: () => void toggleUserStatus(user, runStepUp, setUsers, refresh, setBusy),
                            },
                            {
                              label: 'Delete',
                              icon: <FaIcon name="trash-can" size={12} />,
                              danger: true,
                              onSelect: () => void deleteUser(user, runStepUp, setUsers, refresh, setBusy),
                            },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>

        {rosterIsEmpty && (
          <div className={styles.emptyRow}>
            <FaIcon name="user-group" size={28} className={styles.emptyGlyph} />
            <strong>{emptyBecauseFiltered ? 'No matching team members' : 'No CMS accounts yet'}</strong>
            <p>
              {emptyBecauseFiltered
                ? 'Change the search or filters to see more accounts.'
                : 'Create the first non-owner account when access is required.'}
            </p>
          </div>
        )}
      </div>

      <p className={styles.trustNote}>
        <FaIcon name="circle-info" size={18} className={styles.trustGlyph} />
        <span>Only trusted team members should have access. Review access regularly.</span>
      </p>

      {canManageUsers && createOpen && (
        <CreateAccountSheet
          roles={assignableRoles}
          defaultRoleId={defaultAssignableRoleId}
          busy={busy}
          error={createError}
          onClose={closeCreate}
          onCreate={handleCreate}
        />
      )}

      {canManageUsers && dialogMode && (
        <UserDialog
          mode={dialogMode}
          form={userForm}
          roleOptions={assignableRoleOptions}
          statusOptions={[...STATUS_OPTIONS]}
          busy={busy}
          error={error}
          onChange={setUserForm}
          onClose={closeDialog}
          onSubmit={handleSave}
        />
      )}
    </section>
  )
}
