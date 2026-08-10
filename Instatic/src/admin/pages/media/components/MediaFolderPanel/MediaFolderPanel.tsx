/**
 * MediaFolderPanel — the folder menu inside the Media sidebar.
 *
 * Transcribed from the MMSBUILD Media reference (`screens/media/src/App.jsx`
 * → the two `.folder-section` blocks). Structure is the reference's:
 *
 *   LIBRARY       All media · every real folder · Trash — each with a count
 *   SMART FOLDERS Missing alt · Missing title · Untagged · Large files ·
 *                 Recently replaced — each with a trailing chevron, no count
 *
 * The reference draws plain `.folder-row` buttons, not editor tree rows, so
 * this component owns its rows rather than borrowing the shared `Tree*`
 * primitives. Real folders can nest (the reference's samples don't), so a
 * nested row carries an indent through a custom property.
 *
 * Operations preserved from the existing workspace: select, inline create,
 * rename / delete via the explorer context menu, and folder drag-and-drop.
 */
import { useState, type CSSProperties, type DragEvent, type FormEvent, type MouseEvent } from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { Input } from '@ui/components/Input'
import { cn } from '@ui/cn'
import { canDeleteMedia, canWriteMedia } from '@admin/access'
import { useCurrentAdminUser } from '@admin/sessionContext'
import {
  ExplorerItemContextMenu,
  ExplorerRenameDialog,
} from '@site/explorer-actions'
import { flattenFolderTree } from '../../utils/folderTree'
import { writeMediaFolderDragData } from '../../utils/mediaDragDrop'
import {
  FOLDER_ALL,
  FOLDER_TRASH,
  type FolderSelection,
  type UseMediaWorkspaceResult,
} from '../../hooks/useMediaWorkspace'
import { useMediaDnd } from '../../hooks/useMediaDnd'
import {
  SMART_LARGE_FILES,
  SMART_MISSING_ALT,
  SMART_MISSING_TITLE,
  SMART_RECENTLY_REPLACED,
  SMART_UNTAGGED,
  type SmartFolderId,
} from '../../utils/smartFolders'
import styles from './MediaFolderPanel.module.css'

/** Labels and glyphs are the reference's `SMART` array, verbatim. */
const SMART_FOLDERS: Array<{ id: SmartFolderId; label: string; glyph: string }> = [
  { id: SMART_MISSING_ALT, label: 'Missing alt', glyph: 'circle-exclamation' },
  { id: SMART_MISSING_TITLE, label: 'Missing title', glyph: 'heading' },
  { id: SMART_UNTAGGED, label: 'Untagged', glyph: 'tag' },
  { id: SMART_LARGE_FILES, label: 'Large files', glyph: 'weight-hanging' },
  { id: SMART_RECENTLY_REPLACED, label: 'Recently replaced', glyph: 'clock-rotate-left' },
]

interface MediaFolderPanelProps {
  workspace: UseMediaWorkspaceResult
}

interface ContextMenuState {
  x: number
  y: number
  folderId: string
}

