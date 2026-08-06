import { lazy, Suspense, useRef, type CSSProperties, type ReactNode } from 'react'
import { useEditorStore } from '@site/store/store'
import type { ExplorerPanelTab, LeftSidebarPanelId } from '@site/store/slices/uiSlice'
import { AgentStoreProvider } from '@admin/ai/AgentStoreContext'
import { FrameworkPanel } from '@site/panels/FrameworkPanel'
import { ExplorerPanel } from '@site/panels/ExplorerPanel'
import { DependenciesPanel } from '@site/panels/DependenciesPanel'
import { PageOutlinePanel } from '@site/sidebars/PageOutlinePanel'
import { PluginEditorPanel } from '@site/panels/PluginEditorPanel'
import { SelectorsPanel } from '@site/panels/SelectorsPanel'
import { FrameworkChangeConfirmProvider } from '@admin/shared/dialogs/FrameworkChangeConfirmDialog'
import { VCDeletionConfirmProvider } from '@admin/shared/dialogs/VCDeletionConfirmDialog'
import { SidebarResizeHandle } from '@admin/shared/SidebarResizeHandle'
import { selectSiteWorkspaceMode, type SiteWorkspaceMode } from '@site/siteWorkspaceMode'
import {
  PanelResizeHandle,
  useDraggablePanel,
  useResizablePanel,
} from '@admin/shared/FloatingWindow'
import { cn } from '@ui/cn'
import styles from './LeftSidebar.module.css'

// Image preparation and provider catalogue code belong to the AI surface, not
// the editor startup path. A nested boundary lets the sidebar/canvas render as
// soon as their parent chunk is ready, then loads the always-mounted AgentPanel
// independently so its local draft survives panel switches after first load.
const AgentPanel = lazy(() =>
  import('@site/panels/AgentPanel').then((module) => ({ default: module.AgentPanel })),
)

type HostedLeftPanelId = LeftSidebarPanelId

function selectActiveLeftSidebarPanel(
  state: ReturnType<typeof useEditorStore.getState>,
): HostedLeftPanelId | null {
  // A plugin panel takes precedence over the built-in `*PanelOpen` flags;
  // the LeftSidebar reads `activePluginPanelId` separately and shows the
  // plugin mount when set.
  if (state.activePluginPanelId !== null) return null
  if (state.explorerPanelOpen) return 'explorer'
  if (state.selectorsPanelOpen) return 'selectors'
  if (state.frameworkPanelOpen) return 'framework'
  if (state.dependenciesPanelOpen) return 'dependencies'
  // The AI assistant is a column occupant like everything else: picking it
  // swaps the column's content, the way picking Layers or Media does. It used
  // to float over the editor as its own window, which meant two panels open at
  // once and no single place the column's content came from. Its behaviour —
  // model routing, the operator-configured providers, the classifier, image
  // paste — is untouched; only where it renders changed.
  if (state.isAgentOpen) return 'agent'
  return null
}

interface LeftSidebarProps {
  /** Drives the rail-button accent identity hash (`${workspace}:${id}:…`). */
  workspace?: 'site' | 'content' | 'media'
  railOnly?: boolean
  /**
   * Whether the caller can perform structural edits (DnD, add/remove nodes,
   * pages, styles). Controls which side-panels are exposed in the rail.
   *
   * Falsy callers (Viewer / Client) still see the Explorer panel (Layers /
   * Pages / Media navigation surfaces) — they're not editing tools. The
   * structural Selectors / Framework / Dependencies panels stay hidden. The
   * Agent panel is controlled separately by `canUseAiChat`.
   *
   * Each panel is responsible for respecting its own read-only state for
   * the interactions it exposes (TreeNode drag, context menus, etc.).
   */
  editable?: boolean
  canUseAiChat?: boolean
}

/**
 * Set of rail items that remain visible to read-only callers — purely
 * navigational / view surfaces. Anything not in this set is editing-only
 * and is dropped from the rail (and its panel mount) when `editable=false`.
 */
