/**
 * MediaCanvas — the central file browser for the Media workspace.
 *
 * Transcribed from the MMSBUILD Media reference (`screens/media/src/App.jsx`
 * → `.media-canvas`): a sticky toolbar carrying the breadcrumb and the
 * Upload / Uploads actions, the library heading, a folder-tile row, the
 * filter bar, then the asset grid.
 *
 * `chrome` is the important prop. The Media PAGE renders this with the full
 * page chrome; the media PICKER — which is mounted from Settings, Content,
 * two Data grid cells and two Site property controls — renders it with
 * `chrome="embedded"`, which drops the breadcrumb, heading, upload triggers
 * and footer count. Without that a picker modal would grow a page header.
 */
import {
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { FileUpload } from '@ui/components/FileUpload'
import { Select } from '@ui/components/Select'
import { Skeleton } from '@ui/components/Skeleton'
import { canDeleteMedia, canWriteMedia } from '@admin/access'
import { useCurrentAdminUser } from '@admin/sessionContext'
import {
  ExplorerItemContextMenu,
  ExplorerRenameDialog,
  type ExplorerContextMenuItem,
} from '@site/explorer-actions'
import { cn } from '@ui/cn'
import type { CmsMediaAsset, CmsMediaFolder } from '@core/persistence/cmsMedia'
import type { MediaSort, MediaType } from '../../utils/filters'
import {
  readStoredMediaViewMode,
  writeStoredMediaViewMode,
  type MediaViewMode,
} from '../../utils/viewMode'
import {
  FOLDER_ALL,
  FOLDER_TRASH,
  type UseMediaWorkspaceResult,
} from '../../hooks/useMediaWorkspace'
import { childFoldersForParent } from '../../utils/folderTree'
import {
  writeMediaAssetDragData,
  writeMediaFolderDragData,
} from '../../utils/mediaDragDrop'
import { useMediaDnd } from '../../hooks/useMediaDnd'
import styles from './MediaCanvas.module.css'
import { AssetRow, AssetTile, FolderTile } from './MediaCanvasItems'

interface MediaCanvasProps {
  workspace: UseMediaWorkspaceResult
  /** Picker mode: plain click toggles assets instead of replacing selection. */
  selectionMode?: 'standard' | 'multiple'
  /**
   * `'page'` renders the full workspace chrome. `'embedded'` — used by every
   * `MediaPickerModal` mount outside this workspace — drops the breadcrumb,
   * library heading, upload triggers and footer count so the picker stays a
   * picker.
   */
  chrome?: 'page' | 'embedded'
  /** Toggles the floating upload queue. Page chrome only. */
  onToggleUploadQueue?: () => void
  uploadQueueOpen?: boolean
}

const TYPE_FILTERS: Array<{ value: MediaType; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'image', label: 'Images' },
  { value: 'svg', label: 'SVG' },
  { value: 'video', label: 'Videos' },
  { value: 'other', label: 'Other files' },
]

const SORT_OPTIONS: Array<{ value: MediaSort; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'largest', label: 'Largest' },
  { value: 'smallest', label: 'Smallest' },
  { value: 'name-asc', label: 'Name' },
  { value: 'name-desc', label: 'Name Z→A' },
]

function keyboardMenuPosition(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + Math.min(rect.width - 8, 24),
    y: rect.top + Math.min(rect.height - 8, 24),
  }
}

interface ContextMenuState {
  x: number
  y: number
  asset: CmsMediaAsset
}

function isMacLike(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
}

function folderMatchesQuery(folder: CmsMediaFolder, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return folder.name.toLowerCase().includes(normalized)
}

