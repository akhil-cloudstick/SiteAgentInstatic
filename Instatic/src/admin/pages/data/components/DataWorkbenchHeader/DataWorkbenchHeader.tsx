/**
 * DataWorkbenchHeader — the approved screen's `.grid-context-bar`.
 *
 * A fixed three-column band above the grid: breadcrumb (table group / table
 * name) on the left, the live save-state readout centred, and the row-create
 * action on the right.
 *
 * The reference houses its publish split-button in the standalone app header.
 * This admin has one shared toolbar across every workspace, which the Data
 * re-skin deliberately does not touch, so the publish control rides in the
 * right-hand actions group instead. Everything else in this row matches the
 * reference exactly.
 *
 * Bundle export/import used to live here; they now sit in the sidebar panel
 * header, which is where the approved screen puts them.
 *
 * Presentation only — every control is wired to the same DataPage handlers as
 * before; nothing about persistence, publishing, or permissions changes here.
 */
import type { ReactElement } from 'react'
import { Button } from '@ui/components/Button'
import { CheckIcon, PlusIcon, ReloadIcon } from '@admin/pages/data/icons'
import type { DataTable } from '@core/data/schemas'
import styles from './DataWorkbenchHeader.module.css'

type SaveStatusTone = 'success' | 'warning' | 'neutral' | 'danger'

interface DataWorkbenchHeaderProps {
  table: DataTable
  /** Live draft state, mirrored from the publish control. */
  saveStatusLabel: string
  saveStatusTone: SaveStatusTone
  /** Present only when the table supports creating rows here. */
  onCreateRow?: () => void
}

function groupLabel(kind: DataTable['kind']): string {
  if (kind === 'postType') return 'Custom post types'
  if (kind === 'data') return 'Custom tables'
  return 'System'
}

export function DataWorkbenchHeader({
  table,
  saveStatusLabel,
  saveStatusTone,
  onCreateRow,
}: DataWorkbenchHeaderProps): ReactElement {
  const createVerb = table.kind === 'data' ? 'Add' : 'New'
  const createLabel = `${createVerb} ${table.singularLabel.toLowerCase()}`
  const busy = saveStatusLabel === 'Saving draft'

  return (
    <header className={styles.header}>
      <nav className={styles.breadcrumb} aria-label="Data table">
        <span className={styles.crumb}>{groupLabel(table.kind)}</span>
        <b className={styles.crumbSep} aria-hidden="true">/</b>
        <strong className={styles.crumbCurrent}>{table.pluralLabel}</strong>
      </nav>

      <output
        className={styles.saveState}
        data-state={saveStatusTone}
        aria-live="polite"
      >
        {busy
          ? <ReloadIcon size={14} aria-hidden="true" />
          : <CheckIcon size={14} aria-hidden="true" />}
        <span className={styles.saveStateLabel}>{saveStatusLabel}</span>
      </output>

      <div className={styles.actions}>
        {onCreateRow && (
          <Button
            variant="secondary"
            size="sm"
            className={styles.createAction}
            onClick={onCreateRow}
          >
            <PlusIcon size={13} aria-hidden="true" />
            <span className={styles.createLabel}>{createLabel}</span>
          </Button>
        )}
      </div>
    </header>
  )
}
