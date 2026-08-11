/**
 * Team Access → Roles.
 *
 * The approved screen's three-pane workbench: a role rail, an inline editor,
 * and an access summary. Editing happens in place rather than in a modal — the
 * operator compares roles against each other while changing one, which a modal
 * makes impossible.
 *
 * Server rules this UI mirrors (all of them are enforced server-side too, so
 * the UI is a courtesy, not the gate):
 *   - The Owner role is locked outright.
 *   - Any system role can be edited but never deleted.
 *   - A role assigned to at least one user cannot be deleted.
 *   - Every mutation is step-up gated.
 *
 * The reference guards unsaved edits with `window.confirm`, which is banned
 * here (`no-native-browser-dialogs`). The shared `useConfirmDelete` dispatch
 * takes its place, with `alwaysConfirm` set so the guard survives a user who
 * has turned the confirm-before-delete preference off — losing unsaved
 * capability edits silently is not an acceptable shortcut.
 */
import { useState } from 'react'
import { FaIcon } from '@ui/components/FaIcon'
import { Skeleton } from '@ui/components/Skeleton'
import { pushToast } from '@ui/components/Toast'
import { useConfirmDelete } from '@admin/shared/dialogs/ConfirmDeleteDialog'
import { StepUpCancelledMessage, useStepUp } from '@admin/shared/StepUp'
import {
  createCmsRole,
  deleteCmsRole,
  updateCmsRole,
  type CmsRole,
} from '@core/persistence'
import { getErrorMessage } from '@core/utils/errorMessage'
import { RoleRail } from '../components/RoleRail/RoleRail'
import { RoleEditor } from '../components/RoleEditor/RoleEditor'
import { AccessSummary } from '../components/AccessSummary/AccessSummary'
import type { ExpandedGroup } from '../components/CapabilityGroups/CapabilityGroups'
import { emptyRoleForm, type RoleFormState } from '../types'
import type { UsersPageData } from '../hooks/useUsersPageData'
import styles from './RolesPanel.module.css'

interface RolesPanelProps {
  data: UsersPageData
  canManageRoles: boolean
  /** Gates the derived "Used by N accounts" count — see RoleEditor. */
  canManageUsers: boolean
  onViewActivity: (() => void) | null
}

function toForm(role: CmsRole): RoleFormState {
  return {
    name: role.name,
    slug: role.slug,
    description: role.description,
    capabilities: [...role.capabilities],
  }
}

