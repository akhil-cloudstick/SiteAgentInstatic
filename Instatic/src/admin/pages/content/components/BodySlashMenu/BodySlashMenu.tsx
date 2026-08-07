/**
 * React renderer for the insert-block menu.
 *
 * Mounted by `TiptapBodyEditor` once per editor instance. The editor holds the
 * public API as a ref (`handleRef.current = { open, update, close, … }`) so the
 * SlashCommand extension's `render()` lifecycle can drive the menu without
 * dispatching React events on every key.
 *
 * Two entry points, both landing on the same catalogue and the same keyboard
 * model (per the MMSBUILD Content reference):
 *   - typing `/` → the Suggestion plugin calls `open` / `update` / `close`
 *   - the canvas notch's "Insert" button → `openManual(editor, anchorRect)`
 *
 * Selection model is local: arrow-up / arrow-down move the active index
 * (wrapping); Enter invokes the highlighted item's command; Escape closes. The
 * extension calls `onKeyDown` for any key while the menu is open; we return
 * `true` to swallow handled keys. In manual mode there is no Suggestion plugin
 * to route keys, so the menu listens on the window itself.
 */

import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import type { Editor, Range } from '@tiptap/core'
import { Button } from '@ui/components/Button'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { useEditorAppearancePreferences } from '@site/preferences/editorPreferences'
import { SLASH_COMMAND_GROUPS, type SlashCommandItem } from './SlashCommand'
import styles from './BodySlashMenu.module.css'

/** Gap between the caret / anchor and the menu, and the viewport inset. */
const ANCHOR_GAP = 8
const VIEWPORT_PADDING = 12

export interface SlashMenuHandle {
  open: (
    editor: Editor,
    range: Range,
    items: SlashCommandItem[],
    rect: DOMRect | null,
  ) => void
  update: (range: Range, items: SlashCommandItem[], rect: DOMRect | null) => void
  /** Opens the full catalogue from a UI control rather than a `/` trigger. */
  openManual: (
    editor: Editor,
    range: Range,
    items: SlashCommandItem[],
    rect: DOMRect | null,
  ) => void
  close: () => void
  /** Returns true if the key was handled and should be swallowed. */
  onKeyDown: (event: KeyboardEvent) => boolean
  isOpen: () => boolean
}

interface BodySlashMenuProps {
  handleRef: RefObject<SlashMenuHandle | null>
}

interface MenuState {
  source: 'slash' | 'manual'
  editor: Editor
  range: Range
  items: SlashCommandItem[]
  query: string
  rect: DOMRect | null
}

