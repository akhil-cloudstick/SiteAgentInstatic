/**
 * useUndoRedoShortcuts — keyboard-only history for the visual editor.
 *
 * The canvas notch no longer carries Undo/Redo buttons, so Ctrl/Cmd+Z and
 * Ctrl/Cmd+Shift+Z (plus the Windows Ctrl+Y redo alias) are the only way to
 * reach the page-tree history. This hook owns that listener.
 *
 * It stays a component-owned binding — `editor.undo` / `editor.redo` are
 * listed in `COMPONENT_OWNED_SHORTCUTS` (spotlight/shortcutDispatch.ts) so the
 * spotlight dispatcher skips them — because history must fire on the raw key
 * event rather than round-tripping through the command registry's capability
 * and `when` filtering. The palette still exposes Undo/Redo as commands.
 *
 * The listener sits on `document` (global scope, not canvas-local) so the
 * shortcut works with focus anywhere in the editor shell, and bails on text
 * inputs / contenteditable so it never hijacks native text undo.
 *
 * Shortcut predicates come from the keybindings registry (keybindings.ts) —
 * not hardcoded here.
 */
import { useEffect } from 'react'
import { useUndo, useRedo } from '@site/store/store'
import { getKeybindingForCommand } from '@admin/spotlight/keybindings'

// Resolve undo/redo bindings once at module load — they never change.
const kbUndo = getKeybindingForCommand('editor.undo')
const kbRedo = getKeybindingForCommand('editor.redo')

/**
 * @param enabled Mount the listener only while the canvas is editable — a
 *   read-only viewer has no history to walk.
 */
export function useUndoRedoShortcuts(enabled: boolean): void {
  const undo = useUndo()
  const redo = useRedo()

  useEffect(() => {
    if (!enabled) return

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) return

      if (kbUndo?.match(e)) {
        e.preventDefault()
        undo()
      } else if (kbRedo?.match(e)) {
        e.preventDefault()
        redo()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        // Ctrl+Y is a Windows/Linux redo alias — not in the registry since
        // ⌘⇧Z is the canonical binding, but handled here for convenience.
        e.preventDefault()
        redo()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled, undo, redo])
}
