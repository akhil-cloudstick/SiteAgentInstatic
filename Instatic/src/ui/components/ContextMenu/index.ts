/**
 * ContextMenu — the anchored-panel core now lives in `@mms/shell`, because the
 * shared shell's notifications panel and both compact menus are built on it.
 *
 * `ContextMenuSubmenu` and `MenuSearchHeader` stay CMS-local: the submenu draws
 * its chevron from this product's vendored Remix set and the search header
 * wraps this product's `SearchBar`, neither of which belongs in a package that
 * MMS Design also compiles.
 */
export {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  useContextMenuPanelRegistry,
  useAnchorPosition,
  useDeferredClose,
  usePointPosition,
} from '@mms/shell'
export { ContextMenuSubmenu } from './ContextMenuSubmenu'
export { MenuSearchHeader } from './MenuSearchHeader'
