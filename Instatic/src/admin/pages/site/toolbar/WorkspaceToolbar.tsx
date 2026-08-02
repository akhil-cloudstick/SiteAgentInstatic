/**
 * WorkspaceToolbar — the Site editor's second toolbar row.
 *
 *   Site › Home page [› Services]     [Live edit | Focus section | Responsive review]     [Desktop | Tablet | Mobile]
 *
 * The approved MMSBUILD Site screen puts three things here that used to be
 * scattered: the document breadcrumb (which did not exist), the canvas-mode
 * switch (previously a two-icon pill floating inside the canvas), and the
 * viewport switch (previously inline in that same pill). In Responsive Review
 * the viewport slot becomes the zoom group, because picking a device makes no
 * sense when every device is on screen at once.
 *
 * Everything rendered here is real editor state — the breadcrumb reads the
 * active page and the focused section from the page tree, the device control
 * reads `site.breakpoints`. Nothing is hardcoded.
 *
 * This component owns the three modes. `canvasView` + `sectionFocusNodeId`
 * remain the storage; `selectSiteWorkspaceMode` remains the reader.
 */
import { useEditorStore } from '@site/store/store'
import { selectActiveCanvasPage, selectActivePage } from '@site/store/store'
import { registry } from '@core/module-engine'
import { getNodeDisplayName, type Breakpoint } from '@core/page-tree'
import { FaIcon } from '@ui/components/FaIcon'
import { Button } from '@ui/components/Button'
import { ZoomControls } from './ZoomControls'
import {
  resolveFocusSectionId,
  topLevelSectionIds,
  type SiteWorkspaceMode,
} from '@site/siteWorkspaceMode'
import styles from './WorkspaceToolbar.module.css'

const EMPTY_BREAKPOINTS: Breakpoint[] = []

/**
 * Font Awesome glyph per breakpoint. `Breakpoint.icon` stores a
 * `pixel-art-icons` name (it predates the MMS re-skin and is user-editable in
 * Settings › Viewport contexts), so the reference's FA glyphs are mapped here
 * rather than changing the persisted shape of every existing site.
 */
const BREAKPOINT_FA_ICONS: Record<string, string> = {
  smartphone: 'mobile-screen-button',
  tablet: 'tablet-screen-button',
  laptop: 'laptop',
  monitor: 'desktop',
  tv: 'tv',
}

function breakpointGlyph(icon: string): string {
  return BREAKPOINT_FA_ICONS[icon] ?? 'desktop'
}

const MODES: ReadonlyArray<{ id: SiteWorkspaceMode; label: string; icon: string; hint?: string }> = [
  { id: 'live', label: 'Live edit', icon: 'arrow-pointer' },
  { id: 'focus', label: 'Focus section', icon: 'border-all' },
  { id: 'review', label: 'Responsive review', icon: 'desktop', hint: 'Design canvas' },
]

interface WorkspaceToolbarProps {
  mode: SiteWorkspaceMode
}

export function WorkspaceToolbar({ mode }: WorkspaceToolbarProps) {
  const activePage = useEditorStore(selectActivePage)
  const canvasPage = useEditorStore(selectActiveCanvasPage)
  const visualComponents = useEditorStore((s) => s.site?.visualComponents)
  const breakpoints = useEditorStore((s) => s.site?.breakpoints ?? EMPTY_BREAKPOINTS)
  const activeBreakpointId = useEditorStore((s) => s.activeBreakpointId)
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId)
  const sectionFocusNodeId = useEditorStore((s) => s.sectionFocusNodeId)
  const setActiveBreakpoint = useEditorStore((s) => s.setActiveBreakpoint)
  const setCanvasView = useEditorStore((s) => s.setCanvasView)
  const setSectionFocus = useEditorStore((s) => s.setSectionFocus)

  const focusNode = sectionFocusNodeId ? canvasPage?.nodes[sectionFocusNodeId] : undefined
  const focusLabel = focusNode
    ? getNodeDisplayName(focusNode, registry.get(focusNode.moduleId), visualComponents)
    : null

  /**
   * Focus needs a section to focus. Resolving from the current selection means
   * "select a button inside Hero, hit Focus section" lands on Hero rather than
   * refusing; with no selection at all we fall back to the first section so the
   * mode is never a dead button.
   */
  function enterFocus(): void {
    const target = resolveFocusSectionId(canvasPage, selectedNodeId)
      ?? topLevelSectionIds(canvasPage)[0]
      ?? null
    if (!target) return
    setCanvasView('live')
    setSectionFocus(target)
  }

  function selectMode(next: SiteWorkspaceMode): void {
    if (next === 'review') {
      // setCanvasView('design') clears the focus itself — one source of truth.
      setCanvasView('design')
      return
    }
    if (next === 'live') {
      setCanvasView('live')
      setSectionFocus(null)
      return
    }
    enterFocus()
  }

  return (
    <div className={styles.toolbar} data-testid="site-workspace-toolbar" data-mode={mode}>
      <nav className={styles.breadcrumb} aria-label="Document location">
        <strong>Site</strong>
        <FaIcon name="chevron-right" size={9} />
        {/* Real page + section names, so the glyphs differ from the approved
            screen's staged copy — masked by the pixel-fidelity gate. */}
        <span data-fidelity-dynamic="">{activePage?.title ?? 'Untitled page'}</span>
        {mode === 'focus' && focusLabel && (
          <>
            <FaIcon name="chevron-right" size={9} />
            <span data-fidelity-dynamic="">{focusLabel}</span>
          </>
        )}
      </nav>

      <div className={styles.modeControl} role="group" aria-label="Canvas mode">
        {MODES.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            size="lg"
            className={styles.segment}
            aria-pressed={mode === item.id}
            data-selected={mode === item.id ? 'true' : undefined}
            data-testid={`site-mode-${item.id}`}
            onClick={() => selectMode(item.id)}
          >
            <FaIcon name={item.icon} size={14} />
            <span className={styles.segmentText}>
              <span className={styles.segmentLabel}>{item.label}</span>
              {item.hint && <small className={styles.segmentHint}>{item.hint}</small>}
            </span>
          </Button>
        ))}
      </div>

      {mode === 'review' ? (
        <ZoomControls className={styles.zoomControl} />
      ) : (
        <div className={styles.deviceControl} role="group" aria-label="Viewport">
          {breakpoints.map((breakpoint) => (
            <Button
              key={breakpoint.id}
              variant="ghost"
              size="lg"
              className={styles.segment}
              aria-pressed={activeBreakpointId === breakpoint.id}
              data-selected={activeBreakpointId === breakpoint.id ? 'true' : undefined}
              data-testid={`site-viewport-${breakpoint.id}`}
              tooltip={`${breakpoint.label} · ${breakpoint.width}px`}
              onClick={() => setActiveBreakpoint(breakpoint.id)}
            >
              <FaIcon name={breakpointGlyph(breakpoint.icon)} size={14} />
              <span className={styles.segmentLabel}>{breakpoint.label}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
