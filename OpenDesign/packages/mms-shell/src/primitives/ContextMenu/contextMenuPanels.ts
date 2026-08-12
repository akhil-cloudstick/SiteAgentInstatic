import { createContext, useContext } from 'react'

/**
 * Registry of portaled panels that belong to an open ContextMenu tree.
 *
 * `ContextMenu` dismisses itself from a capture-phase `mousedown` listener on
 * every same-origin document, forgiving only clicks inside its own menu
 * element (plus an optional trigger/anchor). `ContextMenuSubmenu` portals its
 * panel to `document.body` as a SIBLING of that element, so without this
 * registry every click inside a submenu is classified as an outside click:
 * the menu starts its deferred close on `mousedown`, sets `pointer-events:
 * none`, and unmounts ~110ms later — before a deliberate click's `mouseup`
 * lands. The item's `onClick` then never fires and the action silently
 * no-ops (the "Insert module here → nothing happens" bug).
 *
 * React synthetic `stopPropagation` cannot fix this: the dismiss listener is
 * native and runs in the capture phase, before the target phase React
 * delegates from.
 *
 * Each submenu registers its panel node here on mount and unregisters on
 * unmount, so the dismiss handler can treat the whole menu tree as "inside".
 * Nesting works because a submenu re-provides the same registry it consumed,
 * so a sub-submenu's panel registers all the way up to the root menu.
 */
export interface ContextMenuPanelRegistry {
  /** Register a portaled panel. Returns the matching unregister function. */
  registerPanel: (node: HTMLElement) => () => void
  /** True when `target` sits inside any registered panel. */
  containsPanelTarget: (target: Node) => boolean
}

export const ContextMenuPanelContext = createContext<ContextMenuPanelRegistry | null>(null)

export function useContextMenuPanelRegistry(): ContextMenuPanelRegistry | null {
  return useContext(ContextMenuPanelContext)
}
