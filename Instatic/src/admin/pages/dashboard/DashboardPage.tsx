/**
 * DashboardPage — `/cms/dashboard`.
 *
 * The admin home. Renders:
 *   • A page header with a personal greeting + Publish / Customize / New
 *     page actions.
 *   • The setup onboarding panel (wired to live CMS state via
 *     `useOnboardingState`). Per-user dismissed / collapsed in
 *     localStorage.
 *   • A configurable widget grid (12 columns). Customize mode shows drag
 *     handles + resize handles per widget + the bottom Block library.
 *
 * Widgets come from `dashboardWidgetRegistry` — first-party widgets are
 * registered on mount via `registerFirstPartyDashboardWidgets`; plugins
 * that hold the `dashboard.widgets.register` permission contribute
 * additional widgets through the SDK.
 *
 * Drag-and-drop topology
 * ----------------------
 * The page owns the `DndContext` so two sibling DnD surfaces can share
 * the same dnd-kit session:
 *
 *   1. The dashboard grid registers itself as a single droppable
 *      (`GRID_DROP_ID`); every grid cell that is `useDraggable` becomes
 *      a "move" source.
 *   2. The bottom-docked `BlockLibrary` registers each preview tile as
 *      `useDraggable` with id `library:<widgetId>` — a separate source
 *      class that the page-level `onDragEnd` distinguishes from the
 *      regular cell-move case.
 *
 * On drag end the page snaps the dragged element's translated bounding
 * rect to the nearest grid cell and either calls `moveWidget(id, col, row)`
 * (for in-grid moves) or `addWidget(id, size, rows, col, row)` (for
 * library drops).
 *
 * Routes into the editor through the existing soft-nav helpers so the
 * Site editor's heavy bundle doesn't load on the dashboard.
 */
import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { createPortal } from 'react-dom'
import { FaIcon } from '@ui/components/FaIcon'
import { AdminPageLayout } from '@admin/layouts/AdminPageLayout'
import { useAdminUi } from '@admin/state/adminUi'
import { useAdminNavigate } from '@admin/lib/useAdminNavigate'
import { Button } from '@ui/components/Button'
import { ContextMenu, ContextMenuItem } from '@ui/components/ContextMenu'
import { FloatingActionBar } from '@ui/components/FloatingActionBar'
import { WidgetSkeleton } from '@ui/components/Widget'
import { cn } from '@ui/cn'
import type { DashboardWidgetDefinition } from '@core/dashboard'
import {
  GRID_DROP_ID,
  GRID_ROW_HEIGHT,
  MAX_COLS,
  hasOverlapAt,
  isDefaultDashboardLayout,
  readDashboardGridGap,
  RETIRED_WIDGET_IDS,
  snapToCell,
  useDashboardLayout,
  type DashboardItem,
} from './hooks/useDashboardLayout'
import { useDashboardWidgets } from './hooks/useDashboardWidgets'
import { registerFirstPartyDashboardWidgets } from './widgets'
import {
  BlockLibrary,
  LIBRARY_DRAG_PREFIX,
  LIBRARY_DROP_ID,
} from './components/BlockLibrary'
import { DashboardGrid } from './components/DashboardGrid'
import { RemoveBlockDialog } from './components/RemoveBlockDialog'
import { getCmsPublishStatus } from '@core/persistence'
import styles from './DashboardPage.module.css'
import gridStyles from './components/DashboardGrid.module.css'

// Register first-party widgets at module import. Idempotent so successive
// imports during fast-refresh / lazy reloads are cheap. The plugin icon
// resolver is bound earlier — at admin boot, from
// `useInstalledEditorPlugins.ts` — so plugin widgets registered at boot
// already have an icon mapping by the time their `activate()` runs.
registerFirstPartyDashboardWidgets()

/** Default rows used when the library drops a new widget. Matches the
 *  preview tile's row count in `BlockLibrary.tsx`. */
const ADD_DEFAULT_ROWS = 3

/**
 * Distance from the bottom-pill at which the DragOverlay starts shrinking.
 * Picked so the user sees the pill emerge from under the tile a comfortable
 * scroll's worth of pixels before reaching it — fast pointer motions still
 * arrive at the pill already mostly-shrunken.
 */
