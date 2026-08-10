/**
 * MediaSidebar — icon rail + folder column for the Media workspace.
 *
 * Transcribed from the MMSBUILD Media reference (`screens/media/src/App.jsx`
 * → `.context-rail` + `.folder-sidebar`). Behaviour is the reference's, not
 * an interpretation of it:
 *
 *   • The folder column is PART OF THE WORKSPACE. It is always mounted and
 *     never swaps its contents.
 *   • The close button exists in the markup but the reference hides it on
 *     desktop (`.sidebar-close { display: none }`) and only shows it at
 *     ≤767px, where the column becomes a drawer. So there is no desktop X.
 *   • Storage does NOT replace the folder column. It opens `.storage-panel`,
 *     a fixed panel on the right of the canvas, and the folders stay put.
 *   • The Folders rail button is active whenever Storage is closed.
 *
 * Media used to borrow the Site editor's `LeftSidebar` + `PanelRail` CSS
 * modules; it owns `MediaSidebar.module.css` now, so restyling Media cannot
 * repaint the Site editor.
 */
import { useRef } from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { hasCapability } from '@admin/access'
import { useCurrentAdminUser } from '@admin/sessionContext'
import { MediaFolderPanel } from '../MediaFolderPanel/MediaFolderPanel'
import { MediaStoragePanel } from '../MediaStoragePanel/MediaStoragePanel'
import type { UseMediaWorkspaceResult } from '../../hooks/useMediaWorkspace'
import styles from './MediaSidebar.module.css'

export type MediaSidebarPanelId = 'folders' | 'storage'

interface MediaSidebarProps {
  workspace: UseMediaWorkspaceResult
  activePanel: MediaSidebarPanelId | null
  onActivePanelChange: (panel: MediaSidebarPanelId | null) => void
  /** Opens the admin Settings modal — the reference's rail-foot action. */
  onOpenSettings?: () => void
}

export function MediaSidebar({
  workspace,
  activePanel,
  onActivePanelChange,
  onOpenSettings,
}: MediaSidebarProps) {
  const sidebarRef = useRef<HTMLElement | null>(null)
  const currentUser = useCurrentAdminUser()

  // Storage election changes which adapter handles each asset role. Gated by
  // `storage.elect`. Hide the rail button entirely for users who can't use
  // it; the API endpoints also enforce this gate server-side.
  const canElectStorage = hasCapability(currentUser, 'storage.elect')
  const storageOpen = activePanel === 'storage' && canElectStorage

  // Defensive: if the user had Storage open and then lost the capability,
  // collapse it on the next render rather than showing a stale 403.
  if (activePanel === 'storage' && !canElectStorage) {
    onActivePanelChange('folders')
  }

  // The reference's drawer flag. On desktop the column is always visible;
  // below 767px `foldersOpen` slides it in over the canvas.
  const foldersOpen = activePanel === 'folders'

  return (
    <aside
      ref={sidebarRef}
      className={styles.sidebar}
      data-media-surface=""
      data-testid="media-left-sidebar"
      data-expanded={foldersOpen ? 'true' : 'false'}
      data-active-panel={activePanel ?? 'folders'}
    >
      <nav
        aria-label="Media workspace sections"
        className={styles.rail}
        data-testid="media-panel-rail"
      >
        {/* Folders is active whenever Storage is closed — the reference
            keys it off `!storageOpen`, not off its own toggle. */}
        <Button
          variant="ghost"
          size="md"
          iconOnly
          pressed={!storageOpen}
          aria-label="Folders and media"
          tooltip="Folders"
          tooltipSide="right"
          data-testid="media-panel-rail-folders"
          onClick={() => onActivePanelChange(foldersOpen && !storageOpen ? null : 'folders')}
          className={styles.railButton}
        >
          <FaIcon name="folder-open" size={17} />
        </Button>

        {canElectStorage && (
          <Button
            variant="ghost"
            size="md"
            iconOnly
            pressed={storageOpen}
            aria-label="Storage and migrations"
            tooltip="Storage"
            tooltipSide="right"
            data-testid="media-panel-rail-storage"
            onClick={() => {
              onActivePanelChange('storage')
              workspace.clearSelection()
            }}
            className={styles.railButton}
          >
            <FaIcon name="hard-drive" size={17} />
          </Button>
        )}

        {onOpenSettings && (
          <Button
            variant="ghost"
            size="md"
            iconOnly
            aria-label="Media settings"
            tooltip="Settings"
            tooltipSide="right"
            data-testid="media-panel-rail-settings"
            onClick={onOpenSettings}
            className={`${styles.railButton} ${styles.railBottom}`}
          >
            <FaIcon name="gear" size={17} />
          </Button>
        )}
      </nav>

      {/* The folder column is always mounted and never swaps its contents. */}
      <div className={styles.panelBody} data-testid="media-folders-panel-slot">
        <div className={styles.heading}>
          <div className={styles.headingText}>
            <p className={styles.eyebrow}>Media library</p>
            <h1 className={styles.title}>Folders</h1>
          </div>
          {/* Present in the reference markup but hidden by CSS on desktop;
              it only appears at ≤767px, where this column is a drawer. */}
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Close folders"
            className={styles.sidebarClose}
            onClick={() => onActivePanelChange(null)}
          >
            <FaIcon name="xmark" size={13} />
          </Button>
        </div>

        <MediaFolderPanel workspace={workspace} />
      </div>

      {/* `.storage-panel` — a fixed panel over the canvas. The folder column
          stays exactly where it is. */}
      {storageOpen && (
        <div className={styles.storagePanel} data-testid="media-storage-panel-shell">
          <div className={styles.storageHeading}>
            <div className={styles.storageHeadingText}>
              <FaIcon name="hard-drive" size={14} />
              <strong>Storage</strong>
            </div>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="Close storage"
              onClick={() => onActivePanelChange('folders')}
            >
              <FaIcon name="xmark" size={13} />
            </Button>
          </div>
          <div className={styles.storageBody}>
            <MediaStoragePanel />
          </div>
        </div>
      )}
    </aside>
  )
}
