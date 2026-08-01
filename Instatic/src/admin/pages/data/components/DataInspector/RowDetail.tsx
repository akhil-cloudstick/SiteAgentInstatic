import { useEffect, useEffectEvent, useState, type ReactElement, type ReactNode } from 'react'
import { Button } from '@ui/components/Button'
import { Section } from '@ui/components/Section'
import { ExternalLinkSolidIcon } from 'pixel-art-icons/icons/external-link-solid'
import { LayoutSolidIcon } from 'pixel-art-icons/icons/layout-solid'
import { CalendarSolidIcon } from 'pixel-art-icons/icons/calendar-solid'
import { ReloadIcon } from 'pixel-art-icons/icons/reload'
import { TargetSolidIcon } from 'pixel-art-icons/icons/target-solid'
import { UsersSolidIcon } from 'pixel-art-icons/icons/users-solid'
import { FileTextSolidIcon } from 'pixel-art-icons/icons/file-text-solid'
import { DatabaseSolidIcon } from 'pixel-art-icons/icons/database-solid'
import { SearchSolidIcon } from 'pixel-art-icons/icons/search-solid'
import type { IconComponent } from 'pixel-art-icons/types'
import { CellEditorRenderer } from '@admin/pages/data/components/DataGrid/cells/CellEditorRenderer'
import { RelationPickerDialog } from '@admin/pages/data/components/RelationPickerDialog/RelationPickerDialog'
import { useDataRowDraft } from '@admin/pages/data/hooks/useDataRowDraft'
import { emptyCellValue } from '@admin/pages/data/utils/fieldDefaults'
import type { DataTable, DataRow, DataRowCells } from '@core/data/schemas'
import type { DataField } from '@core/data/schemas'
import styles from './DataInspector.module.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RowDetailProps {
  row: DataRow
  table: DataTable
  tables: DataTable[]
  onSaveRow: (rowId: string, cells: DataRowCells) => Promise<DataRow>
  /** Navigate the Content page to edit this post-type row. */
  onEditInContent?: (row: DataRow) => void
  /** Navigate the Site editor to open this page or component row. */
  onOpenInSiteEditor?: (row: DataRow) => void
  onPublishRow?: (rowId: string) => Promise<DataRow>
  onSetRowStatus?: (rowId: string, status: 'draft' | 'unpublished') => Promise<DataRow>
  /** Resolve a row id to a row object for display in relation cells. */
  resolveRow: (rowId: string) => DataRow | null
  canEdit: boolean
  onDraftStateChange?: (state: DataRowDraftState | null) => void
}

export interface DataRowDraftState {
  isDirty: boolean
  isSaving: boolean
  saveError: string | null
  flush: () => Promise<DataRow | null>
}

