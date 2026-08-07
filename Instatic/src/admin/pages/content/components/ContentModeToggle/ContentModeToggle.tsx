/**
 * Write / Live switch for the content editor.
 *
 * Transcribed from the MMSBUILD Content reference: two 44×44 ICON-ONLY tabs in
 * a rounded pill floating over the canvas at top-left. The two modes are:
 *
 *   - **Write** — the bare Tiptap surface optimised for fast text input.
 *     Tall content column, no template chrome, no published CSS.
 *
 *   - **Live** — the entry rendered against its actual entry template inside a
 *     sandboxed iframe, with the site's real reset / framework / style bundle
 *     applied. The body region stays inline-editable via Tiptap mounted
 *     directly into the iframe document.
 *
 * The toggle owns no app state — `mode` + `onChange` are passed in. The visible
 * label is carried by `aria-label` / tooltip only, matching the reference.
 */

import { type SyntheticEvent } from 'react'
import { cn } from '@ui/cn'
import { TextStartTIcon } from 'pixel-art-icons/icons/text-start-t'
import { EyeSolidIcon } from 'pixel-art-icons/icons/eye-solid'
import styles from './ContentModeToggle.module.css'

export type ContentMode = 'write' | 'live'

interface ContentModeToggleProps {
  mode: ContentMode
  onChange: (mode: ContentMode) => void
}

export function ContentModeToggle({ mode, onChange }: ContentModeToggleProps) {
  // The toggle lives on the canvas surface, which has its own click /
  // keyboard handlers (deselect, shortcuts). Stop propagation so the
  // tab buttons feel like chrome, not "clicks on empty canvas".
  const stopCanvasInteraction = (event: SyntheticEvent) => {
    event.stopPropagation()
  }

  return (
    <div
      className={styles.shell}
      role="tablist"
      aria-label="Content editor mode"
      data-testid="content-mode-toggle"
      onClick={stopCanvasInteraction}
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'write'}
        aria-label="Write"
        data-testid="content-mode-toggle-write"
        className={cn(styles.tab, mode === 'write' && styles.tabActive)}
        onClick={() => onChange('write')}
      >
        <TextStartTIcon size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'live'}
        aria-label="Live"
        data-testid="content-mode-toggle-live"
        className={cn(styles.tab, mode === 'live' && styles.tabActive)}
        onClick={() => onChange('live')}
      >
        <EyeSolidIcon size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
