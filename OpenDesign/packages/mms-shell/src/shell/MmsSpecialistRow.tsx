/**
 * MmsSpecialistRow — row 2 of the MMSBUILD shared shell: a product's SPECIALIST
 * navigation.
 *
 * Layout (left → right):
 *   [Back to Hub?] [identity + scope] [destinations] [middle] [spacer→]
 *                                                 [right] [Back to Hub?]
 *
 * Row 1 is `MmsShellHeader` and is shared verbatim with every MMS product. It
 * owns the MMSBUILD brand lockup and the five utilities — Help, Notifications,
 * Theme, Settings, Account. The contract requires each of those to appear
 * EXACTLY ONCE in the shell, so none of them may be added back here.
 *
 * What belongs in this row: the product's own destinations, its identity, and
 * its local actions. Per-workspace controls — save, preview, publish, canvas
 * mode, zoom — belong BELOW this row in the product's own workspace toolbar.
 *
 * ── Why destinations are data, not children ───────────────────────────────
 * Each product resolves its own destinations behind its own capability gates,
 * then hands the resolved list here. That keeps the tab chrome — metrics,
 * underline, hover ink, active weight, 44px targets — identical everywhere
 * while leaving *which* tabs exist entirely to the product. A product that
 * rendered its own tabs would be re-implementing the row.
 *
 * Accessibility (WCAG 2.1 AA):
 * - `MmsShellHeader` owns the page's `banner` landmark; this is a labelled
 *   navigation region beneath it.
 * - Exactly one destination carries `aria-current="page"`.
 * - Every interactive child has a 44px minimum target.
 */
import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Button } from '../primitives/Button'
import { ContextMenu, ContextMenuItem } from '../primitives/ContextMenu'
import { FaIcon } from '../primitives/FaIcon'
import { cn } from '../lib/cn'
import { isPlainClick } from './MmsShellHeader'
import type { ShellBackToHub, ShellDestination } from './types'
import styles from './MmsSpecialistRow.module.css'

/**
 * Nav tab icon size.
 *
 * The approved screen keeps each destination's glyph in the markup but hides it
 * in CSS (`.main-nav button svg { display: none }`), so the rail reads as six
 * evenly-spaced labels. The size is kept because the glyph is still the
 * destination's identity everywhere else it appears — the compact menu, the
 * product's own surfaces — and because hiding is a presentation choice a
 * stylesheet can revisit without touching this file.
 */
const NAV_ICON_SIZE = 17

export interface MmsSpecialistRowProps {
  /** The product's own name, e.g. `MMS Design`, `MMS-CMS`. */
  productName: string
  /**
   * Broadest → narrowest, exactly as the contract orders it: client, then
   * project, then site. Blank entries should be filtered out by the caller;
   * any that slip through are dropped rather than leaving stray separators.
   */
  scope?: Array<string | null | undefined>
  /** Where clicking the identity goes — the product's own home. */
  identityHref: string
  onSelectIdentity?: () => void
  destinations: ShellDestination[]
  /** Accessible name for the nav region, e.g. `MMS Design navigation`. */
  navLabel: string
  /** Accessible name for the row, e.g. `MMS Design specialist workspace`. */
  rowLabel: string
  backToHub?: ShellBackToHub
  /** Product-local content immediately after the destinations. */
  middleSlot?: ReactNode
  /** Product-local actions before the trailer, e.g. `New project`, publish. */
  rightSlot?: ReactNode
  /**
   * Full-screen siblings rendered before the row. Used for overlays that must
   * cover the viewport rather than be clipped by the row's stacking context.
   */
  overlay?: ReactNode
}

export function MmsSpecialistRow({
  productName,
  scope,
  identityHref,
  onSelectIdentity,
  destinations,
  navLabel,
  rowLabel,
  backToHub,
  middleSlot,
  rightSlot,
  overlay,
}: MmsSpecialistRowProps) {
  // Rendered whenever the product asks for it. An empty  means "no Hub
  // to return to yet" — the control still belongs in the chrome, it just has
  // nowhere to go, which is handled in the button itself.
  const backControl = backToHub ? <BackToProductHubButton backToHub={backToHub} /> : null
  const backOnLeft = backToHub?.position === 'left'

  return (
    <>
      {overlay}
      {/* A labelled navigation region, never a second banner element: row 1
          owns the page's `banner` landmark, and two banners on one page is a
          defect. `data-testid="toolbar"` is the long-standing Playwright
          selector for this row and is part of its contract. */}
      <div
        className={styles.header}
        role="navigation"
        aria-label={rowLabel}
        data-testid="toolbar"
      >
        {backOnLeft && backControl}
        <ProductIdentity
          productName={productName}
          scope={scope}
          href={identityHref}
          onSelect={onSelectIdentity}
        />
        <CompactDestinationsMenu destinations={destinations} navLabel={navLabel} />
        <nav className={styles.adminNav} aria-label={navLabel}>
          {destinations.map((destination) => (
            <DestinationTab key={destination.id} destination={destination} />
          ))}
        </nav>
        {middleSlot && <div className={styles.middleSlot}>{middleSlot}</div>}
        <div className={styles.spacer} aria-hidden="true" />
        {rightSlot}
        {!backOnLeft && backControl && <div className={styles.headerTrailer}>{backControl}</div>}
      </div>
    </>
  )
}

/**
 * The approved header stacks the product name over its client · project · site
 * scope and closes the block with a hairline, so the identity reads as its own
 * region rather than as the first item of the navigation.
 */
