/**
 * NewTableDialog — the approved screen's `NewTableComposer`, verbatim.
 *
 * The reference asks for exactly three things: a table name, a kind, and an
 * ordered list of initial fields (label + type). Everything else it derives —
 * slug from the name, singular/plural labels from the name, the primary field
 * from the kind's guarded base fields. That derivation lives in
 * `deriveTableInput` below, so the dialog stays as small as the mock's while
 * the server still receives a fully-formed `CreateDataTableInput`.
 *
 * Field id, type and order remain immutable once created — the same guarantee
 * the richer composer gave — because they are only ever set here, at creation.
 */
import { useState, type ReactElement } from 'react'
import { Dialog } from '@ui/components/Dialog'
import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import {
  DATA_FIELD_TYPES,
  type CreateDataTableInput,
  type DataField,
  type DataFieldType,
  type DataTable,
  type DataTableKind,
} from '@core/data/schemas'
import { StepUpCancelledMessage } from '@admin/shared/StepUp'
import { getErrorMessage } from '@core/utils/errorMessage'
import { PlusIcon, TrashSolidIcon } from '@admin/pages/data/icons'
import styles from './NewTableDialog.module.css'

interface NewTableDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (input: CreateDataTableInput) => Promise<void>
  tables: DataTable[]
  variant?: 'table' | 'collection'
}

/** The reference's two kinds, in its wording. */
const KIND_OPTIONS: ReadonlyArray<{ value: DataTableKind; label: string }> = [
  { value: 'data', label: 'Plain data' },
  { value: 'postType', label: 'Custom post type' },
]

/**
 * The field types a user may pick at creation. `pageTree` and `fieldSchema` are
 * excluded — they are structural document types with their own dedicated
 * editors, exactly as the reference's `AUTHORABLE_FIELD_TYPES` excludes them.
 */
const AUTHORABLE_FIELD_TYPES = DATA_FIELD_TYPES.filter(
  (type) => type !== 'pageTree' && type !== 'fieldSchema',
)

interface DraftField {
  id: string
  label: string
  type: DataFieldType
}

/** `Project facts` → `projectFacts`, matching the reference's machine-id rule. */
function toMachineId(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, next: string | undefined) => next?.toUpperCase() ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
}

function toSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

/**
 * Builds the guarded base schema for a kind, then appends the user's fields.
 *
 * Post types start with the mandatory `title` / `slug` plus a `body`; plain data
 * tables start with `name`. Base ids win over a user field of the same id, so a
 * table can never end up with two `title` columns.
 */
function deriveTableInput(
  name: string,
  kind: DataTableKind,
  drafts: DraftField[],
): CreateDataTableInput {
  const trimmed = name.trim()
  const baseFields: DataField[] = kind === 'postType'
    ? [
        { type: 'text', id: 'title', label: 'Title', required: true },
        { type: 'text', id: 'slug', label: 'Slug', required: true },
        { type: 'richText', id: 'body', label: 'Body', format: 'markdown', builtIn: true },
      ]
    : [{ type: 'text', id: 'name', label: 'Name', required: true }]

  const extras = drafts
    .filter((draft) => !baseFields.some((base) => base.id === draft.id))
    .map((draft) => ({ type: draft.type, id: draft.id, label: draft.label } as DataField))

  return {
    name: trimmed,
    slug: toSlug(trimmed),
    kind,
    singularLabel: trimmed.replace(/s$/i, '') || 'Record',
    pluralLabel: trimmed,
    primaryFieldId: kind === 'postType' ? 'title' : 'name',
    fields: [...baseFields, ...extras],
  }
}

export function NewTableDialog({
  open,
  onClose,
  onCreate,
  tables,
}: NewTableDialogProps): ReactElement {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<DataTableKind>('data')
  const [fieldLabel, setFieldLabel] = useState('')
  const [fieldType, setFieldType] = useState<DataFieldType>('text')
  const [fields, setFields] = useState<DraftField[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedName = name.trim()
  const nameTaken = tables.some(
    (table) => table.name.toLowerCase() === trimmedName.toLowerCase(),
  )
  const canCreate = trimmedName.length > 0 && !nameTaken && !saving

  function addDraftField(): void {
    const id = toMachineId(fieldLabel)
    if (!id || fields.some((field) => field.id === id)) return
    setFields((current) => [...current, { id, label: fieldLabel.trim(), type: fieldType }])
    setFieldLabel('')
  }

  async function handleCreate(): Promise<void> {
    if (!canCreate) return
    setSaving(true)
    setError(null)
    try {
      await onCreate(deriveTableInput(name, kind, fields))
    } catch (err) {
      if (err instanceof Error && err.message === StepUpCancelledMessage) {
        setSaving(false)
        return
      }
      console.error('[NewTableDialog] Create table failed:', err)
      setError(getErrorMessage(err, 'Could not create the table'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New table"
      size="sm"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => { void handleCreate() }} disabled={!canCreate}>
            Create table
          </Button>
        </>
      )}
    >
      <p className={styles.intro}>
        Choose a plain data table for operational records or a custom post type
        for Content-managed entries, then create its initial schema in the same
        guarded action.
      </p>

      <div className={styles.fieldControl}>
        <label className={styles.label} htmlFor="new-table-name">Table name</label>
        <Input
          id="new-table-name"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        {nameTaken && (
          <p className={styles.error} role="alert">A table named “{trimmedName}” already exists.</p>
        )}
      </div>

      <div className={styles.fieldControl}>
        <label className={styles.label} htmlFor="new-table-kind">Kind</label>
        <Select
          id="new-table-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as DataTableKind)}
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
      </div>

      <div className={styles.schemaDraft}>
        <h3 className={styles.schemaHeading}>Initial fields</h3>
        <p className={styles.schemaCopy}>
          {kind === 'postType'
            ? 'Title, slug, and body are added as guarded post-type fields.'
            : 'Name is added as the primary field.'}
        </p>

        {fields.map((field) => (
          <div className={styles.draftRow} key={field.id}>
            <span className={styles.draftRowText}>
              <b className={styles.draftLabel}>{field.label}</b>
              <small className={styles.draftType}>{field.type}</small>
            </span>
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              tone="danger"
              dangerHover
              aria-label={`Remove ${field.label}`}
              tooltip={`Remove ${field.label}`}
              onClick={() => setFields((current) => current.filter((item) => item.id !== field.id))}
            >
              <TrashSolidIcon size={13} aria-hidden="true" />
            </Button>
          </div>
        ))}

        <div className={styles.draftAdd}>
          <Input
            aria-label="Field label"
            placeholder="Field label"
            className={styles.draftAddInput}
            value={fieldLabel}
            onChange={(event) => setFieldLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              addDraftField()
            }}
          />
          <Select
            aria-label="Field type"
            className={styles.draftAddSelect}
            value={fieldType}
            onChange={(event) => setFieldType(event.target.value as DataFieldType)}
          >
            {AUTHORABLE_FIELD_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </Select>
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label="Add field to table schema"
            tooltip="Add field to table schema"
            disabled={fieldLabel.trim().length === 0}
            onClick={addDraftField}
          >
            <PlusIcon size={13} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {error != null && <p className={styles.error} role="alert">{error}</p>}
    </Dialog>
  )
}
