/**
 * Wire and prop shapes for the shared MMS shell.
 *
 * Deliberately dependency-free: no TypeBox, no product store, no router. The
 * shell is rendered by Instatic (React 19, Vite) and by MMS Design (React 18,
 * Next) from the same source, so anything it imports has to be importable by
 * both. Products validate their own hub-context payload at their own boundary
 * and hand the parsed object in.
 */
import type { ReactNode } from 'react'

/**
 * Role the Product Hub authorized this session as — the user's authority across
 * the whole portfolio, which only the Hub knows. Never inferred from a
 * product's own role table.
 *
 * `operator` and `agency` share one navigation set per the shared-header
 * contract; they stay distinct because the Hub distinguishes them elsewhere.
 */
export type HubRole = 'operator' | 'agency' | 'client' | 'super-admin'

/**
 * The authorized scope a specialist product was opened with.
 *
 * `null` (rather than a partially-filled object) is the correct value when this
 * install runs with no Product Hub in front of it. The contract forbids
 * substituting a default client, project or destination, so the shell renders
 * its no-Hub shape instead of inventing one.
 */
/**
 * The signed-in person, as the Product Hub knows them.
 *
 * Only the Hub authenticates; a specialist product never mints this from its
 * own tables. `null` on `HubContext.user` means nobody is identified, and the
 * account control says so rather than showing borrowed initials.
 */
export interface HubUser {
  /** Display name, for the account control's accessible name. */
  name: string
  /** One or two letters for the avatar. Already upper-cased by the Hub. */
  initials: string
}

export interface HubContext {
  /** Origin the Product Hub is served from. Every Hub link resolves against it. */
  hubBaseUrl: string
  role: HubRole
  /**
   * Signed-in user, when the Hub identified one.
   *
   * Optional so a product whose Hub hand-off predates this field keeps
   * compiling; absent and `null` mean the same thing — nobody is identified.
   */
  user?: HubUser | null
  /** Client / organization display name. */
  client: string | null
  /** Project display name. */
  project: string | null
  /** Site display name within the project. */
  site: string | null
  /** Originating Hub surface / module / panel, echoed back on return. */
  origin: string | null
  /** Absolute URL of the exact Hub view to return to. Always Hub-origin. */
  returnUrl: string
  /**
   * Which products the operator has enabled platform-wide.
   *
   * The shell needs these to know whether a Product Hub is worth linking to at
   * all: with only one product enabled the Hub immediately bounces back into
   * that same product, so `Home` would be a link to where you already are.
   *
   * Optional so a hand-off that predates these fields keeps compiling; absent
   * means "unknown", which is treated as enabled — the routing gate is
   * server-side, and a hidden link is the worse failure of the two.
   */
  designActive?: boolean
  cmsActive?: boolean
}

/** Light/dark, as the product persists it. The shell only reads and toggles. */
export type ShellTheme = 'light' | 'dark'

/**
 * One destination in a specialist row.
 *
 * `href` is always required even when `onSelect` handles the click: it is what
 * makes middle-click, ctrl-click and "copy link" work, and what a screen reader
 * announces. `onSelect` upgrades a plain click to the product's own soft
 * navigation; without it the anchor navigates normally.
 */
export interface ShellDestination {
  /** Stable key + test selector. */
  id: string
  label: string
  /** Font Awesome Solid glyph name, without the `fa-` prefix. */
  icon: string
  href: string
  /** Exactly one destination in the row may be active. */
  active?: boolean
  /**
   * Small status dot beside the label — e.g. "a plugin is in an error state".
   * The string is the dot's accessible name.
   */
  badgeLabel?: string
  onSelect?: () => void
}

/** A row-1 utility the product owns the behaviour of. */
export interface ShellUtility {
  onOpen: () => void
  /** Rendered inert (but still visible) when the product cannot service it. */
  disabled?: boolean
}

/**
 * One entry in the notifications panel. `kind` drives an identity stripe only —
 * the panel stays achromatic so a long list does not read as a wall of alarm.
 */
export interface ShellNotificationItem {
  id: string
  title: string
  body: string
  /** ISO timestamp; rendered as a relative age. */
  at: string
  kind?: 'error' | 'warning' | 'info'
}

/**
 * Bell + unread count.
 *
 * The product supplies the entries; the shell renders the panel, so an alert
 * looks the same in every MMS product. `panel` overrides that rendering for a
 * product with a genuinely different surface — reach for it last.
 */
export interface ShellNotifications extends ShellUtility {
  unreadCount: number
  items?: ShellNotificationItem[]
  /** Escape hatch: replaces the shared list rendering entirely. */
  panel?: ReactNode
  /** Called when the panel opens, so the product can mark items read. */
  onRead?: () => void
}

/** Where the brand lockup goes when there is no Hub to return to. */
export interface ShellBrandTarget {
  href: string
  onSelect?: () => void
}

/** `Back to Product Hub`, and which end of row 2 it sits on. */
export interface ShellBackToHub {
  /**
   * `left` for MMS Design (DECISIONS 2026-08-10: leftmost, before the product
   * identity), `right` for the CMS. The only per-product difference the
   * contract sanctions in this row.
   */
  position: 'left' | 'right'
  /** Absolute Hub URL. Omit to hide the control entirely (no Hub present). */
  href?: string
  label?: string
}