const READ_ONLY_RAIL_IDS: ReadonlySet<LeftSidebarPanelId> = new Set(['explorer'])
/**
 * What each Explorer tab lists. It names the content in the column's KICKER,
 * under the search field — the heading above stays the workspace mode.
 */
const EXPLORER_TAB_LABELS: Record<ExplorerPanelTab, string> = {
  layers: 'Layers',
  site: 'Layouts',
  code: 'Code',
  media: 'Media',
}

/**
 * Placeholder for the column's search field per tab. Only the Layers tree
 * filters on it; the others are left without a field rather than given an
 * inert one.
 */
const EXPLORER_TAB_SEARCH: Partial<Record<ExplorerPanelTab, string>> = {
  layers: 'Search layers…',
}

const PANEL_RESIZE_LABELS: Record<HostedLeftPanelId, string> = {
  explorer: 'Explorer',
  selectors: 'Selectors',
  framework: 'Framework',
  dependencies: 'Dependencies',
  agent: 'AI authoring',
}

export function LeftSidebar({
  workspace = 'site',
  railOnly = false,
  editable = true,
  canUseAiChat = true,
}: LeftSidebarProps) {
  const sidebarRef = useRef<HTMLElement | null>(null)
  const siteMode = useEditorStore(selectSiteWorkspaceMode)
  const activePanel = useEditorStore(selectActiveLeftSidebarPanel)
  const explorerTab = useEditorStore((s) => s.explorerPanelTab)
  const activePluginPanelId = useEditorStore((s) => s.activePluginPanelId)
  const leftSidebarWidth = useEditorStore((s) => s.leftSidebarWidth)
  const leftSidebarMode = useEditorStore((s) => s.leftSidebarMode)
  const setLeftSidebarWidth = useEditorStore((s) => s.setLeftSidebarWidth)
  const setLeftSidebarMode = useEditorStore((s) => s.setLeftSidebarMode)
  // When the user can't edit structure, drop them onto Layers if they had a
  // hidden-for-them panel active (selectors, colors, …). Plugin panels are
  // editing-only by definition.
  const effectiveActivePanel =
    activePanel && canShowBuiltInPanel(activePanel, editable, canUseAiChat)
      ? activePanel
      : editable
        ? null
        : 'explorer'
  const effectivePluginPanelId = editable ? activePluginPanelId : null
  // Sidebar is "expanded" whenever a built-in OR plugin panel is showing.
  const sidebarOpen = Boolean(effectiveActivePanel) || effectivePluginPanelId !== null
  const panelFloating = sidebarOpen && leftSidebarMode === 'floating'
  const panelExpanded = sidebarOpen && leftSidebarMode === 'docked' && !railOnly
  const panelVisible = panelExpanded || panelFloating
  const panelWidth = panelExpanded ? leftSidebarWidth : 0
  const panelResizeLabel = effectivePluginPanelId !== null
    ? 'plugin'
    : effectiveActivePanel
      ? PANEL_RESIZE_LABELS[effectiveActivePanel]
      : 'left sidebar'
  const {
    panelRef,
    setPanelRef,
    headerDragProps,
    panelPositionStyle,
  } = useDraggablePanel('site', () => ({ x: 58, y: 64 }))
  const {
    panelSizeStyle,
    resizeHandleProps,
  } = useResizablePanel(
    'site',
    panelRef,
    () => ({ width: leftSidebarWidth, height: 520 }),
  )

  const togglePanelMode = () => {
    setLeftSidebarMode(leftSidebarMode === 'docked' ? 'floating' : 'docked')
  }
  const dockablePanelProps = {
    mode: leftSidebarMode,
    dragHandleProps: panelFloating ? headerDragProps : undefined,
    onToggleMode: togglePanelMode,
  } as const

  // The Site workspace is ONE column: the outline and every switchable panel
  // share the same track, so the panel must not add width on top of it.
  const isSiteColumn = workspace === 'site' && !railOnly
  const siteColumnShowsPanel = sidebarOpen && !panelFloating
  // What the column is listing. This names the content in the kicker under the
  // search field — NOT in the heading, which stays the workspace mode so it
  // can't change out from under the author just because they opened a tool.
  const activePanelLabel = effectivePluginPanelId !== null
    ? 'Plugin panel'
    : effectiveActivePanel === 'explorer'
      ? EXPLORER_TAB_LABELS[explorerTab]
      : effectiveActivePanel
        ? PANEL_RESIZE_LABELS[effectiveActivePanel]
        : null
  const activePanelSearch = effectiveActivePanel === 'explorer' && effectivePluginPanelId === null
    ? EXPLORER_TAB_SEARCH[explorerTab] ?? null
    : null
  // The AI panel is a conversation with a composer pinned to its foot — it
  // wants every pixel of the column's height. The mode's own controls step
  // aside while it is open rather than squeezing the transcript.
  const toolNeedsFullColumn = effectiveActivePanel === 'agent'

  const style = {
    '--left-sidebar-panel-width': `${isSiteColumn ? 0 : panelWidth}px`,
    '--left-sidebar-panel-layout-width': `${isSiteColumn ? 0 : (panelExpanded ? leftSidebarWidth : 0)}px`,
  } as CSSProperties

  return (
    <aside
      ref={sidebarRef}
      className={styles.sidebar}
      data-testid="left-sidebar"
      data-workspace={workspace}
      data-expanded={panelExpanded ? 'true' : 'false'}
      data-rail-only={railOnly ? 'true' : undefined}
      data-active-panel={effectivePluginPanelId !== null
        ? `plugin:${effectivePluginPanelId}`
        : effectiveActivePanel ?? 'none'}
      style={style}
    >
      {/* ONE column, not two. The Site workspace's left column shows the Page
          outline by default and swaps its body for whichever panel the Explorer
          disclosure selects (Layers, Layouts, Code, Media, Framework, …).
          The disclosure itself stays pinned at the foot, so the switcher is
          always reachable whatever is showing above it.

          Other workspaces (Content / Media) have no page tree to outline, so
          they keep the bare panel slot and their own icon rail. */}
      <FrameworkChangeConfirmProvider>
      <VCDeletionConfirmProvider>
        <SiteColumn
          enabled={isSiteColumn}
          mode={siteMode}
          showsPanel={siteColumnShowsPanel}
          toolLabel={activePanelLabel}
          toolSearchPlaceholder={activePanelSearch}
          toolNeedsFullColumn={toolNeedsFullColumn}
        >
        <div
          ref={panelFloating ? setPanelRef : undefined}
          className={cn(
            styles.panelSlot,
            panelFloating && styles.panelSlotFloating,
            // Inside the Site column the slot is a normal flex child that fills
            // the space above the disclosure, not an absolutely-positioned
            // second column beside the outline.
            isSiteColumn && !panelFloating && styles.panelSlotInColumn,
          )}
          data-testid="left-sidebar-panel-slot"
          data-mode={leftSidebarMode}
          hidden={isSiteColumn && !panelFloating && !siteColumnShowsPanel}
          inert={panelVisible ? undefined : true}
          style={panelFloating ? { ...panelPositionStyle, ...panelSizeStyle } : undefined}
        >
          {/* Read-only-safe panels — always rendered for any role with
              `site.read`. These are navigation/inspection surfaces, not
              editing tools; each respects its own read-only state internally
              (e.g. TreeNode disables drag + context menu via `editable`). */}
          <div className={styles.panelMount} hidden={effectiveActivePanel !== 'explorer'}>
            <ExplorerPanel editable={editable} {...dockablePanelProps} />
          </div>
          {/* Editor-only panels — only mounted when the caller can perform
              structural edits. Mounting them for non-editors would expose
              actions (style edits, framework token changes, plugin panels)
              they have no capability to commit. */}
          {editable && (
            <>
              <div className={styles.panelMount} hidden={effectiveActivePanel !== 'selectors'}>
                <SelectorsPanel {...dockablePanelProps} />
              </div>
              <div className={styles.panelMount} hidden={effectiveActivePanel !== 'framework'}>
                <FrameworkPanel {...dockablePanelProps} />
              </div>
              <div className={styles.panelMount} hidden={effectiveActivePanel !== 'dependencies'}>
                <DependenciesPanel {...dockablePanelProps} />
              </div>
              {/* Kept MOUNTED (hidden, not unmounted) like its neighbours so a
                  half-typed prompt and the streaming conversation survive
                  switching to Layers and back. */}
              {canUseAiChat && (
                <div className={styles.panelMount} hidden={effectiveActivePanel !== 'agent'}>
                  {/* eslint-disable-next-line react-compiler/react-compiler */}
                  <AgentStoreProvider store={useEditorStore}>
                    <Suspense fallback={null}>
                      <AgentPanel variant="docked" />
                    </Suspense>
                  </AgentStoreProvider>
                </div>
              )}
              {effectivePluginPanelId !== null && (
                <div
                  className={styles.panelMount}
                  data-testid="left-sidebar-plugin-panel-mount"
                >
                  <PluginEditorPanel
                    panelId={effectivePluginPanelId}
                    {...dockablePanelProps}
                  />
                </div>
              )}
            </>
          )}
          {panelFloating && (
            <PanelResizeHandle
              panelLabel={panelResizeLabel}
              resizeHandleProps={resizeHandleProps}
            />
          )}
        </div>
        </SiteColumn>
      </VCDeletionConfirmProvider>
      </FrameworkChangeConfirmProvider>

      {/* The Site column is always resizable — it is always showing something
          (the outline, or a panel), unlike the other workspaces where the
          handle only makes sense while a panel is open. Dragging writes
          `--site-left-track` so the column, the workspace toolbar's grid and
          the panel slot all move together off one variable. */}
      {isSiteColumn ? (
        <SidebarResizeHandle
          side="left"
          width={leftSidebarWidth}
          targetRef={sidebarRef}
          cssVariable="--site-left-track"
          layoutCssVariable="--site-left-track"
          ariaLabel="Resize left sidebar"
          onResize={setLeftSidebarWidth}
        />
      ) : panelExpanded && (
        <SidebarResizeHandle
          side="left"
          width={leftSidebarWidth}
          targetRef={sidebarRef}
          cssVariable="--left-sidebar-panel-width"
          layoutCssVariable="--left-sidebar-panel-layout-width"
          ariaLabel="Resize left sidebar"
          onResize={setLeftSidebarWidth}
        />
      )}
    </aside>
  )
}

