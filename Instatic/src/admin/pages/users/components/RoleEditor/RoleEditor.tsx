/**
 * RoleEditor — the workbench's centre pane.
 *
 * Edits a role in place instead of in a modal: name, description, and the
 * eleven capability groups, with the save action and a meta line showing what
 * the role is and who it affects.
 *
 * READ-ONLY CASES
 *   - The Owner role is locked outright: the server refuses every PATCH to it
 *     (`The Owner role is locked and cannot be edited`) and re-syncs its
 *     capabilities from `CORE_CAPABILITIES` on every boot.
 *   - A viewer without `roles.manage` sees the same read-only shape.
 * Every other role — including the built-in `admin` / `client` / `member` — is
 * editable; only DELETION is restricted to custom roles.
 */
import { useId } from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { Input, Textarea } from '@ui/components/Input'
import { RowActionMenu } from '../RowActionMenu'
import { CapabilityGroups, type ExpandedGroup } from '../CapabilityGroups/CapabilityGroups'
import { CAPABILITY_GROUPS } from '../../utils/capabilities'
import { formatCapabilitySummary, formatRoleUsage } from '../../utils/format'
import type { RoleFormState } from '../../types'
import styles from './RoleEditor.module.css'

/** The reference caps the description at 150 characters and counts down. */
const DESCRIPTION_MAX = 150

interface RoleEditorProps {
  form: RoleFormState
  /** True for the Owner role, or when the viewer lacks `roles.manage`. */
  readonly: boolean
  isSystem: boolean
  /** Null when the viewer cannot see the roster, so the count is unknowable. */
  assignedCount: number | null
  dirty: boolean
  busy: boolean
  capabilitySearch: string
  expandedGroup: ExpandedGroup
  canDelete: boolean
  error: string | null
  onChange: (form: RoleFormState) => void
  onCapabilitySearchChange: (value: string) => void
  onExpandedChange: (next: ExpandedGroup) => void
  onSave: () => void
  onDelete: () => void
}

export function RoleEditor({
  form,
  readonly,
  isSystem,
  assignedCount,
  dirty,
  busy,
  capabilitySearch,
  expandedGroup,
  canDelete,
  error,
  onChange,
  onCapabilitySearchChange,
  onExpandedChange,
  onSave,
  onDelete,
}: RoleEditorProps) {
  const nameId = useId()
  const descriptionId = useId()
  const allExpanded = expandedGroup === 'all'

  return (
    <div className={styles.editor}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <h2 title={form.name}>{form.name || 'Untitled role'}</h2>
          <p className={styles.meta}>
            <span>
              <FaIcon name="user" size={12} />
              <span>{isSystem ? 'System role' : 'Custom role'}</span>
            </span>
            <span>
              <FaIcon name="shield-halved" size={12} />
              <span>{formatCapabilitySummary(form.capabilities)}</span>
            </span>
            {/* Derived from the loaded roster, so it is only truthful when the
                viewer can see the roster. A `roles.manage`-only admin loads no
                users, and rendering "Used by 0 accounts" there would be a lie. */}
            {assignedCount !== null && (
              <span>
                <FaIcon name="user-group" size={12} />
                <span>{formatRoleUsage(assignedCount)}</span>
              </span>
            )}
          </p>
        </div>

        <div className={styles.headerActions}>
          <Button
            type="button"
            variant="primary"
            size="lg"
            className={styles.primaryAction}
            disabled={readonly || !dirty || busy}
            onClick={onSave}
          >
            <span>Save role</span>
          </Button>
          {canDelete && (
            <RowActionMenu
              triggerLabel={`Actions for ${form.name}`}
              menuLabel={`Role actions for ${form.name}`}
              disabled={busy}
              triggerClassName={styles.actionsTrigger}
              menuClassName={styles.actionsMenu}
              items={[
                {
                  label: 'Delete role',
                  icon: <FaIcon name="trash-can" size={12} />,
                  danger: true,
                  onSelect: onDelete,
                },
              ]}
            />
          )}
        </div>
      </header>

      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor={nameId} className={styles.label}>Name</label>
          <Input
            id={nameId}
            value={form.name}
            required
            disabled={readonly}
            placeholder="Content editor"
            onChange={(event) => onChange({ ...form, name: event.currentTarget.value })}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={descriptionId} className={styles.label}>Description</label>
          <div className={styles.descriptionShell}>
            <Textarea
              id={descriptionId}
              value={form.description}
              disabled={readonly}
              maxLength={DESCRIPTION_MAX}
              placeholder="What can someone with this role do?"
              onChange={(event) => onChange({ ...form, description: event.currentTarget.value })}
            />
            <small className={styles.counter}>
              {form.description.length}/{DESCRIPTION_MAX}
            </small>
          </div>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchControl}>
          <FaIcon name="magnifying-glass" size={16} className={styles.searchGlyph} />
          <Input
            type="search"
            aria-label="Search capabilities"
            placeholder="Search capabilities"
            value={capabilitySearch}
            onChange={(event) => onCapabilitySearchChange(event.currentTarget.value)}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="md"
          className={styles.expandToggle}
          onClick={() => onExpandedChange(allExpanded ? '' : 'all')}
        >
          <span>{allExpanded ? 'Collapse all' : 'Expand all'}</span>
          <FaIcon name={allExpanded ? 'chevron-up' : 'chevron-down'} size={11} />
        </Button>
        <span className={styles.groupCount}>{CAPABILITY_GROUPS.length} groups</span>
      </div>

      <CapabilityGroups
        selected={form.capabilities}
        search={capabilitySearch}
        expanded={expandedGroup}
        readonly={readonly}
        onExpandedChange={onExpandedChange}
        onChange={(capabilities) => onChange({ ...form, capabilities })}
      />

      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  )
}
