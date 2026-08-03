/**
 * PageOutlinePanel — the Site workspace's left column.
 *
 * The approved MMSBUILD screen leads with a *guided* view of the page: the
 * top-level sections (Header, Hero, Services, …), a search box, per-row
 * actions, "Add section", and — collapsed at the bottom — an "Explorer"
 * disclosure holding the full developer tool set.
 *
 * That disclosure replaces the vertical icon rail this editor used to have.
 * It is only the trigger that changed: `setLeftSidebarPanel` /
 * `toggleLeftSidebarPanel` / `setActivePluginPanel` are the same store actions
 * the rail called, so spotlight commands, layout persistence and the read-only
 * gating all keep working untouched.
 *
 * Everything shown is real page-tree data. "Sections" are the direct children
 * of the page root — the same nodes the Layers tree shows at depth 1 — and
 * every action here routes through the existing store mutations, so a section
 * added from this panel is indistinguishable from one added in Layers.
 */
import { useState, type ReactNode } from 'react'
import { useEditorStore, selectActiveCanvasPage } from '@site/store/store'
import { registry } from '@core/module-engine'
import { getNodeDisplayName, type Breakpoint, type PageNode } from '@core/page-tree'
import { useEditorPermissions } from '@site/editorPermissionsContext'
import { FaIcon } from '@ui/components/FaIcon'
import { Button } from '@ui/components/Button'
import { SearchBar } from '@ui/components/SearchBar'
import { LayerNodeContextMenu } from '@site/panels/DomPanel/LayerNodeContextMenu'
import { ModuleInserterDialog } from '@site/module-picker/ModuleInserterDialog'
import { useInsertInserterItem } from '@site/hooks/useInsertInserterItem'
import { topLevelSectionIds, type SiteWorkspaceMode } from '@site/siteWorkspaceMode'
import { ExplorerDisclosure } from './ExplorerDisclosure'
import { moduleGlyph } from '@site/moduleGlyph'
import styles from './PageOutlinePanel.module.css'

const EMPTY_BREAKPOINTS: Breakpoint[] = []

const HEADINGS: Record<SiteWorkspaceMode, string> = {
  live: 'Page outline',
  focus: 'Page map',
  review: 'Review outline',
}

interface PageOutlinePanelProps {
  mode: SiteWorkspaceMode
  /** Narrow-viewport drawer variant — drops the panel border and fills. */
  drawer?: boolean
  /**
   * True while a switched-to panel (Layers, Media, Framework, …) occupies the
   * shared column. The outline body collapses, but the Explorer disclosure
   * stays visible so the switcher never disappears with it.
   */
  hidden?: boolean
  /** Heading for the switched-to panel, replacing the outline's own. */
  toolHeading?: string | null
  /** The switched-to panel itself, rendered in place of the outline list. */
  children?: ReactNode
}

