/**
 * WorkspaceDock — the narrow-viewport bottom dock and its drawers.
 *
 * Below 1100px the approved MMSBUILD screen stops being a three-column editor
 * and becomes canvas-first: the canvas takes the whole viewport and the two
 * side panels become labelled drawers behind a three-button dock —
 * Outline · Properties · Advanced.
 *
 * The drawers host the SAME components as the desktop columns, not narrow
 * re-implementations, so behaviour, permissions and state are identical at
 * every width. Only the container changes.
 */
import { useEditorStore } from '@site/store/store'
import { selectSiteWorkspaceMode } from '@site/siteWorkspaceMode'
import { PageOutlinePanel } from '@site/sidebars/PageOutlinePanel'
import { PropertiesPanel } from '@site/panels/PropertiesPanel'
import { FaIcon } from '@ui/components/FaIcon'
import { Button } from '@ui/components/Button'
import styles from './WorkspaceDock.module.css'

export type WorkspaceDrawer = 'outline' | 'properties' | 'advanced'

const DOCK_ITEMS: ReadonlyArray<{ id: WorkspaceDrawer; label: string; icon: string }> = [
  { id: 'outline', label: 'Outline', icon: 'list' },
  { id: 'properties', label: 'Properties', icon: 'sliders' },
  { id: 'advanced', label: 'Advanced', icon: 'layer-group' },
]

const DRAWER_TITLES: Record<WorkspaceDrawer, string> = {
  outline: 'Page outline',
  properties: 'Properties',
  advanced: 'Advanced workspace',
}

interface WorkspaceDockProps {
  drawer: WorkspaceDrawer | null
  onDrawerChange: (drawer: WorkspaceDrawer | null) => void
  /** Rendered inside the Advanced drawer — the left sidebar's panel stack. */
  advancedContent: React.ReactNode
}

export function WorkspaceDock({ drawer, onDrawerChange, advancedContent }: WorkspaceDockProps) {
  const mode = useEditorStore(selectSiteWorkspaceMode)

  return (
    <>
      {drawer && (
        <div
          className={styles.drawer}
          role="dialog"
          aria-modal="false"
          aria-label={`${DRAWER_TITLES[drawer]} drawer`}
          data-testid={`workspace-drawer-${drawer}`}
        >
          <div className={styles.drawerHeading}>
            <strong>{DRAWER_TITLES[drawer]}</strong>
            <Button
              variant="ghost"
              size="lg"
              shape="pill"
              iconOnly
              aria-label={`Close ${DRAWER_TITLES[drawer]} drawer`}
              onClick={() => onDrawerChange(null)}
            >
              <FaIcon name="xmark" size={15} />
            </Button>
          </div>
          <div className={styles.drawerBody}>
            {drawer === 'outline' && <PageOutlinePanel mode={mode} drawer />}
            {drawer === 'properties' && <PropertiesPanel variant="docked" />}
            {drawer === 'advanced' && advancedContent}
          </div>
        </div>
      )}

      <nav className={styles.dock} aria-label="Workspace drawers" data-testid="workspace-dock">
        {DOCK_ITEMS.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            size="lg"
            className={styles.dockButton}
            aria-expanded={drawer === item.id}
            data-selected={drawer === item.id ? 'true' : undefined}
            data-testid={`workspace-dock-${item.id}`}
            onClick={() => onDrawerChange(drawer === item.id ? null : item.id)}
          >
            <FaIcon name={item.icon} size={14} />
            <span>{item.label}</span>
          </Button>
        ))}
      </nav>
    </>
  )
}
