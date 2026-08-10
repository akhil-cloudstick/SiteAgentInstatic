/**
 * DataGridHeaderRow — the grid's column-header row: a leading select-all
 * checkbox, one `DataGridHeaderCell` per ordered field, and a trailing
 * (label-less) actions column header.
 */
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { Checkbox } from '@ui/components/Checkbox'
import type { DataField } from '@core/data/schemas'
import { DataGridHeaderCell } from './DataGridHeaderCell'
import { UPDATED_COLUMN_ID, UPDATED_COLUMN_LABEL, type SortState } from './dataGridRows'
import styles from './DataGrid.module.css'

/**
 * Synthetic field descriptor for the Updated column. It is not part of the
 * table's schema — it exists only so the virtual column can render through the
 * same header cell as the real ones, picking up their glyph, sort caret and
 * 44px hit target for free.
 */
const UPDATED_COLUMN_FIELD: DataField = {
  type: 'dateTime',
  id: UPDATED_COLUMN_ID,
  label: UPDATED_COLUMN_LABEL,
}

interface DataGridHeaderRowProps {
  fields: DataField[]
  primaryFieldId: string
  sort: SortState | null
  /** Header checkbox is checked when any visible row is selected. */
  headerChecked: boolean
  allChecked: boolean
  onToggleAll: (next: boolean) => void
  onSort: (fieldId: string) => void
  primaryStickyLeft: CSSProperties
  checkboxStickyLeft: CSSProperties
  onPrimaryResizeStart: (e: ReactMouseEvent) => void
  /** Current rendered width of a non-primary column, for resize start state. */
  resolveColumnWidth: (field: DataField) => number
  /** Builds the mousedown handler for a non-primary column's resize grip. */
  onColumnResizeStart: (fieldId: string, startWidth: number) => (e: ReactMouseEvent) => void
}

export function DataGridHeaderRow({
  fields,
  primaryFieldId,
  sort,
  headerChecked,
  allChecked,
  onToggleAll,
  onSort,
  primaryStickyLeft,
  checkboxStickyLeft,
  onPrimaryResizeStart,
  resolveColumnWidth,
  onColumnResizeStart,
}: DataGridHeaderRowProps): ReactElement {
  return (
    <div role="row" className={styles.headerRow}>
      {/* Leading checkbox column header */}
      <div
        role="columnheader"
        className={styles.headerCell}
        data-sticky="checkbox"
        style={checkboxStickyLeft}
        aria-label="Select all rows"
      >
        <Checkbox
          boxSize="sm"
          checked={headerChecked}
          onCheckedChange={() => onToggleAll(!allChecked)}
          aria-label={allChecked ? 'Deselect all rows' : 'Select all rows'}
        />
      </div>

      {fields.map((field) => {
        const isPrimary = field.id === primaryFieldId
        const sortDir = sort?.fieldId === field.id ? sort.dir : null
        return (
          <DataGridHeaderCell
            key={field.id}
            field={field}
            isPrimary={isPrimary}
            sortDir={sortDir}
            sticky={isPrimary ? 'primary' : undefined}
            stickyStyle={isPrimary ? primaryStickyLeft : undefined}
            onClickHeader={() => onSort(field.id)}
            onResizeStart={isPrimary
              ? onPrimaryResizeStart
              : onColumnResizeStart(field.id, resolveColumnWidth(field))}
          />
        )
      })}

      {/*
        * The Updated virtual column — sortable like any field, but reads the
        * row's own `updatedAt` rather than a cell. Rendered through the same
        * header cell as the real columns (fed a synthetic `dateTime` field
        * descriptor) so its chrome, sort affordance and hit target cannot
        * drift from theirs.
        */}
      <DataGridHeaderCell
        field={UPDATED_COLUMN_FIELD}
        sortDir={sort?.fieldId === UPDATED_COLUMN_ID ? sort.dir : null}
        onClickHeader={() => onSort(UPDATED_COLUMN_ID)}
      />

      {/* Trailing actions column header — no visible label */}
      <div role="columnheader" className={styles.headerCell} aria-label="Actions" />
    </div>
  )
}