interface PickerState {
  fieldId: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function statusLabel(status: DataRow['status']): string {
  switch (status) {
    case 'published': return 'Published'
    case 'unpublished': return 'Unpublished'
    default: return 'Draft'
  }
}

function authorDisplayName(row: DataRow): string {
  const user = row.author ?? row.createdBy ?? row.updatedBy
  if (user?.displayName) return user.displayName
  if (user?.email) return user.email
  return '—'
}

function primaryDisplayValue(row: DataRow, table: DataTable): string {
  const v = row.cells[table.primaryFieldId]
  if (typeof v === 'string' && v.length > 0) return v
  return row.id
}

// ---------------------------------------------------------------------------
// Field grouping (record kinds only)
//
// The approved record inspector splits fields into progressive-disclosure
// sections — "Core content", the table-specific details, and "SEO". This is a
// presentation grouping derived from field id/type; it never changes which
// fields are editable or how they persist. Empty groups are dropped.
// ---------------------------------------------------------------------------

const CORE_CONTENT_TYPES: ReadonlySet<DataField['type']> = new Set([
  'richText',
  'longText',
  'pageTree',
])

interface FieldGroup {
  key: 'core' | 'details' | 'seo'
  title: string
  icon: IconComponent
  fields: DataField[]
}

function isSeoField(field: DataField): boolean {
  return field.id.toLowerCase().startsWith('seo')
}

function groupRowFields(table: DataTable): FieldGroup[] {
  const core: DataField[] = []
  const details: DataField[] = []
  const seo: DataField[] = []

  for (const field of table.fields) {
    if (isSeoField(field)) seo.push(field)
    else if (field.id === table.primaryFieldId || CORE_CONTENT_TYPES.has(field.type)) core.push(field)
    else details.push(field)
  }

  const detailsTitle = table.singularLabel ? `${table.singularLabel} details` : 'Details'
  const groups: FieldGroup[] = [
    { key: 'core', title: 'Core content', icon: FileTextSolidIcon, fields: core },
    { key: 'details', title: detailsTitle, icon: DatabaseSolidIcon, fields: details },
    { key: 'seo', title: 'SEO', icon: SearchSolidIcon, fields: seo },
  ]
  return groups.filter((group) => group.fields.length > 0)
}

// ---------------------------------------------------------------------------
// RowHeaderCard — title + status + a single action button.
//
// Used for the three kinds that have a separate rich editor: `postType`
// (Edit in Content), `page` and `component` (Open in Site editor). The
// action button is wired by the parent through `onAction`.
// ---------------------------------------------------------------------------

function RowHeaderCard({
  primaryValue,
  status,
  actionLabel,
  actionIcon,
  actionAriaLabel,
  onAction,
}: {
  primaryValue: string
  status: DataRow['status']
  actionLabel: string
  actionIcon: ReactNode
  actionAriaLabel: string
  onAction?: () => void
}): ReactElement {
  return (
    <div className={styles.rowHeader}>
      <span className={styles.rowHeaderTitle}>{primaryValue || '(untitled)'}</span>
      <span className={styles.statusLine}>
        <span className={styles.statusDot} data-status={status} aria-hidden="true" />
        <span className={styles.statusText}>{statusLabel(status)}</span>
      </span>

      <Button
        variant="primary"
        size="sm"
        fullWidth
        onClick={() => onAction?.()}
        disabled={!onAction}
        aria-label={actionAriaLabel}
      >
        {actionIcon}
        {actionLabel}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// RowMetaBlock — created / updated / published / author summary.
// ---------------------------------------------------------------------------

function MetaItem({ icon: Icon, label, value }: {
  icon: IconComponent
  label: string
  value: string
}): ReactElement {
  return (
    <div className={styles.metaItem}>
      <span className={styles.metaIcon} aria-hidden="true">
        <Icon size={14} />
      </span>
      <span className={styles.metaKey}>{label}</span>
      <span className={styles.metaValue}>{value}</span>
    </div>
  )
}

function RowMetaBlock({ row }: { row: DataRow }): ReactElement {
  return (
    <div className={styles.metaBlock}>
      <MetaItem icon={CalendarSolidIcon} label="Created" value={formatDate(row.createdAt)} />
      <MetaItem icon={ReloadIcon} label="Updated" value={formatDate(row.updatedAt)} />
      <MetaItem icon={TargetSolidIcon} label="Published" value={formatDate(row.publishedAt)} />
      <MetaItem icon={UsersSolidIcon} label="Author" value={authorDisplayName(row)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// DataRowForm — inline-editable fields.
// ---------------------------------------------------------------------------

function DataRowForm({
  row,
  table,
  tables,
  onSaveRow,
  resolveRow,
  canEdit,
  grouped,
  onOpenEditor,
  onDraftStateChange,
}: {
  row: DataRow
  table: DataTable
  tables: DataTable[]
  onSaveRow: (rowId: string, cells: DataRowCells) => Promise<DataRow>
  resolveRow: (rowId: string) => DataRow | null
  canEdit: boolean
  /** Record kinds render fields inside progressive-disclosure Sections; plain
   *  `data` tables keep the flat single-section layout. */
  grouped: boolean
  /** Forwarded to PageTreeCell — opens the visual editor for this row. */
  onOpenEditor?: () => void
  onDraftStateChange?: (state: DataRowDraftState | null) => void
}): ReactElement {
  const draft = useDataRowDraft(row, onSaveRow)
  const [pickerState, setPickerState] = useState<PickerState | null>(null)

  // Derive picker props from pickerState
  const pickerField: DataField | null = pickerState
    ? (table.fields.find((f) => f.id === pickerState.fieldId) ?? null)
    : null

  const pickerTargetTable = pickerField?.type === 'relation'
    ? (tables.find((t) => t.id === pickerField.targetTableId) ?? null)
    : null

  const pickerCurrentValue = pickerState
    ? ((draft.cells[pickerState.fieldId] ?? null) as string | string[] | null)
    : null

  const pickerAllowMultiple = pickerField?.type === 'relation'
    ? (pickerField.allowMultiple ?? false)
    : false

  const reportDraftState = useEffectEvent(() => {
    onDraftStateChange?.({
      isDirty: draft.isDirty,
      isSaving: draft.isSaving,
      saveError: draft.saveError,
      flush: draft.flush,
    })
  })
  useEffect(() => {
    reportDraftState()
    return () => onDraftStateChange?.(null)
  }, [draft.isDirty, draft.isSaving, draft.saveError, onDraftStateChange])

  function renderField(field: DataField): ReactElement {
    return (
      <div key={field.id} className={styles.formGroup}>
        {field.type !== 'repeater' && (
          <>
            <span className={styles.label}>{field.label}</span>
            {field.description && (
              <span className={styles.labelDescription}>{field.description}</span>
            )}
          </>
        )}
        <CellEditorRenderer
          field={field}
          value={draft.cells[field.id] ?? emptyCellValue(field)}
          onChange={(next) => draft.setCell(field.id, next)}
          onCommit={() => void draft.flush()}
          context="detail"
          readOnly={!canEdit}
          rowId={row.id}
          tables={tables}
          resolveRelationTarget={resolveRow}
          onOpenPicker={
            field.type === 'relation'
              ? () => setPickerState({ fieldId: field.id })
              : undefined
          }
          onOpenEditor={field.type === 'pageTree' ? onOpenEditor : undefined}
        />
      </div>
    )
  }

  const saveStatus = (draft.isSaving || draft.saveError) ? (
    <div className={styles.saveStatus} aria-live="polite" aria-atomic="true">
      {draft.isSaving && (
        <span className={styles.savingText}>Saving…</span>
      )}
      {!draft.isSaving && draft.saveError && (
        <span className={styles.saveErrorText} role="alert">{draft.saveError}</span>
      )}
    </div>
  ) : null

  const groups = grouped ? groupRowFields(table) : null

  return (
    <>
      {groups ? (
        <div className={styles.fieldSections}>
          {groups.map((group, index) => (
            <Section
              key={group.key}
              title={group.title}
              icon={group.icon}
              defaultOpen={group.key === 'details' || (group.key === 'core' && index === 0 && groups.length === 1)}
            >
              <div className={styles.sectionFields}>
                {group.fields.map(renderField)}
              </div>
            </Section>
          ))}
          {saveStatus}
        </div>
      ) : (
        <div className={styles.section}>
          {table.fields.map(renderField)}
          {saveStatus}
        </div>
      )}

      <RelationPickerDialog
        open={pickerState !== null}
        onClose={() => setPickerState(null)}
        targetTable={pickerTargetTable}
        currentValue={pickerCurrentValue}
        allowMultiple={pickerAllowMultiple}
        onPick={(next) => {
          if (pickerState) {
            draft.setCell(pickerState.fieldId, next)
            void draft.flush()
          }
          setPickerState(null)
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// RowDetail
//
// Composition rules per kind:
//
//   - `postType`  → RowHeaderCard (Edit in Content) + RowMetaBlock + DataRowForm
//   - `page`      → RowHeaderCard (Open in Site editor) + RowMetaBlock + DataRowForm
//   - `component` → RowHeaderCard (Open in Site editor) + RowMetaBlock + DataRowForm
//   - `data`      → DataRowForm only (no rich editor, no publish lifecycle)
//
// `onEditInContent` and `onOpenInSiteEditor` are the two navigation handlers
// the parent (DataPage) wires up. Only one is consumed per row based on the
// table's `kind`.
// ---------------------------------------------------------------------------

export function RowDetail({
  row,
  table,
  tables,
  onSaveRow,
  onEditInContent,
  onOpenInSiteEditor,
  onPublishRow: _onPublishRow,
  onSetRowStatus: _onSetRowStatus,
  resolveRow,
  canEdit,
  onDraftStateChange,
}: RowDetailProps): ReactElement {
  const showHeader = table.kind === 'postType' || table.kind === 'page' || table.kind === 'component'

  // Pick the right action for the header card based on kind. The handlers
  // are wired at the DataPage level; here we just dispatch on `kind`.
  const primaryValue = primaryDisplayValue(row, table)
  let headerCard: ReactElement | null = null

  if (table.kind === 'postType') {
    headerCard = (
      <RowHeaderCard
        primaryValue={primaryValue}
        status={row.status}
        actionLabel="Edit in Content"
        actionIcon={<ExternalLinkSolidIcon size={12} aria-hidden="true" />}
        actionAriaLabel={`Edit ${primaryValue} in Content`}
        onAction={onEditInContent ? () => onEditInContent(row) : undefined}
      />
    )
  } else if (table.kind === 'page' || table.kind === 'component') {
    headerCard = (
      <RowHeaderCard
        primaryValue={primaryValue}
        status={row.status}
        actionLabel="Open in Site editor"
        actionIcon={<LayoutSolidIcon size={12} aria-hidden="true" />}
        actionAriaLabel={`Open ${primaryValue} in Site editor`}
        onAction={onOpenInSiteEditor ? () => onOpenInSiteEditor(row) : undefined}
      />
    )
  }

  // Wire the inline body cell's "Open editor →" button for page/component kinds.
  const formOpenEditor = (table.kind === 'page' || table.kind === 'component') && onOpenInSiteEditor
    ? () => onOpenInSiteEditor(row)
    : undefined

  return (
    <>
      {showHeader && (
        <div className={styles.section}>
          {headerCard}
          <RowMetaBlock row={row} />
        </div>
      )}
      <DataRowForm
        row={row}
        table={table}
        tables={tables}
        onSaveRow={onSaveRow}
        resolveRow={resolveRow}
        canEdit={canEdit}
        grouped={showHeader}
        onOpenEditor={formOpenEditor}
        onDraftStateChange={onDraftStateChange}
      />
      {showHeader && (
        <p className={styles.deselectHint}>Deselect the row to manage table fields.</p>
      )}
    </>
  )
}
