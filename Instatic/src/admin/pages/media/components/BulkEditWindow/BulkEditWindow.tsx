/**
 * BulkEditWindow — shown when 2+ assets are selected.
 *
 * Transcribed from the MMSBUILD Media reference (`screens/media/src/App.jsx`
 * → `BulkWindow`). The reference's window is deliberately small: one help
 * line, an "Add tag" field with an inline Add button, a "Move to folder"
 * select, and a full-width "Move N items to Trash" action. Nothing else.
 *
 * Pinned bottom-right (`.bulk-window { right: 24px; bottom: 24px; width:
 * 360px }`), mutually exclusive with the viewer, and dismissed by Escape or
 * a click outside.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { Input } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { canDeleteMedia, canWriteMedia } from '@admin/access'
import { useCurrentAdminUser } from '@admin/sessionContext'
import type { UseMediaWorkspaceResult } from '../../hooks/useMediaWorkspace'
import styles from './BulkEditWindow.module.css'

interface BulkEditWindowProps {
  workspace: UseMediaWorkspaceResult
  open: boolean
  onClose: () => void
}

// Module-level so the React Compiler can compile the component body — it
// bails on try/finally inside a component or hook.
async function runAddTag(
  tag: string,
  assets: UseMediaWorkspaceResult['selectedAssets'],
  workspace: UseMediaWorkspaceResult,
  setBusy: (v: boolean) => void,
  clearTag: () => void,
): Promise<void> {
  try {
    for (const asset of assets) {
      if (asset.tags.includes(tag)) continue
      await workspace.updateAsset(asset.id, {
        tags: [...asset.tags, tag].sort(),
      })
    }
    clearTag()
  } finally {
    setBusy(false)
  }
}

async function runMoveToFolder(
  folderId: string | null,
  assetIds: string[],
  workspace: UseMediaWorkspaceResult,
  setBusy: (v: boolean) => void,
): Promise<void> {
  try {
    await workspace.moveAssetsToFolder(assetIds, folderId)
  } finally {
    setBusy(false)
  }
}

async function runTrashAll(
  assets: UseMediaWorkspaceResult['selectedAssets'],
  workspace: UseMediaWorkspaceResult,
  setBusy: (v: boolean) => void,
): Promise<void> {
  try {
    for (const asset of assets) await workspace.trashAsset(asset.id)
  } finally {
    setBusy(false)
  }
}

export function BulkEditWindow({ workspace, open, onClose }: BulkEditWindowProps) {
  const currentUser = useCurrentAdminUser()
  const [tag, setTag] = useState('')
  const [busy, setBusy] = useState(false)
  const panelRef = useRef<HTMLElement | null>(null)

  const assets = workspace.selectedAssets
  const count = assets.length
  const canWrite = canWriteMedia(currentUser)
  const canDelete = canDeleteMedia(currentUser)

  // Escape, or a click outside, closes.
  //
  // "Outside" deliberately EXCLUDES `data-media-surface` — the canvas and
  // the folder sidebar. This window is derived from the selection, so a
  // click on a tile is a selection change, not a dismissal. Without the
  // exclusion, adding a third asset to the selection would close the window
  // and clear everything.
  useEffect(() => {
    if (!open) return undefined
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
  }, [open, onClose])

  if (!open) return null

  async function addTag() {
    const next = tag.trim().toLowerCase()
    if (!next || !canWrite || busy) return
    setBusy(true)
    await runAddTag(next, assets, workspace, setBusy, () => setTag(''))
  }

  async function moveToFolder(value: string) {
    if (!value || !canWrite || busy) return
    setBusy(true)
    await runMoveToFolder(
      value === '__root__' ? null : value,
      assets.map((asset) => asset.id),
      workspace,
      setBusy,
    )
  }

  async function trashAll() {
    if (!canDelete || busy) return
    setBusy(true)
    await runTrashAll(assets, workspace, setBusy)
  }

  return createPortal(
    <section
      ref={panelRef}
      className={styles.window}
      // Portals to `document.body`, outside whichever workspace opened it.
      data-editor-screen="media"
      role="dialog"
      aria-label={`Bulk edit ${count} media items`}
      data-testid="media-bulk-edit"
    >
      <div className={styles.titlebar}>
        <div className={styles.titlebarText}>
          <span className={styles.titlebarIcon} aria-hidden="true">
            <FaIcon name="layer-group" size={14} />
          </span>
          <strong className={styles.titlebarTitle}>Bulk edit</strong>
          <span className={styles.titlebarMeta}>{count} selected</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Close bulk edit"
          onClick={onClose}
        >
          <FaIcon name="xmark" size={13} />
        </Button>
      </div>

      <div className={styles.content}>
        <p className={styles.help}>
          Apply shared metadata without replacing any original files.
        </p>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Add tag</span>
          <div className={styles.inlineField}>
            <Input
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              disabled={!canWrite || busy}
              placeholder="e.g. campaign"
              aria-label="Tag to add"
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); void addTag() }
              }}
            />
            <Button
              variant="secondary"
              size="md"
              disabled={!tag.trim() || !canWrite || busy}
              onClick={() => void addTag()}
            >
              Add
            </Button>
          </div>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Move to folder</span>
          <Select
            aria-label="Move to folder"
            fieldSize="md"
            disabled={!canWrite || busy}
            value=""
            onChange={(event) => void moveToFolder(event.target.value)}
            options={[
              { value: '', label: 'Choose folder', textValue: 'Choose folder' },
              { value: '__root__', label: 'All media (root)', textValue: 'All media (root)' },
              ...workspace.folders.map((folder) => ({
                value: folder.id,
                label: folder.name,
                textValue: folder.name,
              })),
            ]}
          />
        </label>

        {canDelete && (
          <Button
            variant="ghost"
            size="md"
            tone="danger"
            className={styles.trashAction}
            disabled={busy}
            onClick={() => void trashAll()}
          >
            <FaIcon name="trash" size={12} />
            <span>Move {count} items to Trash</span>
          </Button>
        )}
      </div>
    </section>,
    document.body,
  )
}
