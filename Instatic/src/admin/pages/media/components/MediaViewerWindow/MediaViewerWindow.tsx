/**
 * MediaViewerWindow — the asset viewer / editor window.
 *
 * Transcribed from the MMSBUILD Media reference (`screens/media/src/App.jsx`
 * → `MediaViewer`): a titlebar, a preview column carrying the Copy URL /
 * Open actions, a Details | Folders tab pair, and a footer with the Replace
 * / Trash actions.
 *
 * The Details tab is the reference's exactly — Title, Filename, Alt text
 * (images only), Caption, Tags, then the facts grid. There is deliberately
 * no File URL row, no Open/Replace button pair and no section headings:
 * Copy URL and Open live over the preview, and Replace lives in the footer.
 *
 * The window is pinned bottom-right and is not draggable, per
 * `.media-viewer { right: 24px; bottom: 24px }`. Escape or a click outside
 * dismisses it.
 *
 * Rendered from FIVE places — the Media page, the Content page, the
 * Dashboard media widget, the Site media explorer and the Site media
 * property control — so it takes a thin `MediaAssetEditor` handle rather
 * than the workspace, and declares `data-editor-screen="media"` on its own
 * root so its palette is identical in all of them.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { cn } from '@ui/cn'
import { Input, Textarea } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { canDeleteMedia, canReplaceMedia, canWriteMedia } from '@admin/access'
import { useCurrentAdminUser } from '@admin/sessionContext'
import type { CmsMediaAsset, CmsMediaFolder, UpdateCmsMediaAssetInput } from '@core/persistence/cmsMedia'
import { bucketForMime } from '../../utils/filters'
import { useDebouncedSave } from '../../hooks/useDebouncedSave'
import { TagEditor } from '../TagEditor/TagEditor'
import { ReplaceFileDialog } from '../ReplaceFileDialog/ReplaceFileDialog'
import { ViewerBody } from '../viewers/ViewerBody'
import { formatBytes } from '../../utils/formatBytes'
import styles from './MediaViewerWindow.module.css'

type ViewerTab = 'details' | 'folders'

/**
 * Minimal contract the viewer needs. Built once for the Media page (from
 * `useMediaWorkspace`) and once for every standalone surface (from
 * `useStandaloneMediaEditor`), so the same viewer renders everywhere the
 * user can interact with an asset.
 */
export interface MediaAssetEditor {
  asset: CmsMediaAsset
  /** Existing tag palette across the library — feeds TagEditor autocomplete. */
  tagPalette: string[]
  /** Folder lookup so the viewer can label folder chips by name. */
  folderById: Map<string, CmsMediaFolder>
  /** Every folder, for the Folders tab's move control. Optional: the
   *  standalone surfaces don't own a folder list. */
  folders?: CmsMediaFolder[]
  updateAsset: (id: string, input: UpdateCmsMediaAssetInput) => Promise<CmsMediaAsset | null>
  renameAsset: (id: string, filename: string) => Promise<CmsMediaAsset | null>
  replaceAssetFile: (id: string, file: File) => Promise<CmsMediaAsset | null>
  restoreAsset: (id: string) => Promise<unknown>
  purgeAsset: (id: string) => Promise<void>
  /** Moves the asset to a folder (file-manager semantics). Optional. */
  moveToFolder?: (assetId: string, folderId: string | null) => Promise<void>
  /** Soft-deletes the asset. Optional — absent on read-only surfaces. */
  trashAsset?: (id: string) => Promise<void>
}

interface MediaViewerWindowProps {
  editor: MediaAssetEditor | null
  open: boolean
  onClose: () => void
}

export function MediaViewerWindow({ editor, open, onClose }: MediaViewerWindowProps) {
  if (!open || !editor) return null
  // Key by asset id so switching to a different asset remounts the inner
  // state (debounced-save hooks reset cleanly).
  return <ViewerForAsset key={editor.asset.id} editor={editor} onClose={onClose} />
}

interface ViewerForAssetProps {
  editor: MediaAssetEditor
  onClose: () => void
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function ViewerForAsset({ editor, onClose }: ViewerForAssetProps) {
  const currentUser = useCurrentAdminUser()
  const { asset } = editor
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [tab, setTab] = useState<ViewerTab>('details')
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const bucket = bucketForMime(asset.mimeType)
  const canWrite = canWriteMedia(currentUser)
  const canReplace = canReplaceMedia(currentUser)
  const canDelete = canDeleteMedia(currentUser)

  // The reference pins this window to the bottom-right corner
  // (`.media-viewer { right: 24px; bottom: 24px }`) and does not make it
  // draggable, so the position lives entirely in CSS.
  const panelRef = useRef<HTMLElement | null>(null)

  // Escape, or a click outside, closes.
  //
  // "Outside" deliberately EXCLUDES the media surfaces marked with
  // `data-media-surface` — the canvas and the folder sidebar. This window's
  // visibility is derived from the selection, so a click on an asset is a
  // selection change, not a dismissal. Without this exclusion a Cmd-click on
  // a second tile would close the window (clearing the selection) before the
  // toggle ran, making multi-select impossible.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    function onPointerDown(event: MouseEvent) {
      const node = panelRef.current
      if (!node) return
      const target = event.target as HTMLElement | null
      if (node.contains(target)) return
      if (target?.closest('[data-media-surface]')) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [onClose])

