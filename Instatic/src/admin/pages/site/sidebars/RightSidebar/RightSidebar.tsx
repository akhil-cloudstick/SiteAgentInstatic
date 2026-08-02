import { useRef, type CSSProperties } from 'react'
import { selectRightSidebarExpanded, useEditorStore } from '@site/store/store'
import { PropertiesPanel } from '@site/panels/PropertiesPanel'
import { SidebarResizeHandle } from '@admin/shared/SidebarResizeHandle'
import { PROPERTIES_PANEL_DEFAULT_WIDTH } from '@site/store/slices/uiSlice'
import styles from './RightSidebar.module.css'

/**
 * Right-sidebar mode — picked by the parent layout based on workspace and
 * permissions. Decouples the sidebar's expanded/collapsed state from the
 * (async) availability of its `contentPanel`:
 *
 * - `site`     — Site editor. Width follows `sitePropertiesExpanded`
 *                (open iff a node/class is selected AND docked AND not
 *                collapsed). When expanded and no `contentPanel` is
 *                provided, falls back to the docked default
 *                `<PropertiesPanel>`.
 * - `hidden`   — Site viewer (no `pages.draft.save` capability). Always
 *                closed; renders nothing inside.
 */
type RightSidebarMode = 'site' | 'hidden'

interface RightSidebarProps {
  mode: RightSidebarMode
}

export function RightSidebar({ mode }: RightSidebarProps) {
  const sidebarRef = useRef<HTMLElement | null>(null)
  const propertiesPanel = useEditorStore((s) => s.propertiesPanel)
  const propertiesPanelMode = useEditorStore((s) => s.propertiesPanelMode)
  const setPropertiesPanel = useEditorStore((s) => s.setPropertiesPanel)

  const isDocked = propertiesPanelMode === 'docked'
  const sitePropertiesExpanded = useEditorStore(selectRightSidebarExpanded)

  // Width is derived purely from synchronous state — same model the
  // left sidebar uses. No dependence on the async `contentPanel` prop
  // means the sidebar lands at its final width on first paint and
  // stays there, only changing when the user explicitly toggles
  // open/close (which the CSS transition in RightSidebar.module.css
  // animates smoothly).
  const isExpanded = mode === 'site' ? sitePropertiesExpanded : false

  const panelWidth = isExpanded ? propertiesPanel.width : 0
  // `DEFAULT_PROPERTIES_PANEL_WIDTH` means "never dragged" — the mode's
  // approved track wins until the user expresses a preference, after which
  // their width is honoured in every mode.
  const userSizedPanel = propertiesPanel.width !== PROPERTIES_PANEL_DEFAULT_WIDTH

  const style = {
    '--right-sidebar-panel-width': `${panelWidth}px`,
    '--right-sidebar-panel-layout-width': `${propertiesPanel.width}px`,
  } as CSSProperties

  return (
    <aside
      ref={sidebarRef}
      className={styles.sidebar}
      data-testid="right-sidebar"
      data-expanded={isExpanded ? 'true' : 'false'}
      data-mode={propertiesPanelMode}
      // Take the width from the mode's approved track (280 / 380 / 316px)
      // until the user drags the handle, so the inspector reads identically in
      // Live edit, Focus section and Responsive review.
      data-site-track={mode === 'site' && !userSizedPanel ? 'true' : undefined}
      style={style}
    >
      {isExpanded && (
        <SidebarResizeHandle
          side="right"
          width={propertiesPanel.width}
          targetRef={sidebarRef}
          cssVariable="--right-sidebar-panel-width"
          layoutCssVariable="--right-sidebar-panel-layout-width"
          ariaLabel="Resize right sidebar"
          onResize={(width) => setPropertiesPanel({ width })}
        />
      )}

      {mode === 'site' && isDocked && (
        <div
          className={styles.panelSlot}
          data-testid="right-sidebar-panel-slot"
          inert={isExpanded ? undefined : true}
        >
          <PropertiesPanel variant="docked" />
        </div>
      )}
    </aside>
  )
}