export function BodySlashMenu({ handleRef }: BodySlashMenuProps) {
  const [state, setState] = useState<MenuState | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const menuRef = useRef<HTMLElement | null>(null)
  // Read here so the portaled node can re-declare the theme scope it loses by
  // being mounted on `document.body`.
  const theme = useEditorAppearancePreferences().theme

  // Derived: clamp the active index to the items range without writing
  // back to state, so re-renders don't cascade through an effect.
  const clampedActiveIndex =
    state && state.items.length > 0
      ? Math.min(Math.max(activeIndex, 0), state.items.length - 1)
      : 0

  function handleKeyDown(event: KeyboardEvent): boolean {
    if (!state) return false
    const itemCount = state.items.length
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (itemCount === 0 ? 0 : (index + 1) % itemCount))
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (itemCount === 0 ? 0 : (index - 1 + itemCount) % itemCount))
      return true
    }
    if (event.key === 'Enter') {
      const item = state.items[clampedActiveIndex]
      if (!item) return false
      event.preventDefault()
      item.command({ editor: state.editor, range: state.range })
      setState(null)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setState(null)
      return true
    }
    return false
  }

  // Latch the newest handler so the manual-mode window listener can read it at
  // event time. Written in an effect and read inside the listener — never
  // during render.
  const handleKeyDownRef = useRef(handleKeyDown)
  useEffect(() => {
    handleKeyDownRef.current = handleKeyDown
  })

  useImperativeHandle(
    handleRef,
    (): SlashMenuHandle => ({
      open: (editor, range, items, rect) => {
        setState({ source: 'slash', editor, range, items, query: '', rect })
        setActiveIndex(0)
      },
      update: (range, items, rect) => {
        setState((current) => (current ? { ...current, range, items, rect } : current))
      },
      openManual: (editor, range, items, rect) => {
        setState({ source: 'manual', editor, range, items, query: '', rect })
        setActiveIndex(0)
      },
      close: () => setState(null),
      isOpen: () => state !== null,
      onKeyDown: (event) => handleKeyDownRef.current(event),
    }),
    [state],
  )

  // Manual mode has no Suggestion plugin routing keys into `onKeyDown`, so the
  // menu takes them from the window while it is open.
  useEffect(() => {
    if (state?.source !== 'manual') return undefined
    const listener = (event: KeyboardEvent) => { handleKeyDownRef.current(event) }
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [state?.source])

  // Dismiss on any pointer press outside the menu. The Suggestion plugin closes
  // the typed `/` menu when the editor loses focus, but the manual one has no
  // such owner and would otherwise stay pinned open forever. Applied to both
  // sources so the behaviour is identical however the menu was opened.
  //
  // Capture phase, and `pointerdown` rather than `click`, so the menu is gone
  // before the press lands on whatever is underneath. Presses inside the menu
  // are ignored, which leaves the rows' own `onMouseDown` focus guard intact.
  useEffect(() => {
    if (!state) return undefined
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      setState(null)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [state])

  // Place below the anchor; flip above when the menu would overflow the
  // viewport, and keep it inside a 12px inset on both axes.
  useLayoutEffect(() => {
    const element = menuRef.current
    const rect = state?.rect
    if (!element || !rect) return undefined
    const place = () => {
      const bounds = element.getBoundingClientRect()
      const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - bounds.width - VIEWPORT_PADDING)
      const left = Math.max(VIEWPORT_PADDING, Math.min(rect.left, maxLeft))
      const below = rect.bottom + ANCHOR_GAP
      const above = rect.top - bounds.height - ANCHOR_GAP
      const top = below + bounds.height <= window.innerHeight - VIEWPORT_PADDING
        ? below
        : Math.max(VIEWPORT_PADDING, above)
      element.style.setProperty('--slash-left', `${Math.round(left)}px`)
      element.style.setProperty('--slash-top', `${Math.round(top)}px`)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [state])

  if (!state || typeof document === 'undefined') return null

  // Group in the reference's fixed order, dropping any group the current
  // filter emptied. Indices stay global so keyboard selection spans groups.
  const groups = SLASH_COMMAND_GROUPS.map((group) => ({
    group,
    entries: state.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.group === group),
  })).filter(({ entries }) => entries.length > 0)

  return createPortal(
    <section
      ref={menuRef}
      className={styles.menu}
      role="listbox"
      aria-label="Insert block"
      data-testid="content-slash-menu"
      data-source={state.source}
      // This menu is portaled to `document.body`, which is outside both the
      // workspace body that carries `data-editor-screen` and the layout shell
      // that carries `data-editor-theme`. Without re-declaring them here every
      // `--content-*` token resolves to nothing, and the grid rows collapse
      // into a full-width vertical stack. Both scopes travel with the portal.
      data-editor-screen="content"
      data-editor-theme={theme}
    >
      <header className={styles.header}>
        <span className={styles.headerMark} aria-hidden="true">
          <PlusIcon size={14} />
        </span>
        <span className={styles.headerCopy}>
          <strong>Insert block</strong>
          <small>Type / to filter</small>
        </span>
        <kbd className={styles.kbd}>Esc</kbd>
      </header>

      <div className={styles.scroll}>
        {groups.length === 0 ? (
          <p className={styles.empty}>No insert commands match.</p>
        ) : (
          groups.map(({ group, entries }) => (
            <div className={styles.group} role="group" aria-label={group} key={group}>
              <p className={styles.groupLabel}>{group}</p>
              {entries.map(({ item, index }) => {
                const CommandIcon = item.icon
                const active = index === clampedActiveIndex
                return (
                  <Button
                    key={item.id}
                    variant="ghost"
                    size="sm"
                    role="option"
                    aria-selected={active}
                    data-active={active ? 'true' : undefined}
                    className={styles.row}
                    onPointerEnter={() => setActiveIndex(index)}
                    // The Suggestion plugin clears the menu when the editor
                    // loses focus. Mouse-down on the menu would steal that
                    // focus before the click fires, so prevent the shift.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      item.command({ editor: state.editor, range: state.range })
                      setState(null)
                    }}
                  >
                    <span className={styles.rowIcon} aria-hidden="true">
                      <CommandIcon size={16} />
                    </span>
                    <span className={styles.rowCopy}>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                    {active && <kbd className={styles.kbd}>Enter</kbd>}
                  </Button>
                )
              })}
            </div>
          ))
        )}
      </div>
    </section>,
    document.body,
  )
}