const PROXIMITY_FADE_START_PX = 260

/**
 * Final scale applied to the DragOverlay when the dragged tile is directly
 * on top of the pill. Small enough that the pill is fully visible behind
 * the floating widget; large enough that the user still recognises what
 * they're dragging.
 */
const PROXIMITY_MIN_SCALE = 0.32

/**
 * Vertical footprint of the bottom pill in CSS pixels (matches
 * `BlockLibrary.module.css`: `bottom: 28px; height: 44px`). The proximity
 * math measures the distance from the dragged tile's bottom edge to the
 * pill's top edge, which is `window.innerHeight - PILL_FOOTPRINT_PX`.
 */
const PILL_FOOTPRINT_PX = 72

/** "Last published <date>" from the real publish status, or a plain fallback. */
function formatLastPublished(iso: string | undefined): string {
  if (!iso) return 'Not published yet'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Not published yet'
  return `Last published ${date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`
}

export function DashboardPage() {
  const navigate = useAdminNavigate()
  const siteName = useAdminUi((s) => s.siteName)

  // Real publish state for the header pills (Site is live / Changes ready /
  // Last published) — no fabricated data.
  const [publishStatus, setPublishStatus] = useState<
    Awaited<ReturnType<typeof getCmsPublishStatus>> | null
  >(null)
  useEffect(() => {
    let cancelled = false
    void getCmsPublishStatus()
      .then((status) => { if (!cancelled) setPublishStatus(status) })
      .catch((err) => { console.error('[dashboard] publish status load failed:', err) })
    return () => { cancelled = true }
  }, [])
  const widgets = useDashboardWidgets()
  const layoutApi = useDashboardLayout()
  const {
    layout,
    addWidget,
    moveWidget,
    removeWidget,
    resize,
    resizeRows,
    setLibraryHeight,
  } = layoutApi

  const [editing, setEditing] = useState(false)
  const [libraryOpen, setLibraryOpenRaw] = useState(false)
  // Secondary "dashboard options" overflow — keeps Customize + Add block out of
  // the header's primary action row so "New page" reads as the single primary
  // job (audit P2-#6). Once customize mode is on, the FloatingActionBar takes
  // over with its own Add block + Done controls.
  const [deskMenuOpen, setDeskMenuOpen] = useState(false)
  const deskMenuRef = useRef<HTMLButtonElement | null>(null)

  /**
   * Tile awaiting removal confirmation. Customize mode gives every tile a
   * remove button; because that is one click from dropping an arrangement
   * the user may have built deliberately, it routes through
   * `<RemoveBlockDialog>` (type-to-confirm) rather than removing outright.
   * `null` when no dialog is open.
   */
  const [pendingRemoval, setPendingRemoval] = useState<
    { id: string; name: string } | null
  >(null)

  // Close the overflow menu when the page scrolls. The shared ContextMenu
  // otherwise stays glued to its trigger and reprojects on scroll, so it
  // reads as "stuck" following the header. Native dropdowns dismiss on
  // outside scroll instead — capture phase catches a scroll on any nested
  // scroller (the dashboard body), and the 2-item menu never scrolls itself.
  useEffect(() => {
    if (!deskMenuOpen) return
    const close = () => setDeskMenuOpen(false)
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [deskMenuOpen])

  // Deferred mount of non-critical dashboard children — drag-and-drop
  // surfaces (BlockLibrary, DragOverlay), the FloatingActionBar, and the
  // OnboardingPanel. None of them are visible on the first paint of a
  // returning user's dashboard (BlockLibrary is bottom-docked + hidden
  // until the user opens it; DragOverlay only renders during a drag;
  // FloatingActionBar requires customize mode; OnboardingPanel is
  // dismissed once and forgotten by most users), but their initial
  // construction is the heaviest part of DashboardPage's reconciliation
  // pass. Keeping them off the first render trims ~250 ms from the React
  // commit + layout / paint cycle on cold load.
  //
  // We flip `mounted` in a `useEffect` (which fires after first paint)
  // gated by `requestAnimationFrame` so the post-paint render lands on
  // the very next frame. The fallback `setTimeout(0)` covers browsers
  // without `rAF` (none of the targets in 2026 — the fallback only fires
  // in tests / SSR).
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const w = window as unknown as { requestAnimationFrame?: (cb: () => void) => number }
    if (typeof w.requestAnimationFrame === 'function') {
      const handle = w.requestAnimationFrame(() => setMounted(true))
      return () => cancelAnimationFrame(handle)
    }
    const id = setTimeout(() => setMounted(true), 0)
    return () => clearTimeout(id)
  }, [])


  /**
   * Opening the block library forces customize mode on. Without that
   * the grid stays at its compact 1px-gap layout with no extra drop
   * zone below the last widget — and dragging a library tile onto an
   * already-full grid has nowhere to land. Customize mode widens the
   * gutter to 16px and extends the grid surface by
   * `CUSTOMIZE_DROPZONE_ROWS` empty rows, which is exactly the
   * affordance the user needs for drop targeting. Closing the library
   * does NOT auto-exit customize mode — the user clicks Done when
   * they're satisfied with their arrangement.
   */
  function setLibraryOpen(next: boolean) {
    setLibraryOpenRaw(next)
    if (next) setEditing(true)
  }

  // Drag tracking — the active id tells `DragOverlay` what to render
  // (an existing grid cell or a library preview). The grid ref is read
  // during `onDragEnd` to compute the snap-to-cell math.
  const [activeId, setActiveId] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)

  /**
   * Live drop-target preview — set on every `onDragMove` tick to the
   * cell the widget WOULD land in if released now, AND its pixel
   * footprint within the grid (so the placeholder ghost renders with
   * `position: absolute` and CSS-animates smoothly between cells via
   * top/left/width/height transitions). `null` whenever no drag is
   * active, the pointer isn't over the grid surface, OR the proposed
   * destination overlaps an existing widget — drops are now strictly
   * "into empty space", so a hidden ghost is the visual signal that
   * the current target is invalid.
   */
  const [dropTarget, setDropTarget] = useState<
    | {
        col: number
        row: number
        size: number
        rows: number
        leftPx: number
        topPx: number
        widthPx: number
        heightPx: number
      }
    | null
  >(null)

  /**
   * Proximity scale for the DragOverlay child — drops the dragged tile
   * down to a smaller footprint as it approaches the bottom-docked
   * "drop to remove" pill. Without this the full-size overlay completely
   * covers the pill and the user can't see where they're aiming. The
   * value is recomputed on every `onDragMove` tick from the dragged
   * element's bottom edge versus the pill's top edge:
   *
   *   distance ≥ PROXIMITY_FADE_START  → scale = 1   (no effect)
   *   distance ≤ 0 (overlapping)       → scale = PROXIMITY_MIN_SCALE
   *   in-between                       → linear interpolation
   *
   * The overlay child shrinks uniformly around its cursor anchor (origin
   * stays `center center`), so the pill emerges from underneath the tile
   * as it gets smaller. Resets to 1 on drag end / cancel.
   */
  const [proximityScale, setProximityScale] = useState(1)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  // Bridge the registry array into a stable Map keyed by id for O(1)
  // lookups inside the grid + library.
  const definitionsById = (() => {
    const map = new Map<string, typeof widgets[number]>()
    for (const w of widgets) map.set(w.id, w)
    return map
  })()

  // KEEP layout entries whose widget definition isn't yet registered.
  // The grid now renders a `<WidgetSkeleton>` placeholder for those
  // slots so the layout reads as "loading" from first paint instead
  // of empty holes that snap into a widget once the plugin activates.
  //
  // Plugin widgets register asynchronously after mount (the activate()
  // hook fires once `useInstalledEditorPlugins` finishes loading each
  // editor entrypoint) — keeping the slot in the grid means the
  // skeleton placeholder reserves the exact `col / row / size / rows`
  // footprint until the real widget swaps in, with zero layout shift.
  //
  // We deliberately do NOT prune the layout on mount; the layout
  // legitimately contains ids the registry hasn't caught up to yet.
  // Removals from the persisted layout only happen when the user
  // explicitly drops a tile via the customize-mode kebab menu.
  // `layout.items` IS the visible set — the layout legitimately keeps ids the
  // registry hasn't caught up to yet (plugin widgets register after mount), and
  // the grid renders a skeleton for those slots rather than pruning them. No
  // memo needed: this is a plain alias, not a derived array.
  const visibleItems = layout.items

  /**
   * One-copy model: the library only shows widgets that are NOT already
   * on the dashboard. The filter is computed here (not inside
   * `BlockLibrary`) so the parent's single source of truth — `layout.items`
   * intersected with the registry — drives both the grid contents AND
   * the available list. Adding a widget moves it from the library to the
   * dashboard; dragging it back drops it from the dashboard and the
   * widget reappears in the library on the next render.
   */
  const availableWidgets = (() => {
    const active = new Set(layout.items.map((i) => i.id))
    return widgets.filter((w) => !active.has(w.id) && !RETIRED_WIDGET_IDS.has(w.id))
  })()

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
    setDropTarget(null)
    setProximityScale(1)
  }

  /**
   * Compute the proximity scale for the DragOverlay child based on the
   * dragged element's bottom edge versus the bottom pill's top edge.
   * Returns 1 when the drag is far from the pill, and ramps down to
   * `PROXIMITY_MIN_SCALE` as the tile overlaps the pill. Pure function
   * so the math is testable without standing up a DnD harness.
   */
  function computeProximityScale(draggedBottomY: number, viewportHeight: number): number {
    const pillTopY = viewportHeight - PILL_FOOTPRINT_PX
    const distance = pillTopY - draggedBottomY
    if (distance >= PROXIMITY_FADE_START_PX) return 1
    if (distance <= 0) return PROXIMITY_MIN_SCALE
    const t = distance / PROXIMITY_FADE_START_PX
    return PROXIMITY_MIN_SCALE + (1 - PROXIMITY_MIN_SCALE) * t
  }

  /**
   * Pick the widget size (column span × row span) the placeholder should
   * use for the active drag. Library-sourced drags use the widget's
   * `defaultSize` and the standard `ADD_DEFAULT_ROWS`; grid-sourced
   * drags mirror the existing tile's current size + rows so the preview
   * lines up 1:1 with the dragged tile.
   */
  function resolveDragFootprint(
    rawId: string,
  ): { size: number; rows: number } | null {
    if (rawId.startsWith(LIBRARY_DRAG_PREFIX)) {
      const widgetId = rawId.slice(LIBRARY_DRAG_PREFIX.length)
      const def = definitionsById.get(widgetId)
      if (!def) return null
      return { size: def.defaultSize, rows: ADD_DEFAULT_ROWS }
    }
    const item = visibleItems.find((i) => i.id === rawId)
    if (!item) return null
    return { size: item.size, rows: item.rows }
  }

  /**
   * Resolve the precise cell the active drag will land in if released
   * now, including pixel coordinates for the placeholder ghost. Called
   * by BOTH `onDragMove` (to update the live preview) and `onDragEnd`
   * (to commit the drop) so the preview and the actual landing
   * position are always identical — no chance of the ghost showing one
   * cell while the drop math picks another.
   *
   * Behaviour when the cursor is over an occupied cell: scan DOWN
   * within the same column until the first empty row that fits the
   * widget. This means the preview never disappears just because the
   * pointer wandered over an existing tile — it shifts to the nearest
   * empty space below, which is exactly where the drop will land. The
   * grid auto-extends to receive the widget thanks to the
   * `CUSTOMIZE_DROPZONE_ROWS` min-height.
   *
   * Returns `null` only when the drag couldn't be resolved at all (e.g.
   * pointer hasn't entered the grid yet) — that's the one case where
   * the preview is hidden and the drop is rejected.
   */
  function resolveDropTarget(
    rawId: string,
    grid: HTMLElement,
    draggedRect: { left: number; top: number },
    overGrid: boolean,
  ): NonNullable<typeof dropTarget> | null {
    if (!overGrid) return null
    const footprint = resolveDragFootprint(rawId)
    if (!footprint) return null
    const gridRect = grid.getBoundingClientRect()
    const gridGap = readDashboardGridGap(grid)
    const offsetX = draggedRect.left - gridRect.left
    const offsetY = draggedRect.top - gridRect.top
    const { col, row: cursorRow } = snapToCell(
      offsetX,
      offsetY,
      gridRect.width,
      footprint.size,
      gridGap,
    )
    const excludeId = rawId.startsWith(LIBRARY_DRAG_PREFIX) ? null : rawId

    // Walk down from the cursor's snapped row until we hit empty space.
    // 200 is a defensive cap — the grid never gets that tall in practice
    // and we don't want a pathological layout to spin the loop forever.
    let row = cursorRow
    const MAX_SCAN_ROWS = 200
    while (row < MAX_SCAN_ROWS) {
      const proposed = { col, row, size: footprint.size, rows: footprint.rows }
      if (!hasOverlapAt(visibleItems, proposed, excludeId)) break
      row++
    }
    if (row >= MAX_SCAN_ROWS) return null

    // Compute pixel coords for the placeholder ghost. CSS transitions
    // on `top`/`left`/`width`/`height` give the smooth glide between
    // cells (CSS Grid's integer placement isn't transitionable).
    const colWidth = (gridRect.width - (MAX_COLS - 1) * gridGap) / MAX_COLS
    return {
      col,
      row,
      size: footprint.size,
      rows: footprint.rows,
      leftPx: (col - 1) * (colWidth + gridGap),
      topPx: (row - 1) * (GRID_ROW_HEIGHT + gridGap),
      widthPx: footprint.size * colWidth + (footprint.size - 1) * gridGap,
      heightPx: footprint.rows * GRID_ROW_HEIGHT + (footprint.rows - 1) * gridGap,
    }
  }

  function handleDragMove(event: DragMoveEvent) {
    const grid = gridRef.current
    const draggedRect = event.active.rect.current.translated
    if (!grid || !draggedRect) {
      setDropTarget(null)
      setProximityScale(1)
      return
    }
    const overGrid = event.over?.id === GRID_DROP_ID
    const next = resolveDropTarget(
      String(event.active.id),
      grid,
      draggedRect,
      overGrid,
    )
    setDropTarget((prev) => {
      // Avoid React re-renders when nothing actually changed (the
      // pointer moved within the same cell). React would otherwise
      // re-render at 60Hz during the entire drag, which is wasted
      // work for an identical preview position.
      if (next === null) return prev === null ? prev : null
      if (
        prev !== null &&
        prev.col === next.col &&
        prev.row === next.row &&
        prev.size === next.size &&
        prev.rows === next.rows
      ) {
        return prev
      }
      return next
    })

    // Update the proximity scale on every move tick. The DragOverlay
    // child reads this through inline `transform: scale(...)` so the
    // shrink animation runs in CSS (smooth, GPU-composited) rather
    // than re-mounting the overlay subtree.
    const nextScale = computeProximityScale(draggedRect.bottom, window.innerHeight)
    setProximityScale((prev) => {
      // Skip React updates within a few hundredths — the visual
      // change is imperceptible and avoids a 60Hz re-render storm.
      if (Math.abs(prev - nextScale) < 0.01) return prev
      return nextScale
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const rawId = String(event.active.id)
    setActiveId(null)
    setDropTarget(null)
    setProximityScale(1)
    const grid = gridRef.current
    const draggedRect = event.active.rect.current.translated
    if (!grid || !draggedRect) return

    const overId = event.over?.id
    const overGrid = overId === GRID_DROP_ID
    const overLibrary = overId === LIBRARY_DROP_ID
    // ── Grid → library: remove (only valid for a grid-sourced drag). ─
    if (!rawId.startsWith(LIBRARY_DRAG_PREFIX) && overLibrary) {
      const item = visibleItems.find((i) => i.id === rawId)
      if (!item) return
      removeWidget(rawId)
      return
    }

    // For every other case the destination is whatever
    // `resolveDropTarget` would have computed for the preview — same
    // helper, same inputs, so preview and commit can't disagree.
    const target = resolveDropTarget(rawId, grid, draggedRect, overGrid)
    if (!target) return

    if (rawId.startsWith(LIBRARY_DRAG_PREFIX)) {
      const widgetId = rawId.slice(LIBRARY_DRAG_PREFIX.length)
      // Defensive: `availableWidgets` already filters out everything on
      // the grid, so the library shouldn't expose dupes — but guard
      // anyway in case a plugin re-registers the same id mid-drag.
      if (layout.items.some((i) => i.id === widgetId)) return
      addWidget(widgetId, target.size, target.rows, target.col, target.row)
      return
    }

    // Grid → grid move.
    moveWidget(rawId, target.col, target.row)
  }

  /**
   * The default view renders the approved release-desk structure rather
   * than the 12-column customize grid. As soon as the user touches the
   * layout (or opens customize mode) we hand over to the draggable grid.
   */
  const showReleaseDesk = !editing && isDefaultDashboardLayout(layout.items)

  /**
   * Render one release-desk tile at its fixed span. Falls back to the
   * skeleton chrome while a definition is still registering, so the desk
   * never paints an empty hole.
   */
  function renderDeskWidget(id: string, span: number) {
    const def = definitionsById.get(id)
    if (!def) return <WidgetSkeleton widgetId={id} span={span} />
    const Render = def.render
    return <Render span={span} editing={false} />
  }

  // The DragOverlay renders a portal-rooted visual at the pointer. We
  // resolve which kind of source is active (existing cell vs. library
  // preview) so the overlay reads as the same tile the user picked up,
  // and pass the proximity scale so the tile shrinks toward the bottom
  // pill as the drop-to-remove gesture approaches commit.
  const overlayContent = renderOverlay(activeId, visibleItems, definitionsById, proximityScale)

  return (
    <AdminPageLayout workspace="dashboard" mode="dashboard">
      {/* Live Release Desk header — site name + real publish-state pills, then
          the actions. (Customize + Add block stay reachable for the grid.) */}
      <header className={styles.desk}>
        <div className={styles.deskLead}>
          <h1 className={styles.deskTitle}>{siteName ?? 'Dashboard'}</h1>
          <div className={styles.deskStatus}>
            <span
              className={cn(
                styles.pill,
                publishStatus?.hasPublishedVersion ? styles.pillLive : styles.pillMuted,
              )}
            >
              <FaIcon name="circle" size={8} className={styles.pillDot} />
              {publishStatus?.hasPublishedVersion ? 'Site is live' : 'Not published'}
            </span>
            {publishStatus && !publishStatus.draftMatchesPublished && (
              <span className={cn(styles.pill, styles.pillChanges)}>
                <FaIcon name="circle" size={8} className={styles.pillDot} />
                Changes ready
              </span>
            )}
            <span className={styles.deskDivider} aria-hidden="true">·</span>
            <span className={styles.deskMeta}>
              {formatLastPublished(publishStatus?.lastPublishedAt)}
            </span>
          </div>
        </div>
        <div className={styles.deskActions}>
          {/* Green OUTLINE, not a filled CTA — in the approved screen the only
              filled green button is the release card's primary action. */}
          <Button
            variant="ghost"
            className={styles.newPageButton}
            onClick={() => navigate('/cms/site')}
          >
            <FaIcon name="plus" size={14} /> New page
          </Button>
          <Button
            ref={deskMenuRef}
            variant="ghost"
            iconOnly
            className={styles.overflowButton}
            aria-label="Dashboard options"
            aria-haspopup="menu"
            aria-expanded={deskMenuOpen}
            active={deskMenuOpen}
            onClick={() => setDeskMenuOpen((v) => !v)}
          >
            <FaIcon name="ellipsis" size={17} />
          </Button>
          {deskMenuOpen && typeof document !== 'undefined' && createPortal(
            <ContextMenu
              ariaLabel="Dashboard options"
              onClose={() => setDeskMenuOpen(false)}
              anchorRef={deskMenuRef}
              side="bottom"
              align="end"
              menuClassName={styles.deskMenu}
            >
              <ContextMenuItem
                className={styles.deskMenuItem}
                onClick={() => {
                  setDeskMenuOpen(false)
                  setEditing((v) => !v)
                }}
              >
                <FaIcon name="table-cells-large" size={14} />
                <span>{editing ? 'Exit customize' : 'Customize layout'}</span>
              </ContextMenuItem>
              <ContextMenuItem
                className={styles.deskMenuItem}
                onClick={() => {
                  setDeskMenuOpen(false)
                  setLibraryOpen(true)
                }}
              >
                <FaIcon name="plus" size={14} />
                <span>Add block</span>
              </ContextMenuItem>
            </ContextMenu>,
            document.body,
          )}
        </div>
      </header>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null)
          setDropTarget(null)
          setProximityScale(1)
        }}
        // Auto-scroll OFF: dnd-kit's default scrolls the window when the
        // pointer is within 20% of a viewport edge — which fires the
        // instant the user moves a tile toward the bottom-docked "drop
        // to remove" pill (the pill lives in that very band). The page
        // would slide down under the cursor while the user is trying to
        // aim at a stationary target, which the user flagged as a UX
        // bug. The dashboard surface fits comfortably on a normal
        // viewport, so disabling auto-scroll wholesale is a safe trade
        // — for the rare case of a very tall grid, the user can scroll
        // manually before initiating the drag.
        autoScroll={false}
      >
        {/* Two layout engines, exactly as the approved screen ships them:
            the fixed release desk while the layout is untouched, and the
            free 12-column grid once the user customises it or turns on
            customize mode. The desk's `1.82fr / minmax(340px, 1fr)` split
            is not expressible on a 12-column integer grid, which is why
            the reference keeps both. */}
        {showReleaseDesk ? (
          <div className={styles.deskGrid} aria-label="Release desk">
            <div className={styles.deskTop}>
              {renderDeskWidget('live-preview', 8)}
              {renderDeskWidget('release-progress', 4)}
            </div>
            <div className={styles.deskMiddle}>
              {renderDeskWidget('changes', 8)}
              {renderDeskWidget('preflight', 4)}
            </div>
            <div className={styles.deskActivity}>
              {renderDeskWidget('activity', 12)}
            </div>
          </div>
        ) : (
          <DashboardGrid
            items={visibleItems}
            definitions={definitionsById}
            editing={editing}
            onResize={resize}
            onResizeRows={resizeRows}
            onAddBlock={() => setLibraryOpen(true)}
            onRequestRemove={(id, name) => setPendingRemoval({ id, name })}
            gridRef={gridRef}
            dropTarget={dropTarget}
          />
        )}

        {/* Library — split internally into two surfaces:
            • Expanded panel: lifecycle tied to `panelOpen` only, with
              slide-up / slide-down animations via `useDelayedUnmount`.
              Hidden via CSS (no exit animation) while a drag is in
              progress so the pill can take its place.
            • Minimized pill: mounted only while a drag is active.
              Mounts with `pillIn` animation, unmounts instantly — no
              exit animation, so a grid-to-grid move doesn't flash a
              "library closing" animation for a library the user never
              opened.

            Gated behind `mounted` so this heavyweight subtree (577 LOC,
            multiple `useDelayedUnmount` instances, plenty of dnd-kit
            droppable/draggable hooks) is omitted from the first
            reconciliation pass. It mounts on the next animation frame
            via the effect above. */}
        {mounted && (
          <BlockLibrary
            panelOpen={libraryOpen}
            dragging={activeId !== null}
            draggingFromGrid={
              activeId !== null && !activeId.startsWith(LIBRARY_DRAG_PREFIX)
            }
            availableWidgets={availableWidgets}
            height={layout.libraryHeight}
            onHeightChange={setLibraryHeight}
            onAdd={(id, defaultSize) => addWidget(id, defaultSize)}
            onClose={() => setLibraryOpen(false)}
          />
        )}

        <DragOverlay>{overlayContent}</DragOverlay>
      </DndContext>

      {/* Floating customize-mode toolbar. Hidden whenever the library is
          visible in either mode — the expanded panel owns the "Add
          block" affordance, and the minimized pill owns the drag
          interaction. The floating bar only appears when neither is on
          screen (i.e., customize mode is on but the user hasn't opened
          the library and isn't currently dragging).

          Gated behind `mounted` — the toolbar starts at `open={false}`
          on first paint anyway (editing defaults to false), so the
          component would render nothing visible but still allocate its
          portal root + animation state. Deferring it spares the first
          reconciliation pass. */}
      {mounted && <FloatingActionBar
        open={editing && !libraryOpen && activeId === null}
        ariaLabel="Customize dashboard"
        className={styles.customizeBar}
        label={(
          <>
            <FaIcon name="grip" size={13} className={styles.customizeGrip} />
            <span><strong>Customize mode</strong> — drag, resize, or add blocks.</span>
          </>
        )}
      >
        <Button
          variant="ghost"
          className={styles.customizeAction}
          onClick={() => setLibraryOpen(true)}
        >
          <FaIcon name="plus" size={12} /> Add block
        </Button>
        <Button
          variant="ghost"
          className={cn(styles.customizeAction, styles.customizeActionDone)}
          onClick={() => setEditing(false)}
        >
          Done
        </Button>
      </FloatingActionBar>}

      <RemoveBlockDialog
        blockName={pendingRemoval?.name ?? null}
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          if (pendingRemoval) removeWidget(pendingRemoval.id)
          setPendingRemoval(null)
        }}
      />
    </AdminPageLayout>
  )
}