  // ── Save callbacks ────────────────────────────────────────────────────────
  const saveTitle = async (next: string) => {
    if (!canWrite) return
    await editor.updateAsset(asset.id, { title: next })
  }
  const saveAltText = async (next: string) => {
    if (!canWrite) return
    await editor.updateAsset(asset.id, { altText: next })
  }
  const saveCaption = async (next: string) => {
    if (!canWrite) return
    await editor.updateAsset(asset.id, { caption: next })
  }
  const saveTags = async (next: string[]) => {
    if (!canWrite) return
    await editor.updateAsset(asset.id, { tags: next })
  }

  const titleField = useDebouncedSave({ value: asset.title, save: saveTitle })
  const altField = useDebouncedSave({ value: asset.altText, save: saveAltText })
  const captionField = useDebouncedSave({ value: asset.caption, save: saveCaption })
  const tagsField = useDebouncedSave({
    value: asset.tags,
    save: saveTags,
    equals: arraysEqual,
    delay: 200,
  })

  const publicUrl = typeof window !== 'undefined'
    ? new URL(asset.publicPath, window.location.origin).toString()
    : asset.publicPath

  const copyUrl = async () => {
    if (!navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch (err) {
      console.error('[MediaViewerWindow] copy URL failed:', err)
    }
  }

  const folderNames = asset.folderIds
    .map((id) => editor.folderById.get(id)?.name ?? null)
    .filter((name): name is string => name !== null)

  const inTrash = asset.deletedAt !== null

  return createPortal(
    <aside
      ref={panelRef}
      className={cn(styles.window, expanded && styles.windowExpanded)}
      // Portals to `document.body`, so it lands outside whichever workspace
      // opened it. Declaring the media screen here keeps the palette identical
      // on the Media page, the Content page, the Dashboard and both Site
      // surfaces that render this viewer.
      data-editor-screen="media"
      role="dialog"
      aria-label={`Media details: ${asset.filename}`}
      data-testid="media-viewer-window"
      onClick={(event) => event.stopPropagation()}
    >
      <div className={styles.titlebar}>
        <div className={styles.titlebarText}>
          <span className={styles.titlebarIcon} aria-hidden="true">
            <FaIcon name="image" size={14} />
          </span>
          <span className={styles.titlebarTitle} title={asset.filename}>
            Media details
          </span>
          <span className={styles.titlebarMeta}>1 selected</span>
        </div>
        <div className={styles.titlebarActions}>
          {/* The replacement master draws the viewer expanded over the
              canvas; the adaptive-workspace master draws it as a corner
              window. Same window, one control. */}
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={expanded ? 'Collapse media viewer' : 'Expand media viewer'}
            tooltip={expanded ? 'Collapse' : 'Expand'}
            pressed={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <FaIcon name={expanded ? 'compress' : 'expand'} size={12} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Close media details"
            data-testid="panel-close-mediaDetachedInspector"
            onClick={onClose}
          >
            <FaIcon name="xmark" size={13} />
          </Button>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.preview}>
          <ViewerBody asset={asset} />
          <div className={styles.previewActions}>
            <Button
              variant="ghost"
              size="lg"
              className={styles.previewAction}
              aria-label="Copy public URL"
              onClick={() => void copyUrl()}
            >
              <FaIcon name={copied ? 'check' : 'copy'} size={13} />
              <span>{copied ? 'Copied' : 'Copy URL'}</span>
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className={styles.previewAction}
              aria-label="Open in new tab"
              onClick={() => window.open(asset.publicPath, '_blank', 'noopener,noreferrer')}
            >
              <FaIcon name="arrow-up-right-from-square" size={13} />
              <span>Open</span>
            </Button>
          </div>
        </div>

        <div className={styles.fields}>
          <div className={styles.tabs} role="tablist" aria-label="Media details sections">
            <Button
              variant="ghost"
              size="md"
              role="tab"
              aria-selected={tab === 'details'}
              className={styles.tab}
              onClick={() => setTab('details')}
            >
              Details
            </Button>
            <Button
              variant="ghost"
              size="md"
              role="tab"
              aria-selected={tab === 'folders'}
              className={styles.tab}
              onClick={() => setTab('folders')}
            >
              Folders
            </Button>
          </div>

          {tab === 'details' ? (
            <>
              <Field label="Title" required>
                <Input
                  value={titleField.local}
                  onChange={(e) => titleField.setLocal(e.target.value)}
                  onBlur={() => void titleField.flush()}
                  placeholder="Untitled"
                  aria-label="Title"
                  disabled={!canWrite}
                />
              </Field>

              {/* The reference renders Filename as a static face. Renaming
                  stays available from the canvas context menu, so no
                  capability or feature is lost. */}
              <Field label="Filename">
                <div className={styles.readonlyField} title={asset.filename}>
                  {asset.filename}
                </div>
              </Field>

              {/* The reference's Details tab is exactly: Title, Filename,
                  Alt text (images only), Caption, Tags, then the facts grid.
                  No File URL row, no Open/Replace buttons, no section
                  headings — Copy URL and Open live over the preview, and
                  Replace lives in the footer. */}
              {bucket === 'image' && (
                <Field label="Alt text">
                  <Textarea
                    value={altField.local}
                    onChange={(e) => altField.setLocal(e.target.value)}
                    onBlur={() => void altField.flush()}
                    placeholder="Describe the image for screen readers"
                    aria-label="Alt text"
                    rows={2}
                    disabled={!canWrite}
                  />
                </Field>
              )}

              <Field label="Caption">
                <Textarea
                  value={captionField.local}
                  onChange={(e) => captionField.setLocal(e.target.value)}
                  onBlur={() => void captionField.flush()}
                  placeholder="Optional caption"
                  aria-label="Caption"
                  rows={2}
                  disabled={!canWrite}
                />
              </Field>

              <Field label="Tags">
                <TagEditor
                  value={tagsField.local}
                  onChange={(next) => tagsField.setLocal(next)}
                  palette={editor.tagPalette}
                  disabled={!canWrite}
                />
              </Field>

              <dl className={styles.facts}>
                <Fact label="Type" value={asset.mimeType} />
                <Fact label="Size" value={formatBytes(asset.sizeBytes)} />
                <Fact
                  label="Dimensions"
                  value={
                    asset.width !== null && asset.height !== null
                      ? `${asset.width} × ${asset.height}`
                      : asset.durationMs !== null
                        ? `${(asset.durationMs / 1000).toFixed(1)}s`
                        : '—'
                  }
                />
                <Fact label="Updated" value={formatDate(asset.createdAt)} />
              </dl>

              {inTrash && asset.deletedAt && (
                <p className={styles.warning} role="status">
                  In Trash since {formatDate(asset.deletedAt)}
                </p>
              )}
            </>
          ) : (
            <>
              <p className={styles.folderHelp}>
                Moving an asset replaces its folder membership. Choose All media to
                move it back to the root.
              </p>

              {editor.moveToFolder && editor.folders && (
                <Field label="Folder">
                  <Select
                    aria-label="Move to folder"
                    fieldSize="md"
                    disabled={!canWrite}
                    value={asset.folderIds[0] ?? ''}
                    onChange={(event) => {
                      const next = event.target.value
                      void editor.moveToFolder?.(asset.id, next === '' ? null : next)
                    }}
                    options={[
                      { value: '', label: 'All media (root)', textValue: 'All media (root)' },
                      ...editor.folders.map((folder) => ({
                        value: folder.id,
                        label: folder.name,
                        textValue: folder.name,
                      })),
                    ]}
                  />
                </Field>
              )}

              {folderNames.length === 0 ? (
                <p className={styles.placeholder}>Uncategorized</p>
              ) : (
                <ul className={styles.folderList} aria-label="Asset folders">
                  {folderNames.map((name) => (
                    <li key={name} className={styles.folderChip}>
                      <span className={styles.folderChipIcon} aria-hidden="true">
                        <FaIcon name="folder" size={11} />
                      </span>
                      <span>{name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      <div className={styles.footer}>
        {inTrash ? (
          <>
            {canWrite && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => void editor.restoreAsset(asset.id)}
              >
                <FaIcon name="rotate-left" size={12} />
                <span>Restore</span>
              </Button>
            )}
            {canDelete && (
              <Button
                variant="destructive"
                size="md"
                onClick={() => void editor.purgeAsset(asset.id)}
              >
                <FaIcon name="trash" size={12} />
                <span>Delete permanently</span>
              </Button>
            )}
          </>
        ) : (
          <>
            {canReplace ? (
              <Button
                variant="secondary"
                size="md"
                onClick={() => setReplaceOpen(true)}
              >
                <FaIcon name="rotate" size={12} />
                <span>Replace file</span>
              </Button>
            ) : (
              <span />
            )}
            {canDelete && editor.trashAsset && (
              <Button
                variant="destructive"
                size="md"
                onClick={() => void editor.trashAsset?.(asset.id)}
              >
                <FaIcon name="trash" size={12} />
                <span>Move to Trash</span>
              </Button>
            )}
          </>
        )}
      </div>

      {canReplace && (
        <ReplaceFileDialog
          asset={asset}
          open={replaceOpen}
          onClose={() => setReplaceOpen(false)}
          onReplace={(file) => editor.replaceAssetFile(asset.id, file)}
        />
      )}
    </aside>,
    document.body,
  )
}

interface FieldProps {
  label: string
  required?: boolean
  children: ReactNode
}

function Field({ label, required = false, children }: FieldProps) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        {required && <span className={styles.required} aria-hidden="true"> *</span>}
      </span>
      {children}
    </label>
  )
}

interface FactProps {
  label: string
  value: string
}

function Fact({ label, value }: FactProps) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue} title={value}>{value}</dd>
    </div>
  )
}
