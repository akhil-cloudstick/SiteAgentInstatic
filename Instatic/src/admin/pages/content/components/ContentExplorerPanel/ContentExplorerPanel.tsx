import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Button } from '@ui/components/Button'
import { Skeleton } from '@ui/components/Skeleton'
import { cn } from '@ui/cn'
import { BookOpenSolidIcon } from 'pixel-art-icons/icons/book-open-solid'
import { BookPlusSolidIcon } from 'pixel-art-icons/icons/book-plus-solid'
import { CopySolidIcon } from 'pixel-art-icons/icons/copy-solid'
import { Copy2SolidIcon } from 'pixel-art-icons/icons/copy-2-solid'
import { ExternalLinkSolidIcon } from 'pixel-art-icons/icons/external-link-solid'
import { FilePlusSolidIcon } from 'pixel-art-icons/icons/file-plus-solid'
import { FileTextSolidIcon } from 'pixel-art-icons/icons/file-text-solid'
import { MoreVerticalSolidIcon } from 'pixel-art-icons/icons/more-vertical-solid'
import { MoveIcon } from 'pixel-art-icons/icons/move'
import { Settings2SolidIcon } from 'pixel-art-icons/icons/settings-2-solid'
import { UploadIcon } from 'pixel-art-icons/icons/upload'
import { readTitleCell } from '@core/data/cells'
import type {
  DataTable,
  DataTableListItem,
  DataRow,
  UpdateDataTableInput,
} from '@core/data/schemas'
import { ExplorerItemContextMenu, type ExplorerContextMenuItem } from '@site/explorer-actions'
import { Panel } from '@admin/shared/Panel'
import { ContentCollectionSettingsDialog } from '@content/components/ContentCollectionSettingsDialog/ContentCollectionSettingsDialog'
import {
  ContentItemRenameDialog,
  type ContentItemRenamePayload,
} from '@content/components/ContentItemRenameDialog/ContentItemRenameDialog'
import styles from './ContentExplorerPanel.module.css'
import { publicContentPath } from '@content/utils/contentEntryUtils'

type ContentExplorerContextTarget =
  | { kind: 'collection'; collection: DataTable }
  | { kind: 'entry'; entry: DataRow }

interface ContextMenuState {
  x: number
  y: number
  target: ContentExplorerContextTarget
}

interface ContentExplorerPanelProps {
  loading: boolean
  error: string | null
  /** Post-type tables, each carrying the server-computed `rowCount`. */
  collections: DataTableListItem[]
  entries: DataRow[]
  selectedCollection: DataTable | null
  selectedCollectionId: string | null
  selectedEntryId: string | null
  canCreateCollection: boolean
  canCreateEntry: boolean
  canManageCollections: boolean
  canEditEntry: (entry: DataRow) => boolean
  canMoveEntry: (entry: DataRow) => boolean
  canPublishEntry: (entry: DataRow) => boolean
  onSelectCollection: (tableId: string) => void
  onSelectEntry: (entry: DataRow) => void
  /**
   * The collection + entry mutation surface, grouped into one object instead
   * of a dozen props-drilled `onXxx` callbacks (mirrors how `useMediaWorkspace`
   * exposes its flat mutation surface). Selection and close stay as their own
   * props because they're navigation, not mutations.
   */
  entryActions: ContentEntryActions
  onClose: () => void
}

interface ContentEntryActions {
  createCollection: () => void
  updateCollection: (collection: DataTable, input: UpdateDataTableInput) => void | Promise<void>
  deleteCollection: (collection: DataTable) => void | Promise<void>
  createEntry: () => void
  renameEntry: (entry: DataRow, input: ContentItemRenamePayload) => void | Promise<void>
  publishEntry: (entry: DataRow) => void | Promise<void>
  convertEntryToDraft: (entry: DataRow) => void | Promise<void>
  deleteEntry: (entry: DataRow) => void | Promise<void>
  duplicateEntry: (entry: DataRow) => void | Promise<void>
  moveEntryToCollection: (entry: DataRow, tableId: string) => void | Promise<void>
}

/** Anchors a menu opened from a control (⋮ button or keyboard) to that control. */
function anchoredMenuPosition(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + Math.min(rect.width - 8, 24),
    y: rect.top + Math.min(rect.height - 8, 24),
  }
}

/**
 * Author shown under an entry title. The row already carries its author /
 * creator reference, so this needs no extra request.
 */
function entryAuthorLabel(entry: DataRow): string {
  const user = entry.author ?? entry.createdBy ?? entry.updatedBy ?? null
  return user?.displayName || user?.email || 'Unknown author'
}

