/**
 * Pure formatting / labelling helpers used across the Users workspace.
 *
 * Everything here is pure: no React, no API calls, no DOM. The functions
 * convert raw CMS values into the strings the UI shows.
 */
import type { CmsCurrentUser } from '@core/persistence'
import type { Tab } from '../types'

export function isOwnerUser(user: CmsCurrentUser): boolean {
  return user.role.slug === 'owner'
}

export function displayUserName(user: CmsCurrentUser): string {
  return user.displayName.trim() || user.email
}

export function statusLabel(status: CmsCurrentUser['status']): string {
  return status === 'active' ? 'Active' : 'Suspended'
}

export function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Never'
}

export function formatCapabilitySummary(capabilities: string[]): string {
  if (capabilities.length === 0) return 'No admin capabilities'
  const capabilityLabel = capabilities.length === 1 ? 'capability' : 'capabilities'
  return `${capabilities.length} ${capabilityLabel}`
}

export function tabLabel(tab: Tab): string {
  return tab === 'people' ? 'People' : tab === 'roles' ? 'Roles' : 'Activity'
}

/**
 * Account count line under the roster heading. The approved screen writes
 * "4 accounts with CMS access." and singularises at one.
 */
export function formatAccountSummary(count: number): string {
  return `${count} account${count === 1 ? '' : 's'} with CMS access.`
}

/**
 * "Used by 1 account" / "Used by 3 accounts" — the role editor's meta line.
 */
export function formatRoleUsage(count: number): string {
  return `Used by ${count} ${count === 1 ? 'account' : 'accounts'}`
}

/**
 * Rail subtitle: "System · Locked" for the immutable Owner role, otherwise
 * "System · 37 capabilities" / "Custom · 7 capabilities".
 */
export function formatRoleRailMeta(role: {
  isSystem: boolean
  slug: string
  capabilities: string[]
}): string {
  const kind = role.isSystem ? 'System' : 'Custom'
  if (role.slug === 'owner') return `${kind} · Locked`
  return `${kind} · ${formatCapabilitySummary(role.capabilities)}`
}
