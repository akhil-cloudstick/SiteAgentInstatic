/**
 * @mms/shell — the MMSBUILD two-row product shell.
 *
 * ONE implementation, imported as source by every MMS product: MMS-CMS
 * (Instatic), MMS Design (OpenDesign), and anything added later. The
 * shared-header contract requires row 1 to "look and behave as one shared
 * component, not three visual copies maintained independently" — this package
 * is how that is enforced rather than merely intended.
 *
 * Consumers must also load the stylesheets, in this order:
 *   @mms/shell/styles/fonts.css
 *   @mms/shell/styles/tokens.css
 *   @mms/shell/styles/fontawesome.css
 *
 * Constraints on anything added here:
 *   - React 18-compatible (MMS Design runs 18, the CMS runs 19). Use
 *     `forwardRef`, never ref-as-prop; no `use()`, no `useActionState`.
 *   - No manual memoization. The CMS compiles this with the React Compiler,
 *     which bans it; MMS Design has no compiler, so correctness must not
 *     depend on one either.
 *   - No product imports. Nothing from `@core/*`, `@admin/*`, `@ui/*`,
 *     `@site/*`, or an app's `src/`. Behaviour arrives as props.
 *   - No bundler-specific globals (`import.meta.env`): Vite compiles this in
 *     the CMS and Turbopack compiles it in MMS Design.
 */

// ── Shell ──────────────────────────────────────────────────────────────────
export { MmsShellHeader, isPlainClick } from './shell/MmsShellHeader'
export type { MmsShellHeaderProps } from './shell/MmsShellHeader'
export { MmsSpecialistRow } from './shell/MmsSpecialistRow'
export type { MmsSpecialistRowProps } from './shell/MmsSpecialistRow'
export { hubNavigationLinks, hubLinkHref } from './shell/hubNavigation'
export type { HubNavigationLink } from './shell/hubNavigation'
export type {
  HubContext,
  HubRole,
  HubUser,
  ShellBackToHub,
  ShellBrandTarget,
  ShellDestination,
  ShellNotificationItem,
  ShellNotifications,
  ShellTheme,
  ShellUtility,
} from './shell/types'

// ── Primitives ─────────────────────────────────────────────────────────────
// Shared because the shell renders with them: two copies would let the two
// products' headers drift on hover tint, focus ring and target size.
export { cn } from './lib/cn'
export { FaIcon } from './primitives/FaIcon'
export { Button } from './primitives/Button'
export type { ButtonProps } from './primitives/Button'
export { Separator } from './primitives/Separator'
export { Tooltip, CursorTooltip } from './primitives/Tooltip'
export type { TooltipSide, CursorTooltipPoint } from './primitives/Tooltip'
export {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  useContextMenuPanelRegistry,
  useAnchorPosition,
  useDeferredClose,
  usePointPosition,
} from './primitives/ContextMenu'