function ProductIdentity({
  productName,
  scope,
  href,
  onSelect,
}: {
  productName: string
  scope?: Array<string | null | undefined>
  href: string
  onSelect?: () => void
}) {
  const parts = (scope ?? []).filter((part): part is string => Boolean(part))

  return (
    <a
      className={styles.productIdentity}
      href={href}
      data-testid="toolbar-product-identity"
      onClick={(event) => {
        if (!onSelect || !isPlainClick(event)) return
        event.preventDefault()
        onSelect()
      }}
    >
      <span className={styles.productName}>{productName}</span>
      {parts.length > 0 && (
        <span className={styles.productScope}>
          {parts.map((part, index) => (
            <span key={part}>
              {index > 0 && (
                <span className={styles.productScopeSep} aria-hidden="true">
                  ·
                </span>
              )}
              {part}
            </span>
          ))}
        </span>
      )}
    </a>
  )
}

/**
 * One destination.
 *
 * Always an anchor, even when `onSelect` drives a soft navigation: that is what
 * keeps middle-click, ctrl-click and "copy link address" working, and what a
 * screen reader announces. The active tab keeps the same box as an inactive one
 * — only ink weight, colour and the underline change — so switching workspaces
 * never shifts the row.
 */
function DestinationTab({ destination }: { destination: ShellDestination }) {
  const { label, icon, href, active, badgeLabel, onSelect } = destination

  function handleClick(event: MouseEvent<HTMLAnchorElement>): void {
    if (!onSelect || !isPlainClick(event)) return
    event.preventDefault()
    onSelect()
  }

  return (
    <a
      className={active ? styles.activeSection : styles.adminLink}
      href={href}
      aria-current={active ? 'page' : undefined}
      data-testid={`specialist-nav-${destination.id}`}
      onClick={handleClick}
    >
      <FaIcon name={icon} size={NAV_ICON_SIZE} />
      <span>{label}</span>
      {badgeLabel && (
        <output className={styles.destinationBadge} aria-label={badgeLabel} title={badgeLabel} />
      )}
    </a>
  )
}

/**
 * The rail's overflow below the 1100px tier.
 *
 * The contract is explicit that this stays SEPARATE from row 1's compact menu:
 * "at 1100px and below, replace the desktop rail with its own MMS Design menu;
 * do not merge it into the Product Hub menu". Two navigations that mean
 * different things must not collapse into one hamburger — so the row owns this
 * trigger, and it carries the product's name to say which navigation it is.
 *
 * Hidden above the tier by CSS rather than by a width listener: a media query
 * cannot disagree with the stylesheet that hides the rail, and there is no
 * resize handler to get out of sync on a rotate.
 */
function CompactDestinationsMenu({
  destinations,
  navLabel,
}: {
  destinations: ShellDestination[]
  navLabel: string
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <span className={styles.compactOnly}>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        className={styles.compactTrigger}
        active={open}
        aria-label={navLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="specialist-nav-compact-menu"
        onClick={() => setOpen((current) => !current)}
      >
        <FaIcon name={open ? 'xmark' : 'bars'} size={14} />
        <span>Menu</span>
      </Button>
      {open && typeof document !== 'undefined' && (
        <ContextMenu
          ariaLabel={navLabel}
          onClose={() => setOpen(false)}
          anchorRef={triggerRef}
          side="bottom"
          align="start"
          width={280}
          zIndex={9000}
          // Navigation chrome: scrolling the page means the user moved on.
          closeOnScroll
        >
          {destinations.map((destination) => (
            <ContextMenuItem
              key={destination.id}
              data-testid={`specialist-nav-compact-${destination.id}`}
              onClick={() => {
                setOpen(false)
                // Soft navigation when the product offers one, a real
                // navigation otherwise — the same contract as the desktop tab.
                if (destination.onSelect) destination.onSelect()
                else window.location.assign(destination.href)
              }}
            >
              <FaIcon name={destination.icon} size={13} />
              <span>{destination.label}</span>
            </ContextMenuItem>
          ))}
        </ContextMenu>
      )}
    </span>
  )
}

/**
 * Return affordance required by the shared-header contract: back to the exact
 * Hub dashboard, module and view the user arrived from, with role, client,
 * project and originating surface intact. All of that lives in the URL the Hub
 * pinned at hand-off, so this button never reconstructs the scope itself.
 *
 * Renders only when the install actually runs behind a Product Hub. Without one
 * there is nowhere to return to, and the contract forbids inventing a
 * destination.
 *
 * Unsaved work: this is a full-page navigation, so every registered
 * `beforeunload` handler runs first — including a product's own persistence
 * flush. That is the existing mechanism for protecting in-flight edits; a
 * second confirm layer here would double-prompt against it.
 */
function BackToProductHubButton({ backToHub }: { backToHub: ShellBackToHub }) {
  const label = backToHub.label ?? 'Back to Product Hub'
  return (
    // Deliberately NOT the `Button` primitive. The approved header draws this as
    // plain green text — no fill, no border, no radius — because it is a return
    // path rather than an action competing with the row's local actions. Wearing
    // the secondary-button pill made it read as the row's primary control.
    <button
      type="button"
      className={cn(styles.backToHub, backToHub.position === 'left' && styles.backToHubLeading)}
      data-testid="toolbar-back-to-product-hub"
      // No destination yet: stay put rather than navigate to nothing.
      disabled={!backToHub.href}
      onClick={() => {
        if (backToHub.href) window.location.assign(backToHub.href)
      }}
    >
      <FaIcon name="arrow-left" size={13} />
      <span>{label}</span>
    </button>
  )
}