export function MediaFolderPanel({ workspace }: MediaFolderPanelProps) {
  const currentUser = useCurrentAdminUser()
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renameState, setRenameState] = useState<{ folderId: string; initialValue: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [createName, setCreateName] = useState('')
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null)
  const canWrite = canWriteMedia(currentUser)
  const canDelete = canDeleteMedia(currentUser)
  const canManageFolders = canWrite || canDelete
  const dnd = useMediaDnd(workspace, canWrite)

  const isSelected = (target: FolderSelection) => workspace.folderSelection === target

  function folderAssetCount(folderId: string): number {
    return workspace.assets.filter((asset) => asset.folderIds.includes(folderId)).length
  }

  async function commitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canWrite) return
    const name = createName.trim()
    if (!name) return
    const folder = await workspace.createFolder(name, null)
    if (folder) workspace.setFolderSelection(folder.id)
    setCreating(false)
    setCreateName('')
  }

  function openContextMenu(folderId: string, event: MouseEvent<HTMLButtonElement>) {
    if (!canManageFolders) return
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ x: event.clientX, y: event.clientY, folderId })
  }

  function handleFolderDragStart(folderId: string, event: DragEvent<HTMLButtonElement>) {
    if (!canWrite) {
      event.preventDefault()
      return
    }
    writeMediaFolderDragData(event.dataTransfer, folderId)
    setDraggingFolderId(folderId)
  }

  // Real folders nest; the reference's samples are flat. Flatten with every
  // node expanded so the menu reads as one list, and indent by depth.
  const allIds = new Set(workspace.folders.map((folder) => folder.id))
  const rows = flattenFolderTree(workspace.folderTree, allIds)
  const renameFolder = renameState
    ? workspace.folderById.get(renameState.folderId) ?? null
    : null

  return (
    <div className={styles.root} data-testid="media-folder-panel">
      {!canWrite && (
        <p className={styles.permissionNote} role="status">
          <FaIcon name="lock" size={12} />
          <span>Your role can view media but cannot upload or edit it.</span>
        </p>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>Library</span>
          {canWrite && (
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              tooltip="New folder"
              aria-label="New folder"
              onClick={() => { setCreating(true); setCreateName('') }}
            >
              <FaIcon name="plus" size={12} />
            </Button>
          )}
        </div>

        <FolderRow
          glyph="photo-film"
          label="All media"
          count={workspace.assets.length}
          selected={isSelected(FOLDER_ALL)}
          dropActive={dnd.isDropTarget(null)}
          onSelect={() => workspace.setFolderSelection(FOLDER_ALL)}
          onDragOver={(event) => dnd.handleDragOver(event, null)}
          onDragLeave={dnd.handleDragLeave}
          onDrop={(event) => void dnd.handleDrop(event, null)}
        />

        {creating && (
          <form className={styles.createRow} onSubmit={(event) => void commitCreate(event)}>
            <FaIcon name="folder" size={12} />
            <Input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Folder name"
              autoFocus
              aria-label="New folder name"
              // Clicking away from an untouched row dismisses it. Without
              // this an accidental "+" leaves an empty row stranded until
              // the user finds Escape. A row with text typed in it stays,
              // so a mis-click elsewhere can't discard real input.
              onBlur={() => {
                if (!createName.trim()) { setCreating(false); setCreateName('') }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') { setCreating(false); setCreateName('') }
              }}
            />
          </form>
        )}

        {rows.map((node) => (
          <FolderRow
            key={node.folder.id}
            glyph="folder"
            label={node.folder.name}
            count={folderAssetCount(node.folder.id)}
            depth={node.depth}
            selected={isSelected(node.folder.id)}
            dragging={draggingFolderId === node.folder.id}
            dropActive={dnd.isDropTarget(node.folder.id)}
            canDrag={canWrite}
            onSelect={() => workspace.setFolderSelection(node.folder.id)}
            onContextMenu={(event) => openContextMenu(node.folder.id, event)}
            onDragStart={(event) => handleFolderDragStart(node.folder.id, event)}
            onDragEnd={() => { setDraggingFolderId(null); dnd.clearDropTarget() }}
            onDragOver={(event) => dnd.handleDragOver(event, node.folder.id)}
            onDragLeave={dnd.handleDragLeave}
            onDrop={(event) => void dnd.handleDrop(event, node.folder.id)}
          />
        ))}

        {rows.length === 0 && !creating && (
          <p className={styles.emptyNote}>
            {canWrite ? 'Click + to create your first folder.' : 'No folders yet.'}
          </p>
        )}

        <FolderRow
          glyph="trash"
          label="Trash"
          count={workspace.trashedCount}
          selected={isSelected(FOLDER_TRASH)}
          onSelect={() => workspace.setFolderSelection(FOLDER_TRASH)}
        />
      </div>

      <div className={cn(styles.section, styles.sectionLast)}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>Smart folders</span>
        </div>
        {SMART_FOLDERS.map((descriptor) => (
          <FolderRow
            key={descriptor.id}
            glyph={descriptor.glyph}
            label={descriptor.label}
            chevron
            selected={isSelected(descriptor.id)}
            onSelect={() => workspace.setFolderSelection(descriptor.id)}
          />
        ))}
      </div>

      {contextMenu && (
        <ExplorerItemContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          ariaLabel="Folder options"
          onClose={() => setContextMenu(null)}
          onRename={() => {
            if (!canWrite) return
            const folder = workspace.folderById.get(contextMenu.folderId)
            if (folder) setRenameState({ folderId: folder.id, initialValue: folder.name })
            setContextMenu(null)
          }}
          onDelete={() => {
            if (!canDelete) return
            const folderId = contextMenu.folderId
            setContextMenu(null)
            void workspace.deleteFolder(folderId)
          }}
          showRename={canWrite}
          showDelete={canDelete}
        />
      )}

      {renameFolder && renameState && (
        <ExplorerRenameDialog
          title="Rename folder"
          fieldLabel="Name"
          initialValue={renameState.initialValue}
          onCancel={() => setRenameState(null)}
          onRename={async (payload) => {
            if (!canWrite) return
            await workspace.renameFolder(renameFolder.id, payload.value)
            setRenameState(null)
          }}
        />
      )}
    </div>
  )
}

interface FolderRowProps {
  /** Font Awesome Solid glyph, without the `fa-` prefix. */
  glyph: string
  label: string
  /** Right-aligned count. Omitted on smart-folder rows, per the reference. */
  count?: number
  /** Trailing chevron — the reference draws this on smart folders only. */
  chevron?: boolean
  depth?: number
  selected: boolean
  dragging?: boolean
  dropActive?: boolean
  canDrag?: boolean
  onSelect: () => void
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: () => void
  onDragOver?: (event: DragEvent<HTMLButtonElement>) => void
  onDragLeave?: (event: DragEvent<HTMLButtonElement>) => void
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void
}

function FolderRow({
  glyph,
  label,
  count,
  chevron = false,
  depth = 0,
  selected,
  dragging = false,
  dropActive = false,
  canDrag = false,
  onSelect,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: FolderRowProps) {
  const style = depth > 0
    ? ({ '--media-row-indent': `${depth * 12}px` } as CSSProperties)
    : undefined
  return (
    <Button
      variant="ghost"
      size="md"
      pressed={selected}
      draggable={canDrag}
      aria-label={
        count !== undefined
          ? `${label} — ${count} ${count === 1 ? 'asset' : 'assets'}`
          : label
      }
      className={cn(
        styles.folderRow,
        selected && styles.folderRowActive,
        depth > 0 && styles.folderRowNested,
        dropActive && styles.dropActive,
      )}
      style={style}
      data-dragging={dragging ? 'true' : undefined}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className={styles.rowLabel}>
        <span className={styles.rowIcon} aria-hidden="true">
          <FaIcon name={glyph} size={13} />
        </span>
        <span className={styles.rowLabelText}>{label}</span>
      </span>
      {count !== undefined && <b className={styles.rowCount}>{count}</b>}
      {chevron && (
        <span className={styles.rowChevron} aria-hidden="true">
          <FaIcon name="chevron-right" size={10} />
        </span>
      )}
    </Button>
  )
}