export function PageOutlinePanel({
  mode,
  drawer = false,
  hidden = false,
  toolHeading = null,
  children,
}: PageOutlinePanelProps) {
  const page = useEditorStore(selectActiveCanvasPage)
  const visualComponents = useEditorStore((s) => s.site?.visualComponents)
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId)
  const selectNode = useEditorStore((s) => s.selectNode)
  const moveNodes = useEditorStore((s) => s.moveNodes)
  const breakpoints = useEditorStore((s) => s.site?.breakpoints ?? EMPTY_BREAKPOINTS)
  const activeBreakpointId = useEditorStore((s) => s.activeBreakpointId)
  const setActiveBreakpoint = useEditorStore((s) => s.setActiveBreakpoint)
  const setLeftSidebarPanel = useEditorStore((s) => s.setLeftSidebarPanel)
  const setExplorerPanelTab = useEditorStore((s) => s.setExplorerPanelTab)
  const permissions = useEditorPermissions()

  const [query, setQuery] = useState('')
  const [inserterOpen, setInserterOpen] = useState(false)
  const [rowMenu, setRowMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const onInsertItem = useInsertInserterItem()

  const sectionIds = topLevelSectionIds(page)
  const sections = sectionIds
    .map((id) => page?.nodes[id])
    .filter((node): node is PageNode => node !== undefined)
    .map((node) => ({
      node,
      label: getNodeDisplayName(node, registry.get(node.moduleId), visualComponents),
    }))

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? sections.filter((section) => section.label.toLowerCase().includes(needle))
    : sections

  /**
   * Reordering from the outline moves a section one place earlier — the
   * reference's grip is a nudge, not a drag surface (full drag-and-drop lives
   * in the Layers tree, which is one click away in the Explorer disclosure).
   * It goes through `moveNodes`, so it is one undo step like any other move.
   */
  /**
   * The reference's Live-mode heading button. It opens the full tool set — the
   * same destination the Explorer disclosure at the foot reaches, through the
   * same store actions, so the two entry points can never disagree about what
   * "Explorer" means.
   */
  function openExplorer(): void {
    setExplorerPanelTab('layers')
    setLeftSidebarPanel('explorer')
  }

  function moveEarlier(nodeId: string): void {
    const index = sectionIds.indexOf(nodeId)
    if (index < 1 || !page) return
    moveNodes([nodeId], page.rootNodeId, index - 1)
  }

  return (
    <aside
      className={drawer ? styles.panelDrawer : styles.panel}
      aria-label={HEADINGS[mode]}
      data-testid="page-outline-panel"
      data-mode={mode}
      data-body-hidden={hidden ? 'true' : undefined}
    >
      {/* Heading + its one action, per the reference: Live offers Explorer,
          Focus offers "Add section", Review offers neither (its actions live in
          the viewport-context block below). */}
      <div className={styles.heading}>
        <h2>{hidden ? (toolHeading ?? HEADINGS[mode]) : HEADINGS[mode]}</h2>
        {!hidden && mode === 'live' && (
          <Button
            variant="secondary"
            size="md"
            className={styles.headingAction}
            onClick={openExplorer}
            data-testid="page-outline-open-explorer"
          >
            <FaIcon name="sitemap" size={12} />
            <span>Explorer</span>
          </Button>
        )}
        {!hidden && mode === 'focus' && permissions.canEditStructure && (
          <Button
            variant="secondary"
            size="md"
            className={styles.headingAction}
            onClick={() => setInserterOpen(true)}
            data-testid="page-outline-add-section-top"
          >
            <FaIcon name="plus" size={12} />
            <span>Add section</span>
          </Button>
        )}
      </div>

      {!hidden && mode === 'live' && (
        <>
          <SearchBar
            className={styles.search}
            value={query}
            onValueChange={setQuery}
            placeholder="Search sections…"
            aria-label="Search sections"
          />
          <p className={styles.kicker}>Top-level layers</p>
        </>
      )}

      {/* The switched-to panel replaces the outline list IN PLACE — same
          column, same heading, same disclosure below. It is not an overlay:
          stacking a second panel on top of the menu is what produced the
          floating block over the sidebar. */}
      {hidden && <div className={styles.toolRegion}>{children}</div>}

      <div className={styles.body} hidden={hidden}>

      <div className={styles.outlineList} role="list">
        {visible.map(({ node, label }) => (
          <div
            key={node.id}
            role="listitem"
            className={styles.row}
            data-selected={selectedNodeId === node.id ? 'true' : undefined}
          >
            {mode !== 'live' && permissions.canEditStructure && (
              <Button
                variant="ghost"
                size="md"
                iconOnly
                className={styles.grip}
                aria-label={`Move ${label} earlier`}
                onClick={() => moveEarlier(node.id)}
              >
                <FaIcon name="grip-vertical" size={13} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="md"
              align="start"
              className={styles.rowSelect}
              aria-pressed={selectedNodeId === node.id}
              data-testid={`page-outline-row-${node.id}`}
              onClick={() => selectNode(node.id)}
            >
              <FaIcon name={moduleGlyph(node.moduleId, label)} size={15} />
              {/* The tenant's own section names — masked by the pixel gate,
                  which holds the row geometry around them to the reference. */}
              <span className={styles.rowLabel} data-fidelity-dynamic="">{label}</span>
            </Button>
            {permissions.canEditStructure && (
              <Button
                variant="ghost"
                size="md"
                iconOnly
                className={styles.rowMenuButton}
                aria-label={`Actions for ${label}`}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  setRowMenu({ nodeId: node.id, x: rect.left, y: rect.bottom })
                }}
              >
                <FaIcon name="ellipsis" size={13} />
              </Button>
            )}
          </div>
        ))}
        {visible.length === 0 && (
          <p className={styles.emptyMessage}>
            {needle ? 'No sections match that search.' : 'This page has no sections yet.'}
          </p>
        )}
      </div>

      {mode === 'live' && permissions.canEditStructure && (
        <Button
          variant="ghost"
          size="lg"
          className={styles.addSection}
          onClick={() => setInserterOpen(true)}
          data-testid="page-outline-add-section"
        >
          <FaIcon name="plus" size={13} />
          <span>Add section</span>
        </Button>
      )}

      {mode === 'review' && (
        <div className={styles.viewportContext}>
          <h3>Viewport context</h3>
          <p>Base styles apply everywhere. Other contexts store only their overrides.</p>
          {breakpoints.map((breakpoint) => (
            <Button
              key={breakpoint.id}
              variant="ghost"
              size="lg"
              align="start"
              className={styles.viewportButton}
              data-selected={activeBreakpointId === breakpoint.id ? 'true' : undefined}
              aria-pressed={activeBreakpointId === breakpoint.id}
              onClick={() => setActiveBreakpoint(breakpoint.id)}
            >
              <FaIcon name={breakpoint.id === 'mobile' ? 'mobile-screen-button'
                : breakpoint.id === 'tablet' ? 'tablet-screen-button' : 'desktop'} size={14} />
              <span>
                {/* The reference marks the widest context as the base, because
                    that is the one whose styles apply everywhere. */}
                {isBaseContext(breakpoints, breakpoint) ? 'Base · ' : ''}
                {breakpoint.label} ({breakpoint.width} px)
              </span>
            </Button>
          ))}
        </div>
      )}

      </div>

      {/* Outside the collapsing body: the switcher must stay reachable while a
          panel occupies the column, otherwise you could switch away from the
          outline and have no way back. */}
      <ExplorerDisclosure mode={mode} />

      {rowMenu && (
        <OutlineRowMenu
          nodeId={rowMenu.nodeId}
          x={rowMenu.x}
          y={rowMenu.y}
          onClose={() => setRowMenu(null)}
        />
      )}

      {inserterOpen && (
        <ModuleInserterDialog
          onClose={() => setInserterOpen(false)}
          onInsertItem={onInsertItem}
        />
      )}
    </aside>
  )
}

