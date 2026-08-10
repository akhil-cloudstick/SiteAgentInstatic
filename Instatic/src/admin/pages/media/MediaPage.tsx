/**
 * MediaPage — the dedicated Media workspace.
 *
 * Canvas-style admin shell through AdminWorkspaceCanvasLayout. Folder tree in
 * the left sidebar, file grid/list in the canvas. Every interactive overlay —
 * the asset viewer, the upload queue, the bulk-edit pane — is a floating
 * window (per design: no docked right rail on this page).
 *
 * Window visibility lives in local state here; `useDraggablePanel` only owns
 * each window's POSITION via `workspaceLayoutStorage`. The upload queue
 * auto-opens when something starts uploading; the bulk-edit window
 * auto-opens once the user has 2+ assets selected; the viewer opens whenever
 * the user has a primary selection.
 */
import { useEffect, useState } from 'react'
import { AdminWorkspaceCanvasLayout } from '@admin/layouts/AdminWorkspaceCanvasLayout'
import {
  readWorkspaceLayout,
  writeWorkspaceLayout,
} from '@admin/state/workspaceLayoutStorage'
import { useAdminUi } from '@admin/state/adminUi'
import { MediaSidebar, type MediaSidebarPanelId } from './components/MediaSidebar/MediaSidebar'
import { MediaCanvas } from './components/MediaCanvas/MediaCanvas'
import { MediaViewerWindow } from './components/MediaViewerWindow/MediaViewerWindow'
import { UploadQueueWindow } from './components/UploadQueueWindow/UploadQueueWindow'
import { BulkEditWindow } from './components/BulkEditWindow/BulkEditWindow'
import { useMediaWorkspace } from './hooks/useMediaWorkspace'

const MEDIA_PANEL_IDS: ReadonlySet<MediaSidebarPanelId> = new Set(['folders', 'storage'])

function readPersistedMediaPanel(): MediaSidebarPanelId | null {
  const stored = readWorkspaceLayout('media').activeLeftPanel
  if (stored === null) return null
  if (typeof stored === 'string' && MEDIA_PANEL_IDS.has(stored as MediaSidebarPanelId)) {
    return stored as MediaSidebarPanelId
  }
  return 'folders'
}

export function MediaPage() {
  const workspace = useMediaWorkspace()
  // The reference pins a Settings action to the foot of the icon rail.
  const openSettings = useAdminUi((s) => s.openSettings)
  // Initial value pulls from the per-workspace stored layout so the rail
  // remembers the last panel the user had open in the Media workspace.
  const [activePanel, setActivePanel] = useState<MediaSidebarPanelId | null>(
    readPersistedMediaPanel,
  )
  // Persist rail toggles so the next visit to /admin/media reopens the same
  // panel (or stays closed if the user closed it).
  useEffect(() => {
    writeWorkspaceLayout('media', { activeLeftPanel: activePanel })
  }, [activePanel])
  const [uploadQueueOpen, setUploadQueueOpen] = useState(false)

  // Build the thin viewer-editor handle from the workspace. Same contract the
  // standalone MediaExplorerPanel-driven viewer uses, so the viewer doesn't
  // need to know it lives inside the full Media page.
  const viewerEditor = workspace.selectedAsset
    ? {
        asset: workspace.selectedAsset,
        tagPalette: workspace.tagPalette,
        folderById: workspace.folderById,
        folders: workspace.folders,
        updateAsset: workspace.updateAsset,
        renameAsset: workspace.renameAsset,
        replaceAssetFile: workspace.replaceAssetFile,
        restoreAsset: workspace.restoreAsset,
        purgeAsset: workspace.purgeAsset,
        trashAsset: workspace.trashAsset,
        moveToFolder: (assetId: string, folderId: string | null) =>
          workspace.moveAssetsToFolder([assetId], folderId),
      }
    : null

  // Viewer and Bulk Edit visibility is derived from the selection, but
  // CLOSING a window must not clear the selection — dismissing the details
  // panel and de-selecting the media are two different things.
  //
  // So a dismissal records the selection it applied to. The window stays
  // hidden for exactly that selection and reopens the moment the selection
  // changes, which keeps the derived model (no open/close effect chain)
  // while letting the user close a window and keep working with the files
  // they picked.
  const selectionKey = Array.from(workspace.selectedAssetIds).sort().join(',')
  const [dismissedSelection, setDismissedSelection] = useState<string | null>(null)
  const dismissed = selectionKey !== '' && dismissedSelection === selectionKey

  //   - Viewer: a single primary selection (≤ 1 item) is showing.
  //   - Bulk Edit: a 2+ multi-selection is in flight (mutually exclusive
  //     with the viewer).
  const viewerOpen =
    !dismissed &&
    workspace.selectedAssetId !== null &&
    workspace.selectedAssetIds.size <= 1
  const bulkEditOpen = !dismissed && workspace.selectedAssetIds.size >= 2

  // The upload queue IS genuinely stateful — it stays open after a transfer
  // completes (the user dismisses it) and the toolbar button toggles it — so
  // it can't be derived. Auto-opening on the async upload transition is the
  // legitimate "sync UI to an external async system" use of an effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (workspace.uploadQueue.active && !uploadQueueOpen) {
      setUploadQueueOpen(true)
    }
  }, [workspace.uploadQueue.active, uploadQueueOpen])
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <>
      <AdminWorkspaceCanvasLayout
        workspace="media"
        contentSidebar={(
          <MediaSidebar
            workspace={workspace}
            activePanel={activePanel}
            onActivePanelChange={setActivePanel}
            onOpenSettings={() => openSettings()}
          />
        )}
        contentCanvas={(
          // The reference carries Upload + Upload queue in the canvas
          // toolbar, not the app header.
          <MediaCanvas
            workspace={workspace}
            onToggleUploadQueue={() => setUploadQueueOpen((open) => !open)}
            uploadQueueOpen={uploadQueueOpen}
          />
        )}
        // No `contentRightPanel` — the asset inspector is a window now.
      />

      <MediaViewerWindow
        editor={viewerEditor}
        open={viewerOpen}
        onClose={() => setDismissedSelection(selectionKey)}
      />

      <UploadQueueWindow
        queue={workspace.uploadQueue}
        open={uploadQueueOpen}
        onClose={() => setUploadQueueOpen(false)}
        folderById={workspace.folderById}
      />

      <BulkEditWindow
        workspace={workspace}
        open={bulkEditOpen}
        onClose={() => setDismissedSelection(selectionKey)}
      />
    </>
  )
}
