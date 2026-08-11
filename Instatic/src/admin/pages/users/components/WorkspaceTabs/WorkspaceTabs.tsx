/**
 * WorkspaceTabs — the segmented People / Roles / Activity control.
 *
 * The approved screen draws one bordered track beside the page title with a
 * cell per state: hairline dividers between cells, a cream-green face on the
 * active cell, and a 3px green bar along its bottom edge. It is a tablist, not
 * a row of buttons — People, Roles and Activity are three states of ONE
 * workspace (the reference's contract test asserts exactly that), so they get
 * `role="tab"` with roving tabindex rather than three independent controls.
 *
 * Bare `<button role="tab">` is the sanctioned exception §8.6 in
 * `button-primitive-usage.test.ts` — a `<Button>` cannot carry the roving
 * tabindex, the full-bleed underbar, or the fused-cell geometry without
 * fighting its own variant styles.
 */
import { useRef, type KeyboardEvent } from 'react'
import { FaIcon } from '@ui/components/FaIcon'
import { cn } from '@ui/cn'
import { tabLabel } from '../../utils/format'
import type { Tab } from '../../types'
import styles from './WorkspaceTabs.module.css'

/** Glyph per state, matching the approved control. */
const TAB_ICONS: Record<Tab, string> = {
  people: 'user-group',
  roles: 'shield-halved',
  activity: 'clock',
}

interface WorkspaceTabsProps {
  tabs: Tab[]
  active: Tab
  onChange: (tab: Tab) => void
}

export function WorkspaceTabs({ tabs, active, onChange }: WorkspaceTabsProps) {
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([])

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()

    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = tabs.length - 1

    const target = tabs[next]
    if (!target) return
    onChange(target)
    // Selection follows focus, and focus has to land after the re-render or
    // the roving tabindex puts it back where it was.
    window.requestAnimationFrame(() => cellRefs.current[next]?.focus())
  }

  return (
    <div role="tablist" aria-label="Team access sections" className={styles.track}>
      {tabs.map((tab, index) => {
        const selected = tab === active
        return (
          <button
            key={tab}
            ref={(node) => {
              cellRefs.current[index] = node
            }}
            id={`tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${tab}`}
            tabIndex={selected ? 0 : -1}
            className={cn(styles.cell, selected && styles.cellActive)}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => onChange(tab)}
          >
            <FaIcon name={TAB_ICONS[tab]} size={16} />
            <span>{tabLabel(tab)}</span>
          </button>
        )
      })}
    </div>
  )
}