export function ContentExplorerPanel({
  loading,
  error,
  collections,
  entries,
  selectedCollection,
  selectedCollectionId,
  selectedEntryId,
  canCreateCollection,
  canCreateEntry,
  canManageCollections,
  canEditEntry,
  canMoveEntry,
  canPublishEntry,
  onSelectCollection,
  onSelectEntry,
  entryActions,
  onClose,
}: ContentExplorerPanelProps) {
  const {
    createCollection,
    updateCollection,
    deleteCollection,
    createEntry,
    renameEntry,
    publishEntry,
    convertEntryToDraft,
    deleteEntry,
    duplicateEntry,
    moveEntryToCollection,
  } = entryActions
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renameTarget, setRenameTarget] = useState<ContentExplorerContextTarget | null>(null)
  const [settingsTarget, setSettingsTarget] = useState<DataTable | null>(null)
  const entryListLabel = selectedCollection?.pluralLabel || 'Entries'
  const singularLabel = selectedCollection?.singularLabel || 'entry'
  const newEntryLabel = `New ${singularLabel.toLowerCase()}`

  /**
   * Row count shown on a collection row. The active collection's entries are
   * already in memory and stay correct across create / delete, so they win;
   * every other collection falls back to the server-computed `rowCount` that
   * `listCmsDataTables` returns alongside the table.
   */
  function collectionCount(collection: DataTableListItem): number {
    return collection.id === selectedCollectionId ? entries.length : collection.rowCount
  }

  function collectionForEntry(entry: DataRow): DataTable | null {
    return collections.find((collection) => collection.id === entry.tableId) ?? selectedCollection
  }

  function openContextMenu(target: ContentExplorerContextTarget, event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ x: event.clientX, y: event.clientY, target })
  }

  function openKeyboardContextMenu(target: ContentExplorerContextTarget, event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ ...anchoredMenuPosition(event.currentTarget), target })
  }

  /**
   * The reference's ⋮ trigger, revealed on hover / focus / selection. Opens the
   * same menu the right-click and Shift+F10 paths open, anchored to the button.
   */
  function openTriggerMenu(target: ContentExplorerContextTarget, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ ...anchoredMenuPosition(event.currentTarget), target })
  }

  async function copyEntryUrl(entry: DataRow) {
    const collection = collectionForEntry(entry)
    if (!collection) return
    const url = `${window.location.origin}${publicContentPath(collection.routeBase, entry.slug)}`
    try {
      await navigator.clipboard.writeText(url)
    } catch (err) {
      console.error('[ContentExplorerPanel] copy entry URL error:', err)
    }
  }

  function moveSubmenuItem(target: ContentExplorerContextTarget): ExplorerContextMenuItem | null {
    if (target.kind !== 'entry') return null
    if (!canMoveEntry(target.entry)) return null
    const others = collections.filter((collection) => collection.id !== target.entry.tableId)
    if (others.length === 0) return null
    return {
      kind: 'submenu',
      label: 'Move to collection',
      icon: <MoveIcon size={13} />,
      width: 220,
      items: others.map((collection) => ({
        kind: 'action' as const,
        label: collection.name,
        icon: <BookOpenSolidIcon size={13} />,
        action: () => {
          void moveEntryToCollection(target.entry, collection.id)
          setContextMenu(null)
        },
      })),
    }
  }

  function extraMenuItems(target: ContentExplorerContextTarget): ExplorerContextMenuItem[] {
    if (target.kind === 'collection') {
      if (!canManageCollections) return []
      return [{
        label: 'Collection settings',
        icon: <Settings2SolidIcon size={13} />,
        action: () => {
          setSettingsTarget(target.collection)
          setContextMenu(null)
        },
      }]
    }

    const items: ExplorerContextMenuItem[] = []

    if (target.entry.status !== 'published' && canPublishEntry(target.entry)) {
      items.push({
        label: 'Publish',
        icon: <UploadIcon size={13} />,
        action: () => {
          void publishEntry(target.entry)
          setContextMenu(null)
        },
      })
    } else {
      items.push({
        label: 'Open in new tab',
        icon: <ExternalLinkSolidIcon size={13} />,
        action: () => {
          const collection = collectionForEntry(target.entry)
          if (collection) {
            window.open(publicContentPath(collection.routeBase, target.entry.slug), '_blank', 'noopener,noreferrer')
          }
          setContextMenu(null)
        },
      })
      items.push({
        label: 'Copy URL',
        icon: <Copy2SolidIcon size={13} />,
        action: () => {
          void copyEntryUrl(target.entry)
          setContextMenu(null)
        },
      })
      if (canEditEntry(target.entry)) {
        items.push({
          label: 'Convert to draft',
          icon: <FileTextSolidIcon size={13} />,
          action: () => {
            void convertEntryToDraft(target.entry)
            setContextMenu(null)
          },
        })
      }
    }

    if (canCreateEntry) {
      items.push({
        label: 'Duplicate',
        icon: <CopySolidIcon size={13} />,
        action: () => {
          void duplicateEntry(target.entry)
          setContextMenu(null)
        },
      })
    }

    const moveItem = moveSubmenuItem(target)
    if (moveItem) items.push(moveItem)

    return items
  }

  function renameDialogTitle(target: ContentExplorerContextTarget): string {
    if (target.kind === 'collection') return 'Rename collection'
    const collection = collectionForEntry(target.entry)
    return `Rename ${(collection?.singularLabel ?? 'entry').toLowerCase()}`
  }

  async function handleRename(payload: ContentItemRenamePayload) {
    if (!renameTarget) return

    if (renameTarget.kind === 'collection') {
      await updateCollection(renameTarget.collection, {
        name: payload.title,
        slug: payload.slug,
      })
    } else {
      await renameEntry(renameTarget.entry, payload)
    }
    setRenameTarget(null)
  }

  async function handleDelete(target: ContentExplorerContextTarget) {
    setContextMenu(null)
    if (target.kind === 'collection') {
      await deleteCollection(target.collection)
    } else {
      await deleteEntry(target.entry)
    }
  }

  return (
    <>
      <Panel
        panelId="content-explorer"
        title="Content"
        ariaLabel="Content Explorer"
        testId="content-explorer-panel"
        onClose={onClose}
        body="bare"
        bodyClassName={styles.panelScroll}
      >
        {error && <p className={styles.error} role="alert">{error}</p>}

        <section className={styles.section} aria-label="Collections">
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Collections</h2>
            {/* Hide the count while loading — `0` would look like an
                empty install. Same for the entries section below. */}
            {!loading && (
              <span className={styles.sectionCount}>{collections.length}</span>
            )}
            {/* The action keeps its fixed 44px track even when a capability
                gate hides the button, so the count never shifts sideways. */}
            <span className={styles.sectionAction}>
              {canCreateCollection && (
                <Button
                  variant="ghost"
                  size="xs"
                  iconOnly
                  onClick={createCollection}
                  aria-label="New collection"
                  tooltip="New collection"
                >
                  <BookPlusSolidIcon size={13} aria-hidden="true" />
                </Button>
              )}
            </span>
          </div>
          <div className={styles.rows}>
            {loading
              ? Array.from({ length: 2 }, (_, i) => (
                  // Skeleton collection row mirrors the real row 1:1:
                  // 14px icon + label text + trailing count slot.
                  <div
                    key={`skeleton-coll-${i}`}
                    className={styles.skeletonRow}
                    aria-hidden="true"
                  >
                    <Skeleton width={14} height={14} radius={3} />
                    <span className={styles.rowLabel}>
                      <Skeleton width={`${56 + (i % 2) * 16}%`} height={12} />
                    </span>
                    <span className={styles.rowMeta}>
                      <Skeleton width={16} height={10} />
                    </span>
                  </div>
                ))
              : collections.map((collection) => (
                  <button
                    key={collection.id}
                    type="button"
                    className={cn(
                      styles.row,
                      collection.id === selectedCollectionId && styles.rowActive,
                    )}
                    onClick={() => onSelectCollection(collection.id)}
                    onContextMenu={(event) => openContextMenu({ kind: 'collection', collection }, event)}
                    onKeyDown={(event) => openKeyboardContextMenu({ kind: 'collection', collection }, event)}
                  >
                    <BookOpenSolidIcon size={14} aria-hidden="true" />
                    <span className={styles.rowLabel}>{collection.name}</span>
                    <span className={styles.rowMeta}>{collectionCount(collection)}</span>
                  </button>
                ))}
          </div>
        </section>

        <section className={styles.section} aria-label={entryListLabel}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>{entryListLabel}</h2>
            {!loading && (
              <span className={styles.sectionCount}>{entries.length}</span>
            )}
            <span className={styles.sectionAction}>
              <Button
                variant="ghost"
                size="xs"
                iconOnly
                onClick={createEntry}
                disabled={!selectedCollectionId || !canCreateEntry}
                aria-label={newEntryLabel}
                tooltip={newEntryLabel}
              >
                <FilePlusSolidIcon size={13} aria-hidden="true" />
              </Button>
            </span>
          </div>

          {loading ? (
            <ContentEntriesLoading />
          ) : entries.length === 0 ? (
            <p className={styles.compactEmpty}>No entries yet.</p>
          ) : (
            <div className={styles.rows}>
              {entries.map((entry) => {
                const isActive = entry.id === selectedEntryId
                const title = readTitleCell(entry.cells)
                return (
                  <div
                    key={entry.id}
                    className={cn(
                      styles.entryRowWrap,
                      isActive && styles.entryRowWrapActive,
                    )}
                  >
                    <button
                      type="button"
                      className={cn(
                        styles.row,
                        styles.entryRow,
                        isActive && styles.rowActive,
                      )}
                      aria-current={isActive ? 'true' : undefined}
                      onClick={() => onSelectEntry(entry)}
                      onContextMenu={(event) => openContextMenu({ kind: 'entry', entry }, event)}
                      onKeyDown={(event) => openKeyboardContextMenu({ kind: 'entry', entry }, event)}
                    >
                      <span className={styles.entryPreview}>
                        <FileTextSolidIcon size={14} aria-hidden="true" />
                      </span>
                      <span className={styles.entryTitleStack}>
                        <strong>{title}</strong>
                        <small>{entryAuthorLabel(entry)}</small>
                      </span>
                      <span className={styles.rowMeta}>{entry.status}</span>
                    </button>
                    <Button
                      variant="ghost"
                      size="xs"
                      iconOnly
                      className={styles.entryMenuTrigger}
                      aria-label={`Options for ${title || 'Untitled'}`}
                      tooltip="Options"
                      aria-haspopup="menu"
                      onClick={(event) => openTriggerMenu({ kind: 'entry', entry }, event)}
                    >
                      <MoreVerticalSolidIcon size={13} aria-hidden="true" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </Panel>

      {contextMenu && (
        <ExplorerItemContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          ariaLabel="Content item options"
          renameDisabled={contextMenu.target.kind === 'collection'
            ? !canManageCollections
            : !canEditEntry(contextMenu.target.entry)}
          deleteDisabled={contextMenu.target.kind === 'collection'
            ? contextMenu.target.collection.id === 'posts' || !canManageCollections
            : !canEditEntry(contextMenu.target.entry)}
          extraItems={extraMenuItems(contextMenu.target)}
          onClose={() => setContextMenu(null)}
          onRename={() => {
            setRenameTarget(contextMenu.target)
            setContextMenu(null)
          }}
          onDelete={() => { void handleDelete(contextMenu.target) }}
        />
      )}

      {renameTarget && (
        <ContentItemRenameDialog
          title={renameDialogTitle(renameTarget)}
          titleLabel={renameTarget.kind === 'collection' ? 'Name' : 'Title'}
          initialTitle={renameTarget.kind === 'collection' ? renameTarget.collection.name : readTitleCell(renameTarget.entry.cells)}
          initialSlug={renameTarget.kind === 'collection' ? renameTarget.collection.slug : renameTarget.entry.slug}
          onCancel={() => setRenameTarget(null)}
          onRename={handleRename}
        />
      )}

      {settingsTarget && (
        <ContentCollectionSettingsDialog
          collection={settingsTarget}
          onCancel={() => setSettingsTarget(null)}
          onSave={async (input) => {
            await updateCollection(settingsTarget, input)
            setSettingsTarget(null)
          }}
        />
      )}
    </>
  )
}

function ContentEntriesLoading() {
  // Skeleton entry row mirrors the real `.entryRow` chrome: a 28px preview
  // tile plus a two-line title/author stack, inside the same 44px row box,
  // so nothing shifts when entries swap in.
  return (
    <div
      className={styles.rows}
      data-testid="content-entries-loading"
      aria-busy="true"
      aria-label="Loading entries"
    >
      {Array.from({ length: 3 }, (_, i) => (
        <div
          key={`skeleton-entry-${i}`}
          className={styles.skeletonRow}
          aria-hidden="true"
        >
          <Skeleton width={28} height={28} radius={2} />
          <span className={styles.entryTitleStack}>
            <Skeleton width={`${60 + (i % 3) * 12}%`} height={11} />
            <Skeleton width={`${40 + (i % 2) * 14}%`} height={9} />
          </span>
        </div>
      ))}
    </div>
  )
}
