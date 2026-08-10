import { create } from 'zustand'
import {
  readWorkspaceLayout,
  workspaceFromPathname,
  type EditorWorkspaceId,
  type StoredWorkspaceLayout,
} from './workspaceLayoutStorage'

export const SIDEBAR_MIN_WIDTH = 300
export const SIDEBAR_MAX_WIDTH = 520
export const LEFT_SIDEBAR_DEFAULT_WIDTH = 320
export const RIGHT_SIDEBAR_DEFAULT_WIDTH = 360

/**
 * Per-workspace starting widths.
 *
 * These are DEFAULTS for a workspace that has never been resized — a stored
 * width always wins. The Data workspace is a pixel-match reproduction of the
 * approved MMSBUILD Data Workbench screen, which specifies a 300px table panel
 * and a 330px inspector; the other workspaces keep the generic admin widths.
 *
 * Kept as a lookup rather than by reassigning the shared constants above,
 * because those are read by Content and Media too — changing them would move
 * panels on screens this re-skin is not allowed to touch.
 */
const WORKSPACE_DEFAULT_WIDTHS: Partial<
  Record<EditorWorkspaceId, { left?: number; right?: number }>
> = {
  data: { left: 300, right: 330 },
}

function defaultLeftWidth(workspace: EditorWorkspaceId | null): number {
  if (workspace === null) return LEFT_SIDEBAR_DEFAULT_WIDTH
  return WORKSPACE_DEFAULT_WIDTHS[workspace]?.left ?? LEFT_SIDEBAR_DEFAULT_WIDTH
}

function defaultRightWidth(workspace: EditorWorkspaceId | null): number {
  if (workspace === null) return RIGHT_SIDEBAR_DEFAULT_WIDTH
  return WORKSPACE_DEFAULT_WIDTHS[workspace]?.right ?? RIGHT_SIDEBAR_DEFAULT_WIDTH
}

export interface WorkspacePanelState {
  collapsed: boolean
  width: number
}

interface WorkspaceLayoutState {
  leftSidebarWidth: number
  rightPanel: WorkspacePanelState
  dataSidebarCollapsed: boolean
  setLeftSidebarWidth: (width: number) => void
  setRightPanel: (patch: Partial<WorkspacePanelState>) => void
  setDataSidebarCollapsed: (collapsed: boolean) => void
  hydrateWorkspaceLayout: (
    workspace: EditorWorkspaceId,
    layout: StoredWorkspaceLayout,
  ) => void
}

function boolOrCurrent(value: unknown, current: boolean): boolean {
  return typeof value === 'boolean' ? value : current
}

function finiteNumberOrCurrent(value: unknown, current: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : current
}

export function clampSidebarWidth(width: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)))
}

function leftSidebarWidth(layout: StoredWorkspaceLayout, currentWidth: number): number {
  return clampSidebarWidth(finiteNumberOrCurrent(
    layout.leftWidth,
    currentWidth || LEFT_SIDEBAR_DEFAULT_WIDTH,
  ))
}

function rightPanelWidth(layout: StoredWorkspaceLayout, currentWidth: number): number {
  return finiteNumberOrCurrent(layout.rightWidth, currentWidth || RIGHT_SIDEBAR_DEFAULT_WIDTH)
}

function initialNonSiteLayout(): Pick<
  WorkspaceLayoutState,
  'leftSidebarWidth' | 'rightPanel' | 'dataSidebarCollapsed'
> {
  const workspace = typeof window !== 'undefined'
    ? workspaceFromPathname(window.location.pathname)
    : null
  const layout = workspace && workspace !== 'site'
    ? readWorkspaceLayout(workspace)
    : {}
  const rightOpen = boolOrCurrent(layout.rightOpen, true)
  const dataSidebarCollapsed = workspace === 'data' && typeof layout.leftOpen === 'boolean'
    ? !layout.leftOpen
    : false

  return {
    leftSidebarWidth: leftSidebarWidth(layout, defaultLeftWidth(workspace)),
    rightPanel: {
      collapsed: !rightOpen,
      width: rightPanelWidth(layout, defaultRightWidth(workspace)),
    },
    dataSidebarCollapsed,
  }
}

export const useWorkspaceLayout = create<WorkspaceLayoutState>((set, get) => ({
  ...initialNonSiteLayout(),

  setLeftSidebarWidth: (width) => {
    const nextWidth = clampSidebarWidth(width)
    if (Object.is(get().leftSidebarWidth, nextWidth)) return
    set({ leftSidebarWidth: nextWidth })
  },

  setRightPanel: (patch) => {
    const current = get().rightPanel
    const next: WorkspacePanelState = {
      ...current,
      ...patch,
      width: patch.width === undefined
        ? current.width
        : finiteNumberOrCurrent(patch.width, current.width),
    }
    if (
      Object.is(current.collapsed, next.collapsed) &&
      Object.is(current.width, next.width)
    ) {
      return
    }
    set({ rightPanel: next })
  },

  setDataSidebarCollapsed: (collapsed) => {
    if (Object.is(get().dataSidebarCollapsed, collapsed)) return
    set({ dataSidebarCollapsed: collapsed })
  },

  hydrateWorkspaceLayout: (workspace, layout) => {
    const current = get()
    const nextLeftWidth = leftSidebarWidth(layout, current.leftSidebarWidth)
    const nextRightPanel: WorkspacePanelState = {
      collapsed: !boolOrCurrent(layout.rightOpen, !current.rightPanel.collapsed),
      width: rightPanelWidth(layout, current.rightPanel.width),
    }
    const nextDataSidebarCollapsed = workspace === 'data' && typeof layout.leftOpen === 'boolean'
      ? !layout.leftOpen
      : current.dataSidebarCollapsed

    if (
      Object.is(current.leftSidebarWidth, nextLeftWidth) &&
      Object.is(current.rightPanel.collapsed, nextRightPanel.collapsed) &&
      Object.is(current.rightPanel.width, nextRightPanel.width) &&
      Object.is(current.dataSidebarCollapsed, nextDataSidebarCollapsed)
    ) {
      return
    }

    set({
      leftSidebarWidth: nextLeftWidth,
      rightPanel: nextRightPanel,
      dataSidebarCollapsed: nextDataSidebarCollapsed,
    })
  },
}))
