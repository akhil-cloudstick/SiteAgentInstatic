/**
 * ExplorerDisclosure — the "Explorer" dropdown at the foot of the Page
 * outline, and the Site workspace's panel switcher.
 *
 * This replaces the vertical icon rail. The reference shows it collapsed to a
 * four-shortcut strip (Layers · Site · Code · Media) and expanded to the full
 * two-column tool grid, which is where the panels the rail used to hold now
 * live: Framework, Selectors, Dependencies, plus AI authoring and any panels
 * registered by plugins.
 *
 * Only the trigger changed. Every tile calls the same store action the rail
 * called — `setLeftSidebarPanel` for built-ins, `setActivePluginPanel` for
 * plugin panels, `setExplorerPanelTab` for the four Explorer tabs — so the
 * spotlight commands (`panels.showLayers`, `panels.toggleExplorer`, …) and the
 * persisted layout (`deriveSiteActiveLeftPanel`) keep resolving exactly as
 * before.
 *
 * Permission gating maps the reference's "agency / developer" tier onto the
 * real `EditorPermissions`: the navigation tools stay available to anyone who
 * can read the site, the structural/style tools require `canEditStyle`.
 */
import { useState, useSyncExternalStore } from 'react'
import { useEditorStore } from '@site/store/store'
import type { ExplorerPanelTab } from '@site/store/slices/uiSlice'
import type { LeftSidebarPanelId } from '@site/store/slices/uiSlice'
import { useEditorPermissions } from '@site/editorPermissionsContext'
import { pluginRuntime } from '@core/plugins/runtime'
import { resolvePluginPanelIcon } from '@site/sidebars/PanelRail/pluginPanelIcons'
import type { IconComponent } from 'pixel-art-icons/types'
import { FaIcon } from '@ui/components/FaIcon'
import { Button } from '@ui/components/Button'
import { cn } from '@ui/cn'
import styles from './ExplorerDisclosure.module.css'

/**
 * A tool tile. `target` says which store action opens it — the four Explorer
 * tabs share one panel, so they carry a tab instead of a panel id.
 */
type ToolTarget =
  | { kind: 'explorerTab'; tab: ExplorerPanelTab }
  | { kind: 'panel'; panel: LeftSidebarPanelId }
  | { kind: 'plugin'; pluginPanelId: string }

interface Tool {
  id: string
  label: string
  /** Font Awesome glyph — the reference's icon family for this surface. */
  icon: string
  /**
   * Plugin panels declare their own icon and are not part of the approved
   * screen, so they keep their registered `IconComponent` (Remix) rather than
   * being flattened to one generic FA glyph and losing their identity.
   */
  iconComponent?: IconComponent
  target: ToolTarget
  /** Structural/style tooling — hidden from callers who cannot edit style. */
  advanced?: boolean
}

function ToolGlyph({ tool, size }: { tool: Tool; size: number }) {
  if (tool.iconComponent) {
    const PluginIcon = tool.iconComponent
    return <PluginIcon size={size} aria-hidden="true" />
  }
  return <FaIcon name={tool.icon} size={size} />
}

/**
 * The four shortcuts the reference leaves visible when collapsed. They are the
 * Explorer panel's own tabs, which is why they read as one group.
 */
const SHORTCUT_TOOLS: readonly Tool[] = [
  { id: 'layers', label: 'Layers', icon: 'layer-group', target: { kind: 'explorerTab', tab: 'layers' } },
  { id: 'site', label: 'Layouts', icon: 'folder', target: { kind: 'explorerTab', tab: 'site' } },
  { id: 'code', label: 'Code', icon: 'code', target: { kind: 'explorerTab', tab: 'code' } },
  { id: 'media', label: 'Media', icon: 'image', target: { kind: 'explorerTab', tab: 'media' } },
]

/** The rest of the grid, revealed when the disclosure is open. */
const ADVANCED_TOOLS: readonly Tool[] = [
  { id: 'framework', label: 'Framework', icon: 'cubes-stacked', target: { kind: 'panel', panel: 'framework' }, advanced: true },
  { id: 'selectors', label: 'Selectors', icon: 'tags', target: { kind: 'panel', panel: 'selectors' }, advanced: true },
  { id: 'dependencies', label: 'Dependencies', icon: 'diagram-project', target: { kind: 'panel', panel: 'dependencies' }, advanced: true },
  { id: 'agent', label: 'AI authoring', icon: 'wand-magic-sparkles', target: { kind: 'panel', panel: 'agent' } },
]

const subscribePluginRuntime = (cb: () => void) => pluginRuntime.subscribe(cb)
const getPluginPanels = () => pluginRuntime.getPanels()
// Stable reference so useSyncExternalStore sees no server/client mismatch.
const SERVER_PLUGIN_PANELS: ReturnType<typeof getPluginPanels> = []

