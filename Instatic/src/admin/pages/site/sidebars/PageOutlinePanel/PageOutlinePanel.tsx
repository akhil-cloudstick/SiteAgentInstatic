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
import { Input } from '@ui/components/Input'
import { cn } from '@ui/cn'
import { SearchBar } from '@ui/components/SearchBar'
import { useBreakpointFrameWidth } from '@site/canvas/useBreakpointFrameWidth'
import { MAX_PREVIEW_FRAME_WIDTH, MIN_PREVIEW_FRAME_WIDTH } from '@site/canvas/math'
import { LayerNodeContextMenu } from '@site/panels/DomPanel/LayerNodeContextMenu'
import { ModuleInserterDialog } from '@site/module-picker/ModuleInserterDialog'
import { useInsertInserterItem } from '@site/hooks/useInsertInserterItem'
import { topLevelSectionIds, type SiteWorkspaceMode } from '@site/siteWorkspaceMode'
import { ExplorerDisclosure } from './ExplorerDisclosure'
import { SiteColumnContext } from './siteColumnContext'
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
  /**
   * What the switched-to panel lists — "Layers", "Layouts", "Code", "Media".
   * It names the content in the KICKER under the search field, never in the
   * heading: the heading says which mode you are in, and that must not change
   * out from under you just because you opened a different tool.
   */
  toolLabel?: string | null
  /**
   * Placeholder for the column's search field while that panel is showing, or
   * null when the panel has nothing to search — the field is then hidden
   * rather than left inert.
   */
  toolSearchPlaceholder?: string | null
  /**
   * True when the switched-to panel needs the column's whole height — the AI
   * assistant, whose transcript and composer fill it. The mode's own controls
   * (Review's Viewport context) step aside rather than squeezing the chat.
   */
  toolNeedsFullColumn?: boolean
  /** The switched-to panel itself, rendered in place of the outline list. */
  children?: ReactNode
}

