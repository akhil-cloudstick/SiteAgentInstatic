/**
 * CanvasModeToggle — the "Run scripts" control for the canvas surface.
 *
 * The Design/Live switch and the live breakpoint row used to live here. Both
 * moved into `toolbar/WorkspaceToolbar` in the MMSBUILD re-skin, where the
 * approved screen puts them: a three-way mode control and a viewport control
 * on the toolbar row above the canvas. What is left is the one control the
 * reference has no slot for.
 *
 * "Run scripts" injects the site's bundled runtime scripts into the editable
 * iframes (both canvas views), so authored behaviour runs in place while
 * editing. Its build status and a manual Refresh sit beside it — Refresh
 * re-runs the scripts after edits that React reconciled away.
 */
import type { SyntheticEvent } from 'react'
import { useEditorStore } from '@site/store/store'
import type { RuntimeScriptStatus } from './useRuntimeScriptBuild'
import { CodeIcon } from 'pixel-art-icons/icons/code'
import { ReloadIcon } from 'pixel-art-icons/icons/reload'
import { cn } from '@ui/cn'
import { Tooltip } from '@ui/components/Tooltip'
import styles from './CanvasModeToggle.module.css'

interface CanvasModeToggleProps {
  /** Build status of the runtime scripts (idle while the toggle is off). */
  scriptStatus: RuntimeScriptStatus
  /** Force a rebuild + re-run of the runtime scripts. */
  onRefreshScripts: () => void
  /**
   * Auto-hide the switcher until hovered/focused, rolling it down from the top
   * edge. Used in live mode, where the frame is flush with the top of the
   * surface and a pinned switcher would overlay the page's header. A slim
   * handle stays visible as the hover affordance. Mirrors `CanvasNotch`'s peek.
   */
  peek?: boolean
}

export function CanvasModeToggle({ scriptStatus, onRefreshScripts, peek = false }: CanvasModeToggleProps) {
  const runScripts = useEditorStore((s) => s.runScripts)
  const setRunScripts = useEditorStore((s) => s.setRunScripts)

  // The toggle lives inside the canvas surface, which has its own click /
  // keyboard handlers (deselect, shortcuts, etc.). Stop propagation so the
  // buttons feel like chrome, not "clicks on empty canvas".
  const stopCanvasInteraction = (event: SyntheticEvent) => {
    event.stopPropagation()
  }

  return (
    <div className={cn(styles.shell, peek && styles.shellPeek)}>
      {peek && <div aria-hidden="true" className={styles.peekHandle} />}
      <div className={styles.roller}>
        <div
          className={styles.pill}
          role="toolbar"
          aria-label="Canvas scripts"
          data-testid="canvas-mode-toggle"
          onClick={stopCanvasInteraction}
        >
          <Tooltip content="Run site scripts inside the editable frames">
            <button
              type="button"
              aria-pressed={runScripts}
              aria-label="Run scripts"
              data-testid="canvas-run-scripts-toggle"
              className={cn(styles.tab, runScripts && styles.tabActive)}
              data-script-status={runScripts ? scriptStatus : undefined}
              onClick={() => setRunScripts(!runScripts)}
            >
              <CodeIcon size={14} aria-hidden="true" />
            </button>
          </Tooltip>
          {runScripts && (
            <Tooltip content="Re-run scripts from current site state">
              <button
                type="button"
                aria-label="Refresh scripts"
                data-testid="canvas-run-scripts-refresh"
                className={styles.tab}
                disabled={scriptStatus === 'building'}
                onClick={() => onRefreshScripts()}
              >
                <ReloadIcon size={14} aria-hidden="true" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}
