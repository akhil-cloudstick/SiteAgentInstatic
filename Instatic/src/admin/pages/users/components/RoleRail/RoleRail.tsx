/**
 * RoleRail — the workbench's left pane.
 *
 * Lists every role with its mark, name and a subtitle that reads either
 * "System · Locked" (Owner) or "System|Custom · N capabilities". Selecting a
 * row loads it into the editor beside it; the Owner row is selectable so it
 * can be inspected, but the editor renders it read-only.
 *
 * The rows are `<Button>`s rather than links: this is a selection control
 * inside one page, not navigation — the URL does not change.
 */
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { Input } from '@ui/components/Input'
import type { CmsRole } from '@core/persistence'
import { cn } from '@ui/cn'
import { formatRoleRailMeta } from '../../utils/format'
import styles from './RoleRail.module.css'

/** Mark glyph + tint per role, falling back to the custom-role treatment. */
function roleMark(role: CmsRole): { icon: string; className: string } {
  if (role.slug === 'owner') return { icon: 'shield-halved', className: styles.markOwner }
  if (role.slug === 'admin') return { icon: 'shield', className: styles.markAdmin }
  if (role.slug === 'client') return { icon: 'user-group', className: styles.markClient }
  return { icon: 'file-pen', className: styles.markCustom }
}

interface RoleRailProps {
  roles: CmsRole[]
  selectedRoleId: string | null
  canManageRoles: boolean
  search: string
  onSearchChange: (value: string) => void
  onSelect: (role: CmsRole) => void
  onCreate: () => void
}

export function RoleRail({
  roles,
  selectedRoleId,
  canManageRoles,
  search,
  onSearchChange,
  onSelect,
  onCreate,
}: RoleRailProps) {
  const query = search.trim().toLowerCase()
  const visible = query
    ? roles.filter((role) => role.name.toLowerCase().includes(query))
    : roles

  return (
    <aside className={styles.rail} aria-label="Roles">
      <header className={styles.header}>
        <h2>Roles</h2>
        {canManageRoles && (
          <Button
            type="button"
            variant="primary"
            size="lg"
            className={styles.createButton}
            onClick={onCreate}
          >
            <FaIcon name="plus" size={13} />
            <span>Create role</span>
          </Button>
        )}
      </header>

      <div className={styles.searchControl}>
        <FaIcon name="magnifying-glass" size={16} className={styles.searchGlyph} />
        <Input
          type="search"
          aria-label="Search roles"
          placeholder="Search roles"
          value={search}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
        />
      </div>

      <div className={styles.list}>
        {visible.map((role) => {
          const mark = roleMark(role)
          const selected = role.id === selectedRoleId
          const locked = role.slug === 'owner'
          return (
            <Button
              key={role.id}
              type="button"
              variant="ghost"
              size="md"
              align="start"
              className={cn(styles.row, selected && styles.rowSelected)}
              aria-pressed={selected}
              onClick={() => onSelect(role)}
            >
              <span className={cn(styles.mark, mark.className)}>
                <FaIcon name={mark.icon} size={17} />
              </span>
              <span className={styles.rowText}>
                <strong title={role.name}>{role.name}</strong>
                <small>{formatRoleRailMeta(role)}</small>
              </span>
              <FaIcon name={locked ? 'lock' : 'chevron-right'} size={13} className={styles.rowTrail} />
            </Button>
          )
        })}

        {visible.length === 0 && (
          <p className={styles.empty}>No roles match that search.</p>
        )}
      </div>
    </aside>
  )
}