export function ExplorerDisclosure() {
  const explorerOpen = useEditorStore((s) => s.explorerPanelOpen)
  const explorerTab = useEditorStore((s) => s.explorerPanelTab)
  const activePluginPanelId = useEditorStore((s) => s.activePluginPanelId)
  const setLeftSidebarPanel = useEditorStore((s) => s.setLeftSidebarPanel)
  const setActivePluginPanel = useEditorStore((s) => s.setActivePluginPanel)
  const setExplorerPanelTab = useEditorStore((s) => s.setExplorerPanelTab)
  const selectorsOpen = useEditorStore((s) => s.selectorsPanelOpen)
  const frameworkOpen = useEditorStore((s) => s.frameworkPanelOpen)
  const dependenciesOpen = useEditorStore((s) => s.dependenciesPanelOpen)
  const agentOpen = useEditorStore((s) => s.isAgentOpen)
  const permissions = useEditorPermissions()

  const pluginPanels = useSyncExternalStore(
    subscribePluginRuntime,
    getPluginPanels,
    () => SERVER_PLUGIN_PANELS,
  )

  // The disclosure starts closed, matching the reference's default state. It is
  // local UI, not editor state — reopening the workspace should show the
  // guided outline first, not whatever tool was last poked.
  const [open, setOpen] = useState(false)

  const canUseAdvanced = permissions.canEditStyle
  const tools: Tool[] = [
    ...SHORTCUT_TOOLS,
    ...ADVANCED_TOOLS.filter((tool) => !tool.advanced || canUseAdvanced),
    ...(canUseAdvanced
      ? pluginPanels.map((panel): Tool => ({
          id: `plugin:${panel.id}`,
          label: panel.label,
          icon: 'puzzle-piece',
          iconComponent: resolvePluginPanelIcon(panel.iconName),
          target: { kind: 'plugin', pluginPanelId: panel.id },
        }))
      : []),
  ]

  function isActive(tool: Tool): boolean {
    switch (tool.target.kind) {
      case 'explorerTab':
        return explorerOpen && explorerTab === tool.target.tab
      case 'plugin':
        return activePluginPanelId === tool.target.pluginPanelId
      case 'panel':
        switch (tool.target.panel) {
          case 'selectors': return selectorsOpen
          case 'framework': return frameworkOpen
          case 'dependencies': return dependenciesOpen
          case 'agent': return agentOpen
          case 'explorer': return explorerOpen
        }
    }
  }

  function openTool(tool: Tool): void {
    // Picking a tool collapses the disclosure back to its four shortcuts. The
    // grid has done its job at that point, and leaving it open would push the
    // panel the user just asked for down behind a wall of tiles.
    setOpen(false)

    // Picking the tool that is ALREADY showing puts the column back on the Page
    // outline. In this column the hosted panels' own close buttons are hidden
    // (the column owns the chrome), so without this the outline — and with it
    // the mode's own controls, e.g. Review's Viewport context — is unreachable
    // once any tool has been opened.
    if (isActive(tool)) {
      if (tool.target.kind === 'plugin') setActivePluginPanel(null)
      else setLeftSidebarPanel(null)
      return
    }

    switch (tool.target.kind) {
      case 'explorerTab':
        setExplorerPanelTab(tool.target.tab)
        setLeftSidebarPanel('explorer')
        return
      case 'panel':
        setLeftSidebarPanel(tool.target.panel)
        return
      case 'plugin':
        setActivePluginPanel(tool.target.pluginPanelId)
    }
  }

  return (
    // The dock keeps the collapsed switcher's footprint in the column while the
    // block floats out of flow to expand — so opening the tool grid never
    // shifts the outline or Review's viewport rows (see `.dock`).
    <div className={styles.dock}>
    <div
      className={cn(styles.block, open && styles.blockOpen)}
      data-testid="explorer-disclosure"
    >
      <Button
        variant="ghost"
        size="lg"
        align="between"
        fullWidth
        className={styles.toggle}
        aria-expanded={open}
        data-testid="explorer-disclosure-toggle"
        onClick={() => setOpen((current) => !current)}
      >
        {/* One name in every mode. The reference renames this to "Advanced
            workspace" outside Live, which made the same control read as two
            different things depending on where you came from — and "Explorer"
            now names the Live heading button, which opens this same tool set. */}
        <span>Advanced options</span>
        {/* One chevron that rotates, rather than swapping two glyphs — a swap
            can't be tweened, which is what made this read as a hard snap. */}
        <FaIcon
          name="chevron-down"
          size={12}
          className={cn(styles.chevron, open && styles.chevronOpen)}
        />
      </Button>

      {/* Both states stay mounted so the height can ease between them; the
          hidden one is inert and out of the tab order. */}
      <div className={cn(styles.reveal, open && styles.revealOpen)}>
        <div className={styles.revealInner} inert={open ? undefined : true}>
        <div className={styles.grid}>
          {tools.map((tool) => (
            <Button
              key={tool.id}
              variant="secondary"
              size="lg"
              align="start"
              className={styles.tool}
              data-selected={isActive(tool) ? 'true' : undefined}
              data-testid={`explorer-tool-${tool.id}`}
              // The label clips to fit the tile, so the full name stays
              // reachable on hover.
              tooltip={isActive(tool) ? `${tool.label} — back to the outline` : tool.label}
              onClick={() => openTool(tool)}
            >
              <ToolGlyph tool={tool} size={14} />
              <span className={styles.toolLabel}>{tool.label}</span>
            </Button>
          ))}
        </div>
        </div>
      </div>

      <div className={cn(styles.reveal, !open && styles.revealOpen)}>
        <div className={styles.revealInner} inert={open ? true : undefined}>
        <div className={styles.shortcuts}>
          {SHORTCUT_TOOLS.map((tool) => (
            <Button
              key={tool.id}
              variant="ghost"
              size="lg"
              className={styles.shortcut}
              data-selected={isActive(tool) ? 'true' : undefined}
              data-testid={`explorer-shortcut-${tool.id}`}
              tooltip={isActive(tool) ? 'Back to the outline' : `Open ${tool.label}`}
              onClick={() => openTool(tool)}
            >
              <ToolGlyph tool={tool} size={13} />
              <span>{tool.label}</span>
            </Button>
          ))}
        </div>
        </div>
      </div>
    </div>
    </div>
  )
}
