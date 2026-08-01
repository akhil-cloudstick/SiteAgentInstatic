import { Suspense, lazy, type ReactNode } from 'react'
import { Button } from '@ui/components/Button'
import { Input, Textarea } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { SkeletonBlock } from '@ui/components/Skeleton'
import { RemixIcon } from '@ui/components/RemixIcon'
import { cn } from '@ui/cn'
import { Copy2SolidIcon } from 'pixel-art-icons/icons/copy-2-solid'
import { Settings2SolidIcon } from 'pixel-art-icons/icons/settings-2-solid'
import type { CmsMediaAsset } from '@core/persistence'
import { MediaPickerField } from '@admin/pages/media/components/MediaPickerField'
import { useWorkspaceLayout } from '@admin/state/workspaceLayout'
import { dataTableHasField } from '@core/data/fields'
import {
  POST_TYPE_FIELD_FEATURED_MEDIA,
  POST_TYPE_FIELD_SEO_TITLE,
  type DataField,
  type DataRowCells,
  type DataTable,
  type DataRow,
  type DataRowStatus,
  type DataUserReference,
} from '@core/data/schemas'
import propertiesStyles from '../../../site/panels/PropertiesPanel/PropertiesPanel.module.css'
import { PanelHeader } from '@admin/shared/PanelHeader'
import styles from '../../ContentPage.module.css'

// Lazy-load the generic custom-field editors: they pull in the Data
// workspace's cell-editor graph (media picker workspace, relation picker),
// which is too heavy for the Content page's initial chunk budget. Only
// collections that actually have custom fields pay for it.
const ContentCustomFields = lazy(() =>
  import('./ContentCustomFields').then((m) => ({ default: m.ContentCustomFields })),
)

interface ContentSettingsPanelProps {
  selectedEntry: DataRow | null
  authors: DataUserReference[]
  authorsLoading: boolean
  collections: DataTable[]
  /** Every data table (all kinds) — relation custom fields can target any of them. */
  tables: DataTable[]
  selectedCollection: DataTable | null
  loading: boolean
  slug: string
  slugId: string
  seoTitle: string
  seoTitleId: string
  seoDescription: string
  seoDescriptionId: string
  publicPath: string
  mediaError: string | null
  featuredMediaId: string | null
  featuredMediaAsset: CmsMediaAsset | null
  /** Draft values of the collection's custom (non-built-in) fields, keyed by field id. */
  customCells: DataRowCells
  canEditEntry: boolean
  canMoveEntry: boolean
  canPublishEntry: boolean
  canChangeAuthor: boolean
  onCollectionChange: (tableId: string) => void
  onAuthorChange: (authorUserId: string) => void
  onSlugChange: (value: string) => void
  onSeoTitleChange: (value: string) => void
  onSeoDescriptionChange: (value: string) => void
  onCustomCellChange: (fieldId: string, value: unknown) => void
  onStatusChange: (status: DataRowStatus) => void
  onChooseFeaturedMedia: () => void
  onClearFeaturedMedia: () => void
  /**
   * Open the MediaViewerWindow on the currently-picked featured media asset.
   * Hidden when `featuredMediaAsset` is null (nothing to edit yet).
   */
  onEditFeaturedMedia: () => void
}

function contentAuthor(entry: DataRow): DataUserReference | null {
  return entry.author ?? entry.createdBy ?? entry.updatedBy ?? null
}

function contentAuthorLabel(entry: DataRow): string {
  const user = contentAuthor(entry)
  if (user?.displayName) return user.displayName
  if (user?.email) return user.email
  return 'Unknown user'
}

function contentAuthorRoleLabel(entry: DataRow): string | null {
  const author = contentAuthor(entry)
  return author?.roleName ?? author?.roleSlug ?? null
}

function authorOptionLabel(author: DataUserReference): string {
  return author.displayName || author.email || 'Unknown user'
}

/**
 * Human-readable schedule state for the Publishing card. Derived from the
 * row's real `scheduledPublishAt` — never fabricated. Renders "Not scheduled"
 * when the field is null/absent (the common case) or unparseable.
 */
