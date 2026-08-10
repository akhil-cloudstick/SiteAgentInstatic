/**
 * FieldRow — a single field row in the FieldsSection list. Presentational:
 * drag-and-drop, edit, and delete are surfaced as handler props; all state and
 * persistence live in FieldsSection.
 */
import type { DragEvent, ReactElement } from 'react'
import { Button } from '@ui/components/Button'
import { MoreVerticalSolidIcon } from '@admin/pages/data/icons'
import { getFieldIcon } from '@admin/pages/data/utils/fieldIcons'
import type { DataField } from '@core/data/schemas'
import { FIELD_TYPE_LABELS } from './fieldGuards'
import styles from './DataInspector.module.css'

interface FieldRowProps {
  field: DataField
  /** 1-based position in the schema. Omit to hide the ordinal. */
  position?: number
  /** Opens the row options menu at the given viewport point. */
  onOpenMenu?: (x: number, y: number) => void
  /**
   * True when the row has no available action. The approved screen keeps the
   * button in place and disables it, so the trailing column stays aligned
   * down the list instead of gaining holes on locked rows.
   */
  menuDisabled?: boolean
  canDrag: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  canEdit: boolean
  primary: boolean
  canSetPrimary: boolean
  deletable: boolean
  /** Tooltip for a disabled delete button (undefined when deletable). */
  deleteTooltip?: string
  /** Mandatory postType built-in — rendered as a locked row with no actions. */
  mandatory: boolean
  /** Optional postType built-in — shows the "built-in" badge. */
  optionalBuiltIn: boolean
  isEditing: boolean
  isDragOver: boolean
  isDragging: boolean
  onEditToggle: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onSetPrimary: () => void
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragOver: (e: DragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
}

export function FieldRow({
  field,
  position,
  onOpenMenu,
  menuDisabled = false,
  canDrag,
  mandatory,
  optionalBuiltIn,
  isDragOver,
  isDragging,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  // Reorder / edit / delete / set-primary moved into the row's ⋮ menu, which
  // the composer owns. They stay in the contract so the composer can keep
  // deriving per-field capability in one place.
  canMoveUp: _canMoveUp,
  canMoveDown: _canMoveDown,
  canEdit: _canEdit,
  primary: _primary,
  canSetPrimary: _canSetPrimary,
  deletable: _deletable,
  deleteTooltip: _deleteTooltip,
  isEditing: _isEditing,
  onEditToggle: _onEditToggle,
  onDelete: _onDelete,
  onMoveUp: _onMoveUp,
  onMoveDown: _onMoveDown,
  onSetPrimary: _onSetPrimary,
}: FieldRowProps): ReactElement {
  return (
    <div
      className={[
        styles.fieldRow,
        isDragOver ? styles.fieldRowDragOver : '',
        isDragging ? styles.fieldRowDragging : '',
      ]
        .filter(Boolean)
        .join(' ')}
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={canDrag ? onDragOver : undefined}
      onDragLeave={canDrag ? onDragLeave : undefined}
      onDrop={canDrag ? onDrop : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
    >
      {/* Ordinal — the approved screen numbers the schema so the row order,
          which is the order fields appear in the grid and the record form, is
          readable at a glance rather than inferred from position. */}
      {position != null && (
        <span className={styles.fieldIndex} aria-hidden="true">{position}</span>
      )}

      {/* Field type icon — called directly (not as <FieldIcon/>) to avoid the
          react-hooks/static-components rule, matching DataGridHeaderCell. */}
      <span className={styles.fieldIcon} aria-hidden="true">
        {getFieldIcon(field.type)({ size: 14 })}
      </span>

      {/* Name */}
      <span className={styles.fieldName}>{field.label}</span>

      {/*
        * Badges. The approved screen states a field's constraints as amber
        * TEXT pills — `Required`, `Locked`, `Built-in` — falling back to the
        * type name when the field carries none of them. An icon-only lock (as
        * this row used to draw) is unreadable without hovering for a tooltip.
        */}
      <span className={styles.fieldTags}>
        {field.required && <em className={styles.tagRequired}>Required</em>}
        {mandatory && <em className={styles.tagLocked}>Locked</em>}
        {!mandatory && optionalBuiltIn && <em className={styles.tagBuiltIn}>Built-in</em>}
        {!mandatory && !optionalBuiltIn && !field.required && (
          <em className={styles.tagType}>{FIELD_TYPE_LABELS[field.type]}</em>
        )}
      </span>

      {/*
        * One ⋮ per row. Set-primary, reorder, edit and delete all live in the
        * menu it opens, matching the approved screen — a row of five
        * always-visible buttons crowded the badges out of the row entirely.
        */}
      {onOpenMenu && (
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          type="button"
          className={styles.fieldMenuButton}
          disabled={menuDisabled}
          aria-label={`Options for ${field.label}`}
          tooltip={`Options for ${field.label}`}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            onOpenMenu(rect.right, rect.bottom)
          }}
        >
          <MoreVerticalSolidIcon size={13} aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}