/**
 * The Site workspace's single left column.
 *
 * Wraps the panel mounts in `PageOutlinePanel` so a switched-to panel renders
 * IN PLACE of the outline list — same column, same heading, same disclosure
 * below. Other workspaces render the mounts bare, beside their own icon rail.
 */
function SiteColumn({
  enabled,
  mode,
  showsPanel,
  toolLabel,
  toolSearchPlaceholder,
  toolNeedsFullColumn,
  children,
}: {
  enabled: boolean
  mode: SiteWorkspaceMode
  showsPanel: boolean
  toolLabel: string | null
  toolSearchPlaceholder: string | null
  toolNeedsFullColumn: boolean
  children: ReactNode
}) {
  if (!enabled) return children
  return (
    <PageOutlinePanel
      mode={mode}
      hidden={showsPanel}
      toolLabel={toolLabel}
      toolSearchPlaceholder={toolSearchPlaceholder}
      toolNeedsFullColumn={toolNeedsFullColumn}
    >
      {children}
    </PageOutlinePanel>
  )
}

function canShowBuiltInPanel(
  panel: LeftSidebarPanelId,
  editable: boolean,
  canUseAiChat: boolean,
): boolean {
  if (panel === 'agent') return canUseAiChat
  return editable || READ_ONLY_RAIL_IDS.has(panel)
}