export function MediaCanvas({
  workspace,
  selectionMode = 'standard',
  chrome = 'page',
  onToggleUploadQueue,
  uploadQueueOpen = false,
}: MediaCanvasProps) {
  const currentUser = useCurrentAdminUser()
  const [viewMode, setViewModeState] = useState<MediaViewMode>(readStoredMediaViewMode)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renameTarget, setRenameTarget] = useState<CmsMediaAsset | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const canWrite = canWriteMedia(currentUser)
  const canDelete = canDeleteMedia(currentUser)
  const dnd = useMediaDnd(workspace, canWrite)
  const pageChrome = chrome === 'page'

  function setViewMode(mode: MediaViewMode) {
    setViewModeState(mode)
    writeStoredMediaViewMode(mode)
  }

  const trashView = workspace.folderSelection === FOLDER_TRASH
  const activeFolder = typeof workspace.folderSelection === 'string'
    ? workspace.folderById.get(workspace.folderSelection) ?? null
    : null
  const parentFolder = activeFolder?.parentId
    ? workspace.folderById.get(activeFolder.parentId) ?? null
    : null

  // Folder tiles are literal: any narrowing filter hides them so the grid
  // shows only what actually matched.
  const folderEntriesVisible =
    !trashView &&
    workspace.filters.type === 'all' &&
    workspace.filters.tag.trim() === ''
  const childFolders = folderEntriesVisible
    ? childFoldersForParent(workspace.folders, activeFolder?.id ?? null)
      .filter((folder) => folderMatchesQuery(folder, workspace.filters.q))
    : []

  function folderAssetCount(folderId: string): number {
    return workspace.assets.filter((asset) => asset.folderIds.includes(folderId)).length
  }

  function folderItemMeta(folder: CmsMediaFolder): string {
    const count =
      childFoldersForParent(workspace.folders, folder.id).length +
      folderAssetCount(folder.id)
    return `${count} ${count === 1 ? 'item' : 'items'}`
  }

  // Modifier-aware click dispatch, matching every grid-style file manager:
  //   - plain click → set primary selection (collapses to one)
  //   - Cmd/Ctrl-click → toggle in/out of the multi-selection
  //   - Shift-click → range-select between the current primary and this row
  function handleAssetClick(asset: CmsMediaAsset, event: MouseEvent<HTMLButtonElement>) {
    if (selectionMode === 'multiple' && !event.shiftKey) {
      event.preventDefault()
      workspace.toggleAssetInSelection(asset.id)
      return
    }
    const meta = isMacLike() ? event.metaKey : event.ctrlKey
    if (event.shiftKey && workspace.selectedAssetId) {
      event.preventDefault()
      workspace.selectRange(workspace.selectedAssetId, asset.id)
      return
    }
    if (meta) {
      event.preventDefault()
      workspace.toggleAssetInSelection(asset.id)
      return
    }
    workspace.setSelectedAssetId(asset.id)
  }

  function handleAssetToggle(asset: CmsMediaAsset, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    workspace.toggleAssetInSelection(asset.id)
  }

  function handleAssetDragStart(asset: CmsMediaAsset, event: DragEvent<HTMLButtonElement>) {
    if (!canWrite) {
      event.preventDefault()
      return
    }
    const selectedIds = Array.from(workspace.selectedAssetIds)
    const dragIds = workspace.selectedAssetIds.has(asset.id) && selectedIds.length > 0
      ? selectedIds
      : [asset.id]
    writeMediaAssetDragData(event.dataTransfer, dragIds)
  }

  function handleFolderDragStart(folder: CmsMediaFolder, event: DragEvent<HTMLButtonElement>) {
    if (!canWrite) {
      event.preventDefault()
      return
    }
    writeMediaFolderDragData(event.dataTransfer, folder.id)
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!canWrite) return
    if (files.length === 0) return
    await workspace.uploadFiles(files)
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setDragActive(false)
    if (trashView || !canWrite) return
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length === 0) return
    await workspace.uploadFiles(files)
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    if (trashView || !canWrite) return
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDragActive(true)
  }
  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (trashView || !canWrite) return
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
  }
  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (event.currentTarget === event.target) setDragActive(false)
  }

  function openContextMenu(asset: CmsMediaAsset, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ asset, x: event.clientX, y: event.clientY })
  }

  function openKeyboardContextMenu(asset: CmsMediaAsset, event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ asset, ...keyboardMenuPosition(event.currentTarget) })
  }

  async function copyAssetUrl(asset: CmsMediaAsset) {
    setContextMenu(null)
    if (!navigator.clipboard?.writeText) {
      console.warn('[MediaCanvas] clipboard unavailable; cannot copy URL')
      return
    }
    try {
      await navigator.clipboard.writeText(asset.publicPath)
    } catch (err) {
      console.error('[MediaCanvas] copy URL failed:', err)
    }
  }

  function buildExtraMenuItems(asset: CmsMediaAsset): ExplorerContextMenuItem[] {
    const items: ExplorerContextMenuItem[] = [
      {
        label: 'Copy URL',
        action: () => { void copyAssetUrl(asset) },
        icon: <FaIcon name="copy" size={12} />,
      },
    ]
    if (trashView && canWrite) {
      items.unshift({
        label: 'Restore',
        action: () => {
          setContextMenu(null)
          void workspace.restoreAsset(asset.id)
        },
        icon: <FaIcon name="rotate-left" size={12} />,
      })
    }
    return items
  }

  const visibleAssets = workspace.visibleAssets
  const contentMatching = visibleAssets.length + childFolders.length
  const showingTotal = workspace.assets.length + (trashView ? 0 : workspace.folders.length)
  const parentVisible = folderEntriesVisible && activeFolder !== null
  const showingMatching = contentMatching + (parentVisible ? 1 : 0)

  const folderLabel = trashView
    ? 'Trash'
    : activeFolder?.name ?? 'All media'
  const headingDescription = trashView
    ? 'Restore media or permanently delete it with the required permission.'
    : 'Organise, find and edit the files used by this website.'

  const isGrid = viewMode === 'grid'
  const Asset = isGrid ? AssetTile : AssetRow

  const uploadButton = !trashView && canWrite && (
    <FileUpload
      multiple
      onChange={(e) => void handleUpload(e)}
      buttonProps={{
        variant: 'primary',
        size: 'lg',
        'aria-label': 'Upload media',
      }}
    >
      <FaIcon name="arrow-up-from-bracket" size={13} />
      <span>Upload files</span>
    </FileUpload>
  )

  return (
    <section
      className={cn(styles.canvas, dragActive && styles.canvasDropping)}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
      aria-label="Media library"
      // Clicks here change the selection; they must not dismiss the
      // selection-derived viewer / bulk windows.
      data-media-surface=""
      data-testid="media-canvas"
    >
      {pageChrome && (
        <header className={styles.toolbar}>
          <nav className={styles.breadcrumbs} aria-label="Folder path">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => workspace.setFolderSelection(FOLDER_ALL)}
            >
              All files
            </Button>
            {parentFolder && (
              <>
                <span className={styles.breadcrumbSeparator} aria-hidden="true">
                  <FaIcon name="chevron-right" size={9} />
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => workspace.setFolderSelection(parentFolder.id)}
                >
                  {parentFolder.name}
                </Button>
              </>
            )}
            {(activeFolder || trashView) && (
              <>
                <span className={styles.breadcrumbSeparator} aria-hidden="true">
                  <FaIcon name="chevron-right" size={9} />
                </span>
                <strong className={styles.breadcrumbCurrent} title={folderLabel}>
                  {folderLabel}
                </strong>
              </>
            )}
          </nav>

          <div className={styles.toolbarActions}>
            {uploadButton}
            {onToggleUploadQueue && (
              <Button
                variant="secondary"
                size="lg"
                onClick={onToggleUploadQueue}
                aria-label="Toggle upload queue"
                aria-expanded={uploadQueueOpen}
                pressed={uploadQueueOpen}
                className={cn(
                  styles.queueTrigger,
                  workspace.uploadQueue.items.length > 0 && styles.queueTriggerActive,
                )}
              >
                <FaIcon name="cloud-arrow-up" size={13} />
                <span>Uploads</span>
                {workspace.uploadQueue.items.length > 0 && (
                  <span className={styles.queueCount}>
                    {
                      workspace.uploadQueue.items.filter(
                        (item) => item.status === 'uploading' || item.status === 'queued',
                      ).length
                    }
                  </span>
                )}
              </Button>
            )}
          </div>
        </header>
      )}

      {pageChrome && (
        <section className={styles.libraryHeading} aria-labelledby="media-library-title">
          <div className={styles.libraryHeadingText}>
            <p className={styles.eyebrow}>Asset library</p>
            <h2 id="media-library-title" className={styles.libraryTitle}>
              {folderLabel}
            </h2>
            <p className={styles.libraryDescription}>{headingDescription}</p>
          </div>
          <div className={styles.selectionSummary} aria-live="polite">
            {workspace.selectedAssetIds.size > 0
              ? `${workspace.selectedAssetIds.size} selected`
              : `${visibleAssets.length} ${visibleAssets.length === 1 ? 'item' : 'items'}`}
          </div>
        </section>
      )}

      {(childFolders.length > 0 || parentVisible) && (
        <ul className={styles.folderTiles} aria-label="Folders">
          {parentVisible && activeFolder && (
            <FolderTile
              folder={null}
              label={activeFolder.parentId ? (parentFolder?.name ?? 'Parent folder') : 'All files'}
              meta="Parent folder"
              dropActive={dnd.isDropTarget(activeFolder.parentId)}
              canDrag={false}
              dropTargetId={activeFolder.parentId}
              onOpen={() =>
                workspace.setFolderSelection(activeFolder.parentId ?? FOLDER_ALL)
              }
              onDragOver={dnd.handleDragOver}
              onDragLeave={dnd.handleDragLeave}
              onDrop={(event) => void dnd.handleDrop(event, activeFolder.parentId)}
            />
          )}
          {childFolders.map((folder) => (
            <FolderTile
              key={folder.id}
              folder={folder}
              label={folder.name}
              meta={folderItemMeta(folder)}
              dropActive={dnd.isDropTarget(folder.id)}
              canDrag={canWrite}
              dropTargetId={folder.id}
              onOpen={() => workspace.setFolderSelection(folder.id)}
              onDragStart={handleFolderDragStart}
              onDragOver={dnd.handleDragOver}
              onDragLeave={dnd.handleDragLeave}
              onDrop={(event) => void dnd.handleDrop(event, folder.id)}
            />
          ))}
        </ul>
      )}

      {/* `.filter-bar` — the reference's four-column grid: search, media
          type, sort, view toggle. It uses selects for type and sort, not
          chips. */}
      <div className={styles.filterBar}>
        <label className={styles.searchField}>
          <span className={styles.searchIcon} aria-hidden="true">
            <FaIcon name="magnifying-glass" size={13} />
          </span>
          <input
            className={styles.searchInput}
            value={workspace.filters.q}
            onChange={(event) => workspace.setQuery(event.target.value)}
            placeholder="Search media"
            aria-label="Search media"
          />
        </label>

        <Select
          aria-label="Media type"
          fieldSize="md"
          className={styles.filterSelect}
          value={workspace.filters.type}
          onChange={(event) => workspace.setFilterType(event.target.value as MediaType)}
          options={TYPE_FILTERS.map((option) => ({
            value: option.value,
            label: option.label,
            textValue: option.label,
          }))}
        />

        <Select
          aria-label="Sort media"
          fieldSize="md"
          className={styles.filterSelect}
          value={workspace.filters.sort}
          onChange={(event) => workspace.setSort(event.target.value as MediaSort)}
          options={SORT_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            textValue: option.label,
          }))}
        />

        <div role="group" aria-label="Media view" className={styles.viewGroup}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            pressed={isGrid}
            tooltip="Grid view"
            aria-label="Grid view"
            className={styles.viewButton}
            onClick={() => setViewMode('grid')}
          >
            <FaIcon name="table-cells-large" size={13} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            pressed={!isGrid}
            tooltip="List view"
            aria-label="List view"
            className={styles.viewButton}
            onClick={() => setViewMode('list')}
          >
            <FaIcon name="list" size={13} />
          </Button>
        </div>
      </div>

      {workspace.error && (
        <div className={styles.statusBar} role="status" aria-live="polite">
          {workspace.error}
        </div>
      )}

      <div className={styles.body}>
        {workspace.loading && showingMatching === 0 ? (
          // Skeleton mirrors the real tile / row layout so the swap is silent.
          <ul
            className={isGrid ? styles.grid : styles.list}
            role="list"
            aria-busy="true"
            aria-label="Loading media"
          >
            {Array.from({ length: isGrid ? 10 : 6 }, (_, i) => (
              <li
                key={`skeleton-${i}`}
                className={isGrid ? styles.tileItem : styles.rowItem}
                aria-hidden="true"
              >
                <span className={isGrid ? styles.tile : styles.row}>
                  <span className={isGrid ? styles.tilePreview : styles.rowPreview}>
                    <Skeleton width="100%" height="100%" />
                  </span>
                  <span className={isGrid ? styles.tileBody : styles.rowBody}>
                    <span className={isGrid ? styles.tileTitle : styles.rowLabel}>
                      <Skeleton width={`${60 + (i % 4) * 10}%`} height={12} />
                    </span>
                    <span className={isGrid ? styles.tileMeta : styles.rowMeta}>
                      <Skeleton width={64} height={10} />
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : showingMatching === 0 ? (
          <div className={styles.emptyState} role="status">
            <span className={styles.emptyIcon} aria-hidden="true">
              <FaIcon name={trashView ? 'trash' : 'images'} size={24} />
            </span>
            <h3 className={styles.emptyTitle}>
              {trashView
                ? 'Trash is empty'
                : showingTotal > 0
                  ? 'No media matches these filters'
                  : 'Upload your first file'}
            </h3>
            <p className={styles.emptyBody}>
              {trashView
                ? 'Deleted media will stay here until it is restored or permanently removed.'
                : showingTotal > 0
                  ? 'Try a different search or filter.'
                  : 'Images, videos, fonts and safe vectors will appear here.'}
            </p>
            {!trashView && showingTotal === 0 && uploadButton}
          </div>
        ) : (
          <>
            <ul
              className={isGrid ? styles.grid : styles.list}
              role="list"
              data-testid={isGrid ? 'media-grid' : 'media-list'}
            >
              {visibleAssets.map((asset) => (
                <Asset
                  key={asset.id}
                  asset={asset}
                  selected={workspace.selectedAssetIds.has(asset.id)}
                  canDrag={canWrite}
                  showCheckmark
                  onSelect={(event) => handleAssetClick(asset, event)}
                  onToggleSelect={(event) => handleAssetToggle(asset, event)}
                  onDragStart={handleAssetDragStart}
                  onDragEnd={dnd.clearDropTarget}
                  onContextMenu={openContextMenu}
                  onKeyboardMenu={openKeyboardContextMenu}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {contextMenu && (
        <ExplorerItemContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          ariaLabel="Media item options"
          onClose={() => setContextMenu(null)}
          onRename={() => {
            setRenameTarget(contextMenu.asset)
            setContextMenu(null)
          }}
          onDelete={() => {
            const target = contextMenu.asset
            setContextMenu(null)
            if (trashView) void workspace.purgeAsset(target.id)
            else void workspace.trashAsset(target.id)
          }}
          showRename={canWrite}
          showDelete={canDelete}
          extraItems={buildExtraMenuItems(contextMenu.asset)}
        />
      )}

      {renameTarget && (
        <ExplorerRenameDialog
          title="Rename media"
          fieldLabel="Name"
          initialValue={renameTarget.filename}
          onCancel={() => setRenameTarget(null)}
          onRename={async (payload) => {
            await workspace.renameAsset(renameTarget.id, payload.value)
            setRenameTarget(null)
          }}
        />
      )}
    </section>
  )
}