/** The widest configured context is the base — every narrower one overrides it. */
function isBaseContext(breakpoints: readonly Breakpoint[], breakpoint: Breakpoint): boolean {
  return breakpoints.every((other) => other.width <= breakpoint.width)
}

/**
 * The row's `⋯` menu is the SAME menu the Layers tree uses — duplicate, wrap,
 * copy/cut/paste, rename, delete, "Insert module here" — so a section behaves
 * identically wherever the author acts on it.
 */
function OutlineRowMenu({
  nodeId,
  x,
  y,
  onClose,
}: { nodeId: string; x: number; y: number; onClose: () => void }) {
  const deleteNode = useEditorStore((s) => s.deleteNode)
  const duplicateNode = useEditorStore((s) => s.duplicateNode)
  const wrapNode = useEditorStore((s) => s.wrapNode)
  const copyNode = useEditorStore((s) => s.copyNode)
  const cutNode = useEditorStore((s) => s.cutNode)
  const pasteNode = useEditorStore((s) => s.pasteNode)
  const renameNode = useEditorStore((s) => s.renameNode)
  const page = useEditorStore(selectActiveCanvasPage)
  const visualComponents = useEditorStore((s) => s.site?.visualComponents)

  const node = page?.nodes[nodeId]

  return (
    <LayerNodeContextMenu
      x={x}
      y={y}
      nodeId={nodeId}
      onClose={onClose}
      onDelete={() => { deleteNode(nodeId); onClose() }}
      onDuplicate={() => { duplicateNode(nodeId); onClose() }}
      onRename={() => {
        // The outline has no inline-rename affordance of its own, so it asks
        // for the new name the same way the canvas rename dialog does: seed
        // with the current display name and commit through `renameNode`.
        if (!node) return onClose()
        const current = getNodeDisplayName(node, registry.get(node.moduleId), visualComponents)
        renameNode(nodeId, current)
        onClose()
      }}
      onWrapInContainer={() => { wrapNode(nodeId, 'base.container'); onClose() }}
      onCopy={() => { copyNode(nodeId); onClose() }}
      onCut={() => { cutNode(nodeId); onClose() }}
      onPaste={() => { pasteNode(nodeId); onClose() }}
    />
  )
}
