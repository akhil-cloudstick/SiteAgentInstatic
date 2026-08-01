/**
 * DataWorkbenchHeader — the row above the data grid card.
 *
 * Left: a breadcrumb (table group / table name). Right: the publish/save-state
 * control, export + import, and the kind-aware create action ("New case
 * study" / "Add testimonial"). Presentation only — every control is wired to
 * the same DataPage handlers the toolbar used before; nothing about
 * persistence, publishing, or permissions changes here.
 */
import type { ReactElement, ReactNode } from 'react'
import { Button } from '@ui/components/Button'
import { ArrowDownIcon } from 'pixel-art-icons/icons/arrow-down'
import { UploadIcon } from 'pixel-art-icons/icons/upload'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import type { DataTable } from '@core/data/schemas'
import styles from './DataWorkbenchHeader.module.css'

interface DataWorkbenchHeaderProps {
  table: DataTable
  /** The PublishActionGroup element (status + publish + save-draft menu). */
  publishSlot?: ReactNode
  onOpenExport?: () => void
  onOpenImport?: () => void
  canExport: boolean
  canImport: boolean
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
  publishSlot,
  onOpenExport,
  onOpenImport,
  canExport,
  canImport,
  onCreateRow,
}: DataWorkbenchHeaderProps): ReactElement {
  const createVerb = table.kind === 'data' ? 'Add' : 'New'
  const createLabel = `${createVerb} ${table.singularLabel.toLowerCase()}`

  return (
    <header className={styles.header}>
      <nav className={styles.breadcrumb} aria-label="Data table">
        <span className={styles.crumb}>{groupLabel(table.kind)}</span>
        <span className={styles.crumbSep} aria-hidden="true">/</span>
        <span className={styles.crumbCurrent}>{table.pluralLabel}</span>
      </nav>

      <span className={styles.spacer} />

      <div className={styles.actions}>
        {publishSlot}
        {canExport && onOpenExport && (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Export site"
            tooltip="Export site"
            onClick={onOpenExport}
          >
            <ArrowDownIcon size={14} aria-hidden="true" />
          </Button>
        )}
        {canImport && onOpenImport && (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Import site"
            tooltip="Import site"
            onClick={onOpenImport}
          >
            <UploadIcon size={14} aria-hidden="true" />
          </Button>
        )}
        {onCreateRow && (
          <Button variant="secondary" size="sm" onClick={onCreateRow}>
            <PlusIcon size={12} aria-hidden="true" />
            {createLabel}
          </Button>
        )}
      </div>
    </header>
  )
}