export function PageOutlinePanel({
  mode,
  drawer = false,
  hidden = false,
  toolLabel = null,
  toolSearchPlaceholder = null,
  toolNeedsFullColumn = false,
  children,
}: PageOutlinePanelProps) {
  const page = useEditorStore(selectActiveCanvasPage)
  const visualComponents = useEditorStore((s) => s.site?.visualComponents)
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId)
  const selectNode = useEditorStore((s) => s.selectNode)
  const moveNodes = useEditorStore((s) => s.moveNodes)
  const breakpoints = useEditorStore((s) => s.site?.breakpoints ?? EMPTY_BREAKPOINTS)
  const permissions = useEditorPermissions()

  const [query, setQuery] = useState('')
  // Collapsed by default — see the block itself. Local UI, not editor state:
  // reopening the workspace should start from the quiet column.
  const [viewportContextOpen, setViewportContextOpen] = useState(false)
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

  // What the column is listing right now, and whether that content is
  // searchable. Showing the outline, the reference gives Live a field over
  // "Top-level layers" and leaves Focus/Review unfiltered — their lists are
  // short and every row is already on screen.
  // The AI panel draws its own "AI Assistant" title bar, so repeating the tool
  // name above it would be two headings for one thing — and that column needs
  // the row for the transcript.
  const kicker = hidden
    ? (toolNeedsFullColumn ? null : toolLabel)
    : mode === 'live' ? 'Top-level layers' : null
  const searchPlaceholder = hidden
    ? toolSearchPlaceholder
    : mode === 'live'
      ? 'Search sections…'
      : null

  /**
   * Reordering from the outline moves a section one place earlier — the
   * reference's grip is a nudge, not a drag surface (full drag-and-drop lives
   * in the Layers tree, which is one click away in the Explorer disclosure).
   * It goes through `moveNodes`, so it is one undo step like any other move.
   */
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
      {/* One header for the column, in every state. The heading names the MODE
          — it never becomes "Layers" — and its action is "Add section" while
          there is a page to add to (Live and Focus). Review is a read-across of
          breakpoints, so it offers no insert; nor does the AI panel, which owns
          the column and has its own header a row below. */}
      <div className={styles.heading}>
        <h2>{HEADINGS[mode]}</h2>
        {mode !== 'review' && !toolNeedsFullColumn && permissions.canEditStructure && (
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

      {/* One search field, whatever the column is showing: it filters the
          outline, and — through `SiteColumnContext` — whatever hosted panel is
          listing instead of it. The kicker under it is what names that content,
          the way the reference names the outline's own list. */}
      {searchPlaceholder && (
        <SearchBar
          className={styles.search}
          value={query}
          onValueChange={setQuery}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder.replace('…', '')}
          data-testid="site-column-search"
        />
      )}
      {kicker && <p className={styles.kicker}>{kicker}</p>}

      {/* The switched-to panel replaces the outline list IN PLACE — same
          column, same heading, same disclosure below. It is not an overlay:
          stacking a second panel on top of the menu is what produced the
          floating block over the sidebar. */}
      {hidden && (
        <div className={styles.toolRegion}>
          <SiteColumnContext.Provider value={{ query, setQuery }}>
            {children}
          </SiteColumnContext.Provider>
        </div>
      )}

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

      </div>

      {/* Review's own controls, like the heading above: they belong to the MODE,
          not to the outline list, so they stay put when Layers / Layouts / Code
          take the column. Inside the collapsing body they were invisible for as
          long as any tool was open — which, with the last-open panel restored
          from localStorage, is every session after the first. */}
      {mode === 'review' && !toolNeedsFullColumn && (
        <div className={styles.viewportContext}>
          {/* Collapsed by default: with the outline (or Layers) above it and the
              switcher below, three always-open rows made the column feel packed.
              One line until the author actually wants to retune a width. */}
          <Button
            variant="ghost"
            size="md"
            align="between"
            fullWidth
            className={styles.viewportToggle}
            aria-expanded={viewportContextOpen}
            data-testid="viewport-context-toggle"
            onClick={() => setViewportContextOpen((current) => !current)}
          >
            <span>Viewport context</span>
            <FaIcon
              name="chevron-down"
              size={12}
              className={cn(
                styles.viewportChevron,
                viewportContextOpen && styles.viewportChevronOpen,
              )}
            />
          </Button>
          {viewportContextOpen && (
            <>
              {/* Short enough to hold two lines in the column — the longer
                  reference wording ran to four and pushed the rows off. */}
              <p>Base styles apply everywhere. Others store only overrides.</p>
              {breakpoints.map((breakpoint) => (
                <ViewportContextRow
                  key={breakpoint.id}
                  breakpoint={breakpoint}
                  /* The reference marks the widest context as the base, because
                     that is the one whose styles apply everywhere. */
                  isBase={isBaseContext(breakpoints, breakpoint)}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Outside the collapsing body: the switcher must stay reachable while a
          panel occupies the column, otherwise you could switch away from the
          outline and have no way back. */}
      <ExplorerDisclosure />

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
 * One Review-mode viewport context: pick it, and try a width on it.
 *
 * The px field writes an EPHEMERAL preview width (`breakpointPreviewWidths` on
 * the canvas slice) — the Review frame redraws at that size immediately, but
 * the breakpoint itself, its media query and the published CSS are untouched,
 * and a reload restores the stored width. Changing the real width is the
 * "Edit viewport" dialog's job.
 *
 * The row is a grid rather than one big button because an `<input>` cannot live
 * inside a `<button>`; the reset column is always reserved so the row does not
 * reflow when an override appears.
 */
function ViewportContextRow({
  breakpoint,
  isBase,
}: { breakpoint: Breakpoint; isBase: boolean }) {
  const activeBreakpointId = useEditorStore((s) => s.activeBreakpointId)
  const setActiveBreakpoint = useEditorStore((s) => s.setActiveBreakpoint)
  const setPreviewWidth = useEditorStore((s) => s.setBreakpointPreviewWidth)
  const clearPreviewWidth = useEditorStore((s) => s.clearBreakpointPreviewWidth)
  const frameWidth = useBreakpointFrameWidth(breakpoint)

  // `null` means "not editing", so the field mirrors the store and reconciles to
  // an external change (a reset, a different site) for free.
  const [draft, setDraft] = useState<string | null>(null)

  const isActive = activeBreakpointId === breakpoint.id
  const isOverridden = frameWidth !== breakpoint.width
  const parsedDraft = draft === null ? null : Number(draft)
  const draftIsCommittable =
    parsedDraft !== null &&
    draft?.trim() !== '' &&
    Number.isFinite(parsedDraft) &&
    parsedDraft >= MIN_PREVIEW_FRAME_WIDTH &&
    parsedDraft <= MAX_PREVIEW_FRAME_WIDTH

  /**
   * Commit only a value that is ALREADY in range — never clamp mid-keystroke.
   * Typing toward 1200 passes through 1, 12 and 120; clamping those would snap
   * the frame to 240 and fight the author's next character.
   */
  function handleChange(raw: string): void {
    setDraft(raw)
    const next = Number(raw)
    if (
      raw.trim() !== '' &&
      Number.isFinite(next) &&
      next >= MIN_PREVIEW_FRAME_WIDTH &&
      next <= MAX_PREVIEW_FRAME_WIDTH
    ) {
      setPreviewWidth(breakpoint.id, next)
    }
  }

  // On the way out, an out-of-range number is worth honouring (the setter
  // clamps it); a blank or unparseable one is simply dropped and the field
  // snaps back to whatever the frame is actually drawn at.
  function commitDraft(): void {
    const next = draft === null ? NaN : Number(draft)
    if (draft?.trim() !== '' && Number.isFinite(next)) setPreviewWidth(breakpoint.id, next)
    setDraft(null)
  }

  return (
    <div
      className={styles.viewportRow}
      data-selected={isActive ? 'true' : undefined}
      data-testid={`viewport-context-${breakpoint.id}`}
    >
      <Button
        variant="ghost"
        size="lg"
        align="start"
        className={styles.viewportSelect}
        aria-pressed={isActive}
        onClick={() => setActiveBreakpoint(breakpoint.id)}
      >
        <FaIcon name={breakpoint.id === 'mobile' ? 'mobile-screen-button'
          : breakpoint.id === 'tablet' ? 'tablet-screen-button' : 'desktop'} size={14} />
        <span className={styles.viewportLabel} data-fidelity-dynamic="">
          {isBase ? 'Base · ' : ''}{breakpoint.label}
        </span>
      </Button>

      <Input
        className={styles.viewportWidth}
        data-fidelity-dynamic=""
        data-testid={`viewport-width-${breakpoint.id}`}
        type="number"
        inputMode="numeric"
        // The ▲▼ buttons would eat a third of the field in a 305px column, and
        // the row already carries a reset control.
        numberSpinner={false}
        unit="px"
        fieldSize="sm"
        min={MIN_PREVIEW_FRAME_WIDTH}
        max={MAX_PREVIEW_FRAME_WIDTH}
        invalid={draft !== null && draft.trim() !== '' && !draftIsCommittable}
        aria-label={`${breakpoint.label} preview width in pixels`}
        value={draft ?? String(frameWidth)}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
      />

      {isOverridden && (
        <Button
          variant="ghost"
          size="md"
          iconOnly
          className={styles.viewportReset}
          data-fidelity-dynamic=""
          data-testid={`viewport-width-reset-${breakpoint.id}`}
          aria-label={`Reset ${breakpoint.label} preview width to ${breakpoint.width} px`}
          tooltip={`Reset to ${breakpoint.width} px`}
          onClick={() => {
            clearPreviewWidth(breakpoint.id)
            setDraft(null)
          }}
        >
          <FaIcon name="arrow-rotate-left" size={12} />
        </Button>
      )}
    </div>
  )
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
