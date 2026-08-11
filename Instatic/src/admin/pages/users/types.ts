/**
 * Shared types for the Users workspace.
 *
 * These types are shared across the page shell, the per-tab components, the
 * dialogs and the helper utilities. Keep them dialect-naive — no React
 * imports, no DOM types, no API client imports.
 */
import type { ReactNode } from 'react'
import type { CmsCurrentUser } from '@core/persistence'
import type { CoreCapability } from '@core/capabilities'

/**
 * The three states of the one Team Access workspace, named as the approved
 * MMSBUILD screen names them. They are states of a single workspace rather
 * than three pages — the reference's contract test asserts exactly this
 * (`VALID_TABS = new Set(["people", "roles", "activity"])`).
 */
export type Tab = 'people' | 'roles' | 'activity'

/**
 * `create` is served by the side sheet; `edit` and `reset` by `UserDialog`.
 * The approved screen has no edit sheet — editing an existing account is a
 * small, focused change and stays a centred dialog.
 */
export type UserDialogMode = 'create' | 'edit' | 'reset'

/** Status-chip tones, per the approved roster. */
export type ChipTone = 'success' | 'danger' | 'owner' | 'admin' | 'role' | 'neutral'

/** Deterministic avatar tints, per `.person-avatar.<tone>` in the reference. */
export type AvatarTone = 'green' | 'blue' | 'violet' | 'orange'

export interface UserFormState {
  email: string
  displayName: string
  password: string
  roleId: string
  status: CmsCurrentUser['status']
}

export interface RoleFormState {
  name: string
  slug: string
  description: string
  capabilities: string[]
}

export interface CapabilityGroup {
  title: string
  capabilities: CoreCapability[]
}

export interface RowActionMenuItem {
  label: string
  icon: ReactNode
  danger?: boolean
  onSelect: () => void
}

export interface UsersPageLoadAccess {
  canManageUsers: boolean
  canReadRoleOptions: boolean
  canReadAudit: boolean
}

export const emptyUserForm: UserFormState = {
  email: '',
  displayName: '',
  password: '',
  roleId: 'viewer',
  status: 'active',
}

export const emptyRoleForm: RoleFormState = {
  name: '',
  slug: '',
  description: '',
  capabilities: [],
}