/**
 * Render the dnd-kit DragOverlay child for the currently active drag.
 *
 *   • Existing-grid moves get the real widget renderer in a cell-shaped
 *     wrapper (matches the original card's footprint via `--span` /
 *     `--rows`).
 *
 *   • Library drags get a sized preview tile with the same renderer at
 *     its default size, so the user sees what will land.
 *
 *   • `proximityScale` is fed through `--proximity-scale` (read by
 *     `.dragOverlay` in `DashboardGrid.module.css`). It rides on top of
 *     dnd-kit's own translate transform so the tile shrinks toward the
 *     bottom-pill without breaking the pointer-follow behaviour.
 */
function renderOverlay(
  activeId: string | null,
  items: readonly DashboardItem[],
  definitions: ReadonlyMap<string, DashboardWidgetDefinition>,
  proximityScale: number,
) {
  if (!activeId) return null

  if (activeId.startsWith(LIBRARY_DRAG_PREFIX)) {
    const widgetId = activeId.slice(LIBRARY_DRAG_PREFIX.length)
    const def = definitions.get(widgetId)
    if (!def) return null
    const Render = def.render
    // dnd-kit sizes the overlay portal to match the activator element
    // (the library item's `.itemSurface`, which is sized to the exact
    // destination cell dimensions). The inner card uses `100%` width /
    // height from `.dragOverlay`, so we don't need to compute pixel
    // dimensions here — the source measurements flow through
    // automatically.
    return (
      <div
        className={cn(gridStyles.cell, gridStyles.dragOverlay)}
        data-span={def.defaultSize}
        data-rows={ADD_DEFAULT_ROWS}
        style={{
          ['--span' as string]: String(def.defaultSize),
          ['--rows' as string]: String(ADD_DEFAULT_ROWS),
          ['--proximity-scale' as string]: String(proximityScale),
        }}
      >
        <Render span={def.defaultSize} editing />
      </div>
    )
  }

  const item = items.find((i) => i.id === activeId)
  if (!item) return null
  const def = definitions.get(activeId)
  if (!def) return null
  const Render = def.render
  return (
    <div
      className={cn(gridStyles.cell, gridStyles.dragOverlay)}
      data-span={item.size}
      data-rows={item.rows}
      style={{
        ['--span' as string]: String(item.size),
        ['--rows' as string]: String(item.rows),
        ['--proximity-scale' as string]: String(proximityScale),
      }}
    >
      <Render span={item.size} editing />
    </div>
  )
}