/** `Content editor` → `content-editor`. Matches the server's own slugging. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function RolesPanel({
  data,
  canManageRoles,
  canManageUsers,
  onViewActivity,
}: RolesPanelProps) {
  const { roles, users, setRoles, refresh } = data
  const { runStepUp } = useStepUp()
  const confirmDelete = useConfirmDelete()

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  /**
   * `null` means "showing the selected role exactly as the server has it".
   * The editor's form is DERIVED from the selection rather than copied into
   * state on selection — so a background `refresh()` cannot silently overwrite
   * what the operator is looking at, and there is no seed-from-props effect to
   * keep in sync. A non-null draft is precisely what "unsaved changes" means.
   */
  const [draft, setDraft] = useState<RoleFormState | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roleSearch, setRoleSearch] = useState('')
  const [capabilitySearch, setCapabilitySearch] = useState('')
  const [expandedGroup, setExpandedGroup] = useState<ExpandedGroup>('')

  // With nothing selected yet, the first role is the selection — the workbench
  // is never usefully empty, and picking it here avoids an effect.
  const selectedRole = creating
    ? null
    : roles.find((role) => role.id === selectedRoleId) ?? roles[0] ?? null
  const form = draft ?? (selectedRole ? toForm(selectedRole) : emptyRoleForm)
  const dirty = draft !== null

  const isOwnerRole = selectedRole?.slug === 'owner'
  const readonly = !canManageRoles || (isOwnerRole && !creating)
  const isSystem = creating ? false : Boolean(selectedRole?.isSystem)
  // Only meaningful when the roster is loaded — see the note in RoleEditor.
  const assignedCount = canManageUsers && selectedRole
    ? users.filter((user) => user.role.id === selectedRole.id).length
    : null
  const canDelete = canManageRoles && !creating && Boolean(selectedRole) && !isSystem

  /** Runs `action`, first confirming when there are unsaved edits to lose. */
  function guardUnsaved(action: () => void): void {
    if (!dirty) {
      action()
      return
    }
    confirmDelete({
      title: 'Discard unsaved role changes?',
      description: 'The changes you made to this role have not been saved.',
      confirmLabel: 'Discard changes',
      alwaysConfirm: true,
      commit: action,
    })
  }

  function selectRole(role: CmsRole): void {
    if (role.id === selectedRole?.id && !creating) return
    guardUnsaved(() => {
      setCreating(false)
      setDraft(null)
      setError(null)
      setSelectedRoleId(role.id)
    })
  }

  function startCreate(): void {
    if (!canManageRoles) return
    guardUnsaved(() => {
      setCreating(true)
      setSelectedRoleId(null)
      setError(null)
      setDraft({ ...emptyRoleForm, name: 'New custom role' })
    })
  }

  function updateForm(next: RoleFormState): void {
    setDraft(next)
  }

  async function save(): Promise<void> {
    if (!canManageRoles || readonly) return
    setBusy(true)
    setError(null)
    try {
      const payload = {
        name: form.name,
        slug: form.slug.trim() || slugify(form.name),
        description: form.description,
        capabilities: form.capabilities,
      }
      const saved = creating || !selectedRole
        ? await runStepUp(() => createCmsRole(payload))
        : await runStepUp(() => updateCmsRole(selectedRole.id, payload))

      setRoles((current) => {
        const exists = current.some((candidate) => candidate.id === saved.id)
        return exists
          ? current.map((candidate) => candidate.id === saved.id ? saved : candidate)
          : [...current, saved]
      })
      setCreating(false)
      setDraft(null)
      setSelectedRoleId(saved.id)
      void refresh()
      pushToast({
        kind: 'success',
        title: 'Role saved',
        body: `${saved.name} now has ${saved.capabilities.length} ${saved.capabilities.length === 1 ? 'capability' : 'capabilities'}.`,
      })
    } catch (err) {
      if (err instanceof Error && err.message === StepUpCancelledMessage) return
      setError(getErrorMessage(err, 'Could not save role'))
    } finally {
      setBusy(false)
    }
  }

  async function performDelete(role: CmsRole): Promise<void> {
    setBusy(true)
    try {
      await runStepUp(() => deleteCmsRole(role.id))
      setRoles((current) => current.filter((candidate) => candidate.id !== role.id))
      setSelectedRoleId(null)
      setDraft(null)
      void refresh()
      pushToast({ kind: 'success', title: 'Role deleted', body: `${role.name} was deleted.` })
    } catch (err) {
      if (err instanceof Error && err.message === StepUpCancelledMessage) return
      pushToast({
        kind: 'error',
        title: 'Could not delete role',
        body: getErrorMessage(err, 'Could not delete role'),
      })
    } finally {
      setBusy(false)
    }
  }

  function requestDelete(): void {
    const role = selectedRole
    if (!role || !canDelete) return
    // The server rejects this too; catching it here means the operator gets a
    // reason instead of a 409 after a step-up prompt.
    if (assignedCount !== null && assignedCount > 0) {
      pushToast({
        kind: 'warning',
        title: 'Role is in use',
        body: `${role.name} cannot be deleted while ${assignedCount} ${assignedCount === 1 ? 'account is' : 'accounts are'} assigned to it.`,
      })
      return
    }
    confirmDelete({
      title: `Delete ${role.name}?`,
      description: 'This custom role will be removed. It cannot be restored.',
      confirmLabel: 'Delete role',
      alwaysConfirm: true,
      commit: () => void performDelete(role),
    })
  }

  if (data.loading) {
    return (
      <section
        id="panel-roles"
        role="tabpanel"
        aria-labelledby="tab-roles"
        className={styles.panel}
        aria-busy="true"
      >
        <div className={styles.railSkeleton}>
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={`rail-${index}`} height={76} />
          ))}
        </div>
        <div className={styles.editorSkeleton}>
          <Skeleton width={220} height={24} />
          <Skeleton width="60%" height={12} />
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={`group-${index}`} height={39} />
          ))}
        </div>
        <div className={styles.summarySkeleton}>
          <Skeleton width={160} height={16} />
          <Skeleton height={92} />
          <Skeleton height={92} />
        </div>
      </section>
    )
  }

  if (roles.length === 0) {
    return (
      <section
        id="panel-roles"
        role="tabpanel"
        aria-labelledby="tab-roles"
        className={styles.emptyPanel}
      >
        <FaIcon name="shield-halved" size={28} className={styles.emptyGlyph} />
        <strong>No roles configured</strong>
        <p>Roles are seeded on first boot. Restart the CMS if this list stays empty.</p>
      </section>
    )
  }

  return (
    <section
      id="panel-roles"
      role="tabpanel"
      aria-labelledby="tab-roles"
      className={styles.panel}
    >
      <RoleRail
        roles={roles}
        selectedRoleId={creating ? null : selectedRoleId}
        canManageRoles={canManageRoles}
        search={roleSearch}
        onSearchChange={setRoleSearch}
        onSelect={selectRole}
        onCreate={startCreate}
      />

      <RoleEditor
        form={form}
        readonly={readonly}
        isSystem={isSystem}
        assignedCount={creating ? null : assignedCount}
        dirty={dirty}
        busy={busy}
        capabilitySearch={capabilitySearch}
        expandedGroup={expandedGroup}
        canDelete={canDelete}
        error={error}
        onChange={updateForm}
        onCapabilitySearchChange={setCapabilitySearch}
        onExpandedChange={setExpandedGroup}
        onSave={() => void save()}
        onDelete={requestDelete}
      />

      <AccessSummary
        slug={form.slug}
        capabilities={form.capabilities}
        createdAt={creating ? null : selectedRole?.createdAt ?? null}
        updatedAt={creating ? null : selectedRole?.updatedAt ?? null}
        onViewActivity={onViewActivity}
      />
    </section>
  )
}