function scheduleLabel(entry: DataRow | null): string {
  const iso = entry?.scheduledPublishAt
  if (!iso) return 'Not scheduled'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Not scheduled'
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Custom fields the settings panel can edit: everything the user added to
 * the collection. `pageTree` / `fieldSchema` cells hold whole documents
 * (a node tree / a field array), not values — they have dedicated editors
 * and never belong to a generic input.
 */
function isEditableCustomField(field: DataField): boolean {
  return field.builtIn !== true && field.type !== 'pageTree' && field.type !== 'fieldSchema'
}

export function ContentSettingsPanel({
  selectedEntry,
  authors,
  authorsLoading,
  collections,
  tables,
  selectedCollection,
  loading,
  slug,
  slugId,
  seoTitle,
  seoTitleId,
  seoDescription,
  seoDescriptionId,
  publicPath,
  mediaError,
  featuredMediaId,
  featuredMediaAsset,
  customCells,
  canEditEntry,
  canMoveEntry,
  canPublishEntry,
  canChangeAuthor,
  onCollectionChange,
  onAuthorChange,
  onSlugChange,
  onSeoTitleChange,
  onSeoDescriptionChange,
  onCustomCellChange,
  onStatusChange,
  onChooseFeaturedMedia,
  onClearFeaturedMedia,
  onEditFeaturedMedia,
}: ContentSettingsPanelProps) {
  const setRightPanel = useWorkspaceLayout((s) => s.setRightPanel)
  const seoEnabled = selectedCollection ? dataTableHasField(selectedCollection, POST_TYPE_FIELD_SEO_TITLE) : false
  // SEO "Complete" is a presentation-derived summary of the available SEO
  // title/description fields — NOT a persisted status or a validation API (per
  // the guide). Computed locally so the criteria are transparent.
  const seoComplete = seoTitle.trim().length > 0 && seoDescription.trim().length > 0
  const featuredMediaEnabled = selectedCollection ? dataTableHasField(selectedCollection, POST_TYPE_FIELD_FEATURED_MEDIA) : false
  const customFields = selectedCollection?.fields.filter(isEditableCustomField) ?? []
  const authorRoleLabel = selectedEntry ? contentAuthorRoleLabel(selectedEntry) : null
  const selectedAuthor = selectedEntry ? contentAuthor(selectedEntry) : null
  const authorOptions = selectedAuthor && !authors.some((author) => author.id === selectedAuthor.id)
    ? [selectedAuthor, ...authors]
    : authors
  const canEditSelectedEntry = Boolean(selectedEntry && canEditEntry)
  const canMoveSelectedEntry = Boolean(selectedEntry && canMoveEntry)
  const canChangeStatus = Boolean(selectedEntry && (canEditEntry || canPublishEntry))
  const statusOptions = [
    { value: 'draft', label: 'Draft', enabled: canEditEntry },
    { value: 'scheduled', label: 'Scheduled', enabled: false },
    { value: 'published', label: 'Published', enabled: canPublishEntry },
    { value: 'unpublished', label: 'Unpublished', enabled: canEditEntry },
  ].filter((option) => option.enabled || option.value === selectedEntry?.status)
    .map(({ value, label, enabled }) => ({ value, label, disabled: !enabled }))

  async function copyPublicUrl() {
    if (!publicPath) return
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${publicPath}`)
    } catch (err) {
      console.error('[ContentSettingsPanel] copy public URL error:', err)
    }
  }

  return (
    <aside
      data-panel=""
      data-testid="content-settings-panel"
      role="complementary"
      aria-label="Content settings"
      className={cn(propertiesStyles.panel, propertiesStyles.panelDocked)}
    >
      <PanelHeader
        panelId="content-settings"
        title="Settings"
        titleContent={(
          <span className={propertiesStyles.headerNodeTitle}>
            <Settings2SolidIcon size={13} aria-hidden="true" />
            <span className={propertiesStyles.headerNodeLabel}>Settings</span>
          </span>
        )}
        onClose={() => setRightPanel({ collapsed: true })}
      />

      <div className={styles.settingsBody}>
        {loading ? (
          <ContentSettingsLoading />
        ) : (
          <>
            {/* Presentation-level disclosure grouping (guide Screen 2). The
                underlying inputs, ids, handlers, and permission gates are
                unchanged — only their grouping/labelling is. */}
            <SettingsSection title="Publishing">
              <div className={styles.field}>
                <span>Status</span>
                <Select
                  aria-label="Status"
                  value={selectedEntry?.status ?? 'draft'}
                  disabled={!canChangeStatus}
                  onChange={(event) => {
                    const nextStatus = event.target.value as DataRowStatus
                    if (nextStatus === 'published' && !canPublishEntry) return
                    if (nextStatus !== 'published' && !canEditEntry) return
                    onStatusChange(nextStatus)
                  }}
                  options={statusOptions}
                />
              </div>
              <div className={styles.metaBlock}>
                <span>Schedule</span>
                <strong>{scheduleLabel(selectedEntry)}</strong>
              </div>
            </SettingsSection>

            <SettingsSection title="URL">
              <label className={styles.field} htmlFor={slugId}>
                <span>Slug</span>
                <Input
                  id={slugId}
                  value={slug}
                  onChange={(event) => onSlugChange(event.target.value)}
                  disabled={!canEditSelectedEntry}
                />
              </label>
              <div className={styles.metaBlock}>
                <span>Public URL</span>
                <div className={styles.urlValueRow}>
                  <strong>{publicPath || 'Not available'}</strong>
                  {publicPath && (
                    <Button
                      variant="ghost"
                      size="xs"
                      iconOnly
                      aria-label="Copy public URL"
                      tooltip="Copy URL"
                      onClick={() => void copyPublicUrl()}
                    >
                      <Copy2SolidIcon size={12} aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
            </SettingsSection>

            {seoEnabled && (
              <SettingsSection
                title="SEO"
                badge={
                  <span
                    className={cn(
                      styles.seoBadge,
                      seoComplete ? styles.seoBadgeOk : styles.seoBadgeWarn,
                    )}
                  >
                    {seoComplete ? 'Complete' : 'Incomplete'}
                  </span>
                }
              >
                <label className={styles.field} htmlFor={seoTitleId}>
                  <span>SEO title</span>
                  <Input
                    id={seoTitleId}
                    value={seoTitle}
                    onChange={(event) => onSeoTitleChange(event.target.value)}
                    disabled={!canEditSelectedEntry}
                  />
                </label>
                <label className={styles.field} htmlFor={seoDescriptionId}>
                  <span>SEO description</span>
                  <Textarea
                    id={seoDescriptionId}
                    value={seoDescription}
                    onChange={(event) => onSeoDescriptionChange(event.target.value)}
                    disabled={!canEditSelectedEntry}
                    resize="none"
                    rows={4}
                  />
                </label>
              </SettingsSection>
            )}

            {featuredMediaEnabled && (
              <SettingsSection title="Featured media">
                <div className={styles.featuredMediaField}>
                  <MediaPickerField
                    asset={featuredMediaAsset}
                    hasValue={Boolean(featuredMediaId)}
                    fallbackLabel={featuredMediaId ?? undefined}
                    fallbackHint="Saved reference"
                    mediaKind={featuredMediaAsset?.mimeType.startsWith('video/') ? 'video' : 'image'}
                    subjectLabel="featured media"
                    chooseLabel="Choose featured media"
                    disabled={!canEditSelectedEntry}
                    onBrowse={onChooseFeaturedMedia}
                    onEdit={featuredMediaAsset ? onEditFeaturedMedia : undefined}
                    onClear={featuredMediaId ? onClearFeaturedMedia : undefined}
                  />
                  {mediaError && <p className={styles.error} role="alert">{mediaError}</p>}
                </div>
              </SettingsSection>
            )}

            <SettingsSection title="Author &amp; collection">
              <div className={styles.field}>
                <span>Collection</span>
                <Select
                  aria-label="Collection"
                  value={selectedEntry?.tableId ?? selectedCollection?.id ?? ''}
                  disabled={!canMoveSelectedEntry}
                  onChange={(event) => onCollectionChange(event.target.value)}
                  options={collections.map((collection) => ({
                    value: collection.id,
                    label: collection.pluralLabel || collection.name,
                  }))}
                />
              </div>
              {selectedEntry && (
                <div className={styles.authorBlock} aria-label="Content author">
                  <span>Author</span>
                  <div className={styles.authorRow}>
                    {canChangeAuthor && authorOptions.length > 0 ? (
                      <Select
                        aria-label="Author"
                        value={selectedEntry.authorUserId ?? selectedAuthor?.id ?? ''}
                        disabled={authorsLoading}
                        onChange={(event) => onAuthorChange(event.target.value)}
                        options={authorOptions.map((author) => ({
                          value: author.id,
                          label: authorOptionLabel(author),
                        }))}
                      />
                    ) : (
                      <strong>{contentAuthorLabel(selectedEntry)}</strong>
                    )}
                    {authorRoleLabel && (
                      <span className={styles.authorRoleBadge}>{authorRoleLabel}</span>
                    )}
                  </div>
                </div>
              )}
            </SettingsSection>

            {selectedEntry && customFields.length > 0 && (
              <SettingsSection title="More fields" defaultOpen={false}>
                <Suspense fallback={null}>
                  <ContentCustomFields
                    fields={customFields}
                    entryId={selectedEntry.id}
                    tables={tables}
                    customCells={customCells}
                    readOnly={!canEditSelectedEntry}
                    onCustomCellChange={onCustomCellChange}
                  />
                </Suspense>
              </SettingsSection>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

/**
 * Collapsible settings group. Uses native `<details>`/`<summary>` for built-in
 * accessible open/close and keyboard support; the chevron rotates via CSS on
 * `[open]`. Presentation only — no draft state is split across sections.
 */
function SettingsSection({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string
  badge?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <details className={styles.settingsSection} open={defaultOpen}>
      <summary className={styles.settingsSectionSummary}>
        <span className={styles.settingsSectionTitle}>{title}</span>
        {badge}
        <RemixIcon
          name="arrow-down-s-line"
          size={16}
          className={styles.settingsSectionChevron}
        />
      </summary>
      <div className={styles.settingsSectionBody}>{children}</div>
    </details>
  )
}

function ContentSettingsLoading() {
  // Universal three-bar block — same visual as every other settings /
  // dialog / panel loading region in the editor. The bespoke
  // `settingsSkeleton*` shapes that used to render label / input /
  // textarea silhouettes have been retired in favour of
  // `<SkeletonBlock>`.
  return (
    <div
      className={styles.settingsSkeleton}
      data-testid="content-settings-loading"
      aria-busy="true"
      aria-label="Loading content settings"
    >
      <SkeletonBlock minHeight={200} />
    </div>
  )
}
