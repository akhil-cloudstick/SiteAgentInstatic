/**
 * DataGridRow — read-only display row in the DataGrid.
 *
 * Cells render as presentational chips / thumbnails / formatted values via
 * `CellDisplayRenderer`. Editing happens in the row inspector — clicking
 * the row calls `onSelect` which opens the inspector.
 *
 * The primary cell is special: it shows the row's title plus an optional
 * `/slug` subtitle (post-type tables), with a status dot for postType.
 */
import type { CSSProperties, ReactElement } from 'react'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { cn } from '@ui/cn'
import { FileTextSolidIcon, MoreVerticalSolidIcon } from '@admin/pages/data/icons'
import { readStringCell } from '@core/data/cells'
import type { DataField, DataRow, DataTable } from '@core/data/schemas'
import { CellDisplayRenderer } from './cells/CellDisplayRenderer'
import { formatUpdatedAt } from './dataGridRows'
import styles from './DataGrid.module.css'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DataGridRowProps {
  row: DataRow
  /** Field order to render — DataGrid reorders so primary comes first and
   *  filters out fields that are collapsed into the primary subtitle. */
  fields: DataField[]
  /** The table's primary field id. */
  primaryFieldId: string
  /** Field id whose value is rendered as a subtitle under the primary cell.
   *  Typically `'slug'` for post-types; `null` otherwise. */
  subtitleFieldId: string | null
  table: DataTable
  /** Full tables list — for resolving cross-table relation labels. */
  tables: DataTable[]
  /** All rows in the active table — for in-table relation labels. */
  rows: DataRow[]
  selected: boolean
  /** True when the row's checkbox is ticked (bulk-select). */
  checked: boolean
  readOnly?: boolean
  /** Render the colored status dot inside the primary cell. PostType only. */
  showStatusDot: boolean
  onSelect: () => void
  onCheckedChange: (next: boolean) => void
  /** 'Edit in Content' (postType) or 'Open' (data). Omit to hide the button. */
  onPrimaryAction?: () => void
  /** Delete row. Omit to hide the delete button. */
  onDelete?: () => void
  /**
   * Opens the row actions menu at the given viewport coordinates. The approved
   * screen exposes row actions through a visible ⋮ button, not only the native
   * right-click menu — without it there is no way to reach them on touch.
   */
  onOpenMenu?: (x: number, y: number) => void
  /** Inline style for the sticky primary cell (provides `left`). */
  primaryStickyLeft: CSSProperties
  /** Inline style for the sticky checkbox cell (provides `left: 0`). */
  checkboxStickyLeft: CSSProperties
}

// ---------------------------------------------------------------------------
// DataGridRow
// ---------------------------------------------------------------------------

export function DataGridRow({
  row,
  fields,
  primaryFieldId,
  subtitleFieldId,
  table: _table,
  tables,
  rows,
  selected,
  checked,
  readOnly: _readOnly,
  showStatusDot: _showStatusDot,
  onSelect,
  onCheckedChange,
  // `onPrimaryAction` / `onDelete` are still part of the row contract — the
  // grid passes them straight to the ⋮ menu, which is the only place the
  // approved screen surfaces them.
  onPrimaryAction: _onPrimaryAction,
  onDelete: _onDelete,
  onOpenMenu,
  primaryStickyLeft,
  checkboxStickyLeft,
}: DataGridRowProps): ReactElement {
  // Resolve primary title + subtitle.
  const primaryValue = readStringCell(row.cells, primaryFieldId)
  const subtitleValue = subtitleFieldId
    ? readStringCell(row.cells, subtitleFieldId)
    : ''

  // Clicking the checkbox or trailing actions cells shouldn't trigger row-select.
  function stopRowClick(e: React.MouseEvent) {
    e.stopPropagation()
  }

  return (
    <div
      role="row"
      className={cn(styles.row)}
      aria-selected={selected}
      data-selected={selected ? 'true' : undefined}
      data-checked={checked ? 'true' : undefined}
      data-data-grid-row-id={row.id}
      onClick={onSelect}
    >
      {/* Leading checkbox cell — sticky to the left edge */}
      <div
        role="gridcell"
        className={styles.cell}
        data-sticky="checkbox"
        data-data-grid-row-id={row.id}
        style={checkboxStickyLeft}
        onClick={stopRowClick}
      >
        <Checkbox
          boxSize="sm"
          checked={checked}
          onCheckedChange={onCheckedChange}
          aria-label={checked ? `Deselect row ${row.id}` : `Select row ${row.id}`}
        />
      </div>

      {fields.map((field) => {
        const isPrimary = field.id === primaryFieldId
        if (isPrimary) {
          return (
            <div
              key={field.id}
              role="gridcell"
              className={cn(styles.cell, styles.primaryCell)}
              data-sticky="primary"
              data-data-grid-row-id={row.id}
              style={primaryStickyLeft}
            >
              {/*
                * The approved screen marks the primary cell with a document
                * glyph, not a coloured status dot — status is already carried
                * by the group header and the filter chips, so a per-row dot
                * was both redundant and the loudest thing in the ladder.
                */}
              <FileTextSolidIcon
                size={13}
                className={styles.primaryIcon}
                aria-hidden="true"
              />
              <span className={styles.primaryStack}>
                {primaryValue.length > 0 ? (
                  <span className={styles.primaryTitle}>{primaryValue}</span>
                ) : (
                  <span className={cn(styles.primaryTitle, styles.empty)}>—</span>
                )}
                {subtitleFieldId && subtitleValue.length > 0 && (
                  <span className={styles.primarySubtitle}>/{subtitleValue}</span>
                )}
              </span>
            </div>
          )
        }
        return (
          <div
            key={field.id}
            role="gridcell"
            className={styles.cell}
            data-data-grid-row-id={row.id}
          >
            <CellDisplayRenderer
              field={field}
              cells={row.cells}
              tables={tables}
              rows={rows}
            />
          </div>
        )
      })}

      {/* The Updated virtual column — the row's own last-modified stamp. */}
      <div
        role="gridcell"
        className={styles.cell}
        data-data-grid-row-id={row.id}
      >
        <time dateTime={row.updatedAt} className={styles.truncateCell}>
          {formatUpdatedAt(row.updatedAt)}
        </time>
      </div>

      {/* Trailing actions column */}
      <div
        role="gridcell"
        className={styles.actionsCell}
        data-data-grid-row-id={row.id}
        onClick={stopRowClick}
      >
        {/*
          * One ⋮ per row — the approved screen's only trailing affordance.
          * "Open"/"Edit in Content" and "Delete row" are not dropped; they are
          * the first and last items of the menu this opens, which is where the
          * reference puts them.
          */}
        <div className={styles.actions}>
          {onOpenMenu && (
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              aria-label={`Actions for ${primaryValue || row.id}`}
              tooltip="Row actions"
              onClick={(e) => {
                e.stopPropagation()
                // Anchor the menu to the button, mirroring where a right-click
                // would have opened it. The menu itself clamps to the viewport.
                const rect = e.currentTarget.getBoundingClientRect()
                onOpenMenu(rect.right, rect.bottom)
              }}
            >
              <MoreVerticalSolidIcon size={14} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

    </div>
  )
}
