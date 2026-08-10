import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ContextMenu,
  ContextMenuItem,
} from '@ui/components/ContextMenu'
import { CircleAlertSolidIcon, CopySolidIcon, ExternalLinkSolidIcon, LayoutSolidIcon, OpenSolidIcon, SaveSolidIcon, TrashSolidIcon, UploadIcon } from '@admin/pages/data/icons'
import type { DataRow, DataRowStatus, DataTable } from '@core/data/schemas'

interface DataRowContextMenuProps {
  x: number
  y: number
  row: DataRow
  table: DataTable
  onClose: () => void
  onInspectRow: () => void
  onOpenRow?: (rowId: string) => void
  onDuplicateRow?: (row: DataRow) => void | Promise<void>
  onEditInContent?: (row: DataRow) => void
  onOpenInSiteEditor?: (row: DataRow) => void
  onSetRowStatus?: (rowId: string, status: DataRowStatus) => Promise<DataRow>
  onExportRows?: (rowIds: string[]) => void
  onDeleteRow?: (rowId: string) => void
}

interface PrimaryAction {
  label: string
  icon: ReactNode
  run: () => void
}

function hasPublishWorkflow(table: DataTable): boolean {
  return table.kind === 'postType' || table.kind === 'page' || table.kind === 'component'
}

function primaryActionForRow({
  row,
  table,
  onOpenRow,
  onEditInContent,
  onOpenInSiteEditor,
}: Pick<
  DataRowContextMenuProps,
  'row' | 'table' | 'onOpenRow' | 'onEditInContent' | 'onOpenInSiteEditor'
>): PrimaryAction | null {
  if (table.kind === 'postType' && onEditInContent != null) {
    return {
      label: 'Edit in Content',
      icon: <ExternalLinkSolidIcon size={13} />,
      run: () => onEditInContent(row),
    }
  }

  if ((table.kind === 'page' || table.kind === 'component') && onOpenInSiteEditor != null) {
    return {
      label: 'Open in Site editor',
      icon: <LayoutSolidIcon size={13} />,
      run: () => onOpenInSiteEditor(row),
    }
  }

  if (onOpenRow != null) {
    return {
      label: 'Open row',
      icon: <OpenSolidIcon size={13} />,
      run: () => onOpenRow(row.id),
    }
  }

  return null
}

async function setRowStatusFromMenu(
  rowId: string,
  status: DataRowStatus,
  onSetRowStatus: (rowId: string, status: DataRowStatus) => Promise<DataRow>,
  onClose: () => void,
): Promise<void> {
  try {
    await onSetRowStatus(rowId, status)
    onClose()
  } catch (err) {
    console.error('[DataRowContextMenu] Set row status failed:', err)
  }
}

async function duplicateRowFromMenu(
  row: DataRow,
  onDuplicateRow: (row: DataRow) => void | Promise<void>,
  onClose: () => void,
): Promise<void> {
  try {
    await onDuplicateRow(row)
    onClose()
  } catch (err) {
    console.error('[DataRowContextMenu] Duplicate row failed:', err)
  }
}

export function DataRowContextMenu({
  x,
  y,
  row,
  table,
  onClose,
  onInspectRow,
  onOpenRow,
  onDuplicateRow,
  onEditInContent,
  onOpenInSiteEditor,
  onSetRowStatus,
  onExportRows,
  onDeleteRow,
}: DataRowContextMenuProps): ReactElement | null {
  const firstItemRef = useRef<HTMLButtonElement>(null)
  const primaryAction = primaryActionForRow({
    row,
    table,
    onOpenRow,
    onEditInContent,
    onOpenInSiteEditor,
  })
  const publishable = hasPublishWorkflow(table) && onSetRowStatus != null

  useEffect(() => {
    firstItemRef.current?.focus()
  }, [])

  function runAndClose(action: () => void): void {
    action()
    onClose()
  }

  return createPortal(
    <ContextMenu x={x} y={y} ariaLabel="Row actions" onClose={onClose}>
      {primaryAction !== null && (
        <ContextMenuItem
          ref={firstItemRef}
          onClick={() => runAndClose(primaryAction.run)}
        >
          <span aria-hidden="true">{primaryAction.icon}</span>
          {primaryAction.label}
        </ContextMenuItem>
      )}

      {/* The approved screen's menu opens straight onto the row's primary
          action — there is no separate "Inspect row" entry, because clicking
          the row already opens the inspector. */}
      {primaryAction === null && (
        <ContextMenuItem
          ref={firstItemRef}
          onClick={() => runAndClose(onInspectRow)}
        >
          <span aria-hidden="true"><ExternalLinkSolidIcon size={14} /></span>
          Inspect record
        </ContextMenuItem>
      )}

      {onDuplicateRow != null && (
        <ContextMenuItem
          onClick={() => {
            void duplicateRowFromMenu(row, onDuplicateRow, onClose)
          }}
        >
          <span aria-hidden="true"><CopySolidIcon size={13} /></span>
          Duplicate row
        </ContextMenuItem>
      )}

      {/* Status transitions. The approved screen HIDES the transition a row is
          already in rather than showing it disabled, so the menu only ever
          offers moves that would actually change something. */}
      {publishable && row.status !== 'published' && (
        <ContextMenuItem
          onClick={() => {
            void setRowStatusFromMenu(row.id, 'published', onSetRowStatus, onClose)
          }}
        >
          <span aria-hidden="true"><UploadIcon size={14} /></span>
          Publish
        </ContextMenuItem>
      )}
      {publishable && row.status !== 'draft' && (
        <ContextMenuItem
          onClick={() => {
            void setRowStatusFromMenu(row.id, 'draft', onSetRowStatus, onClose)
          }}
        >
          <span aria-hidden="true"><SaveSolidIcon size={14} /></span>
          Move to draft
        </ContextMenuItem>
      )}
      {publishable && row.status === 'published' && (
        <ContextMenuItem
          onClick={() => {
            void setRowStatusFromMenu(row.id, 'unpublished', onSetRowStatus, onClose)
          }}
        >
          <span aria-hidden="true"><CircleAlertSolidIcon size={14} /></span>
          Unpublish
        </ContextMenuItem>
      )}

      {onExportRows != null && (
        <ContextMenuItem onClick={() => runAndClose(() => onExportRows([row.id]))}>
          <span aria-hidden="true"><UploadIcon size={14} /></span>
          Export row
        </ContextMenuItem>
      )}

      {onDeleteRow != null && (
        <ContextMenuItem danger onClick={() => runAndClose(() => onDeleteRow(row.id))}>
          <span aria-hidden="true"><TrashSolidIcon size={13} /></span>
          Delete row
        </ContextMenuItem>
      )}
    </ContextMenu>,
    document.body,
  )
}
