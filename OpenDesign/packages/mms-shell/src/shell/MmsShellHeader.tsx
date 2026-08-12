/**
 * MmsShellHeader — row 1 of the MMSBUILD shared shell.
 *
 * The shared-header contract splits product chrome into two rows:
 *
 *   ROW 1 (this file)      [MMSBUILD] [Product Hub + context]  [Hub nav]
 *                                  [Help][Bell][Theme][Settings][Account]
 *   ROW 2 (MmsSpecialistRow)  [product identity + scope]  [destinations]
 *                                             [local actions]  [Back to Hub]
 *
 * Row 1 must look and behave as ONE shared component across Product Hub, MMS
 * Design and MMS CMS — so everything here is product-agnostic. Nothing in this
 * file knows what a page tree, a design system or a media asset is; a product's
 * own navigation lives entirely in row 2.
 *
 * ── Why every behaviour is a prop ─────────────────────────────────────────
 * This component is compiled into two different applications with two
 * different routers, state libraries, preference stores and React majors. The
 * only way one implementation can serve both is for it to own the markup and
 * the geometry, and to own none of the wiring. Help, Settings, Theme,
 * Notifications and Account all arrive as callbacks or slots.
 *
 * ── Degrading without a Hub ───────────────────────────────────────────────
 * Product Hub is a real destination only when the install runs behind one.
 * With `hubContext == null` the row renders logo + context label + utilities,
 * with no Hub navigation and no return affordance. The contract forbids
 * defaulting to some other project when context is missing, and a link to a Hub
 * that isn't there is the same failure wearing a nicer coat — so we render
 * nothing rather than a 404.
 *
 * ── Active state ──────────────────────────────────────────────────────────
 * No Hub destination is ever marked active here. The user is inside a
 * specialist product, so the active destination belongs to row 2 (contract
 * §"Active state"). Hub links carry no `aria-current`.
 *
 * Accessibility: this row owns the `banner` landmark for the page; row 2 is a
 * plain labelled `<nav>` region beneath it.
 */
import { useRef, useState, type ReactNode } from 'react'
import { Button } from '../primitives/Button'
import { FaIcon } from '../primitives/FaIcon'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '../primitives/ContextMenu'
import { NotificationsButton } from './NotificationsButton'
import { hubLinkHref, hubNavigationLinks } from './hubNavigation'
import type {
  HubContext,
  ShellBrandTarget,
  ShellNotifications,
  ShellTheme,
  ShellUtility,
} from './types'
import logoLight from '../assets/mmsbuild-logo-light.png'
import logoDark from '../assets/mmsbuild-logo-dark.png'
import styles from './MmsShellHeader.module.css'

/** Shared-shell product label. Not a nav item — the visible label is fixed. */
const HUB_LABEL = 'Product Hub'

/**
 * Bundlers disagree about what an imported image is: Vite hands back a URL
 * string, Next hands back a `StaticImageData` record. One accessor keeps this
 * component agnostic instead of forking the markup per product.
 */
function assetUrl(asset: string | { src: string }): string {
  return typeof asset === 'string' ? asset : asset.src
}

/** Icon size shared by every row-1 utility, matching the reference header. */
const UTILITY_ICON_SIZE = 17

export interface MmsShellHeaderProps {
  /**
   * Render the role-scoped Hub navigation even when no Hub context has been
   * handed over, using the Operator link set.
   *
   * Normally the contract's rule holds — no context means no Hub links, because
   * a link to a Hub that isn't there is a broken promise. This opts a product
   * into showing them anyway so the chrome matches the approved reference while
   * the Hub hand-off is still being wired. The links are inert in that state.
   */
  showHubNavWithoutContext?: boolean
  /**
   * Secondary label under `Product Hub` — the workspace the user is currently
   * in. `MMS Design`, `MMS-CMS`, `Website Extraction`, … Comes from the
   * product's own brand constant so one edit re-labels its whole chrome.
   */
  productLabel: string
  /** Authorized Hub scope, or `null` when no Hub fronts this install. */
  hubContext: HubContext | null
  theme: ShellTheme
  onToggleTheme: () => void
  help: ShellUtility
  settings: ShellUtility
  notifications: ShellNotifications
  /** The product's own account control. Stays visible at every width. */
  accountSlot?: ReactNode
  /** Where the logo goes when there is no Hub. */
  brandTarget: ShellBrandTarget
}

export function MmsShellHeader({
  productLabel,
  hubContext,
  theme,
  onToggleTheme,
  help,
  settings,
  notifications,
  accountSlot,
  brandTarget,
  showHubNavWithoutContext = false,
}: MmsShellHeaderProps) {
  const links = hubContext
    ? hubNavigationLinks(hubContext.role)
    : showHubNavWithoutContext
      ? hubNavigationLinks('operator')
      : []
  const isDark = theme === 'dark'

  return (
    <header
      className={styles.header}
      aria-label="MMS Create shared header"
      data-testid="product-hub-header"
      data-has-hub={hubContext ? 'true' : 'false'}
    >
      <HubBrandLockup
        hubBaseUrl={hubContext?.hubBaseUrl ?? null}
        brandTarget={brandTarget}
        isDark={isDark}
      />
      <HubContextControl hubBaseUrl={hubContext?.hubBaseUrl ?? null} productLabel={productLabel} />

      {links.length > 0 && (
        <nav className={styles.hubNav} aria-label="Product Hub navigation">
          {links.map((link) => (
            <a
              key={link.path}
              className={styles.hubLink}
              href={hubContext ? hubLinkHref(hubContext.hubBaseUrl, link.path) : undefined}
              // No Hub, no destination: the link renders for parity with the
              // approved chrome but must not pretend to go anywhere.
              aria-disabled={hubContext ? undefined : true}
            >
              {link.label}
            </a>
          ))}
        </nav>
      )}

      <div className={styles.spacer} aria-hidden="true" />

      {/* Utility order is fixed by the contract: Help → Notifications → Theme
          → Settings → Account. Each appears exactly once in the whole shell —
          row 2 must not repeat any of them. */}
      <div className={styles.utilities}>
        <span className={styles.wideOnly}>
          <HelpButton help={help} />
        </span>
        <NotificationsButton notifications={notifications} iconSize={UTILITY_ICON_SIZE} />
        <span className={styles.wideOnly}>
          <ThemeToggleButton isDark={isDark} onToggle={onToggleTheme} />
        </span>
        <span className={styles.wideOnly}>
          <SettingsButton settings={settings} />
        </span>
        {/* Account stays visible at every width: it is the identity anchor, and
            folding it into the compact menu would hide *who you are signed in
            as* behind a hamburger. Notifications stays for the same reason —
            an unread count that only exists inside a closed menu is not a
            count. Everything else collapses into `CompactHubMenu`. */}
        {accountSlot}
        <CompactHubMenu
          hubContext={hubContext}
          help={help}
          settings={settings}
          isDark={isDark}
          onToggleTheme={onToggleTheme}
        />
      </div>
    </header>
  )
}

/**
 * Fixed MMS product brand at the shell's left edge.
 *
 * The approved screen ships the lockup as ONE artwork per theme (mascot +
 * wordmark baked into a single PNG) rather than a mascot beside live text. Only
 * the source swaps with the theme; the box is a fixed 145 × 30 in both, so
 * toggling the theme cannot nudge the rest of the row sideways.
 *
 * The images are imported rather than referenced as `/mmsbuild-logo-*.png`
 * because MMS Design is served under a `/design` base path, where a
 * root-absolute URL resolves outside the app.
 *
 * Destination follows the contract: "always returns to the signed-in user's
 * role-scoped Product Hub dashboard", preserving context. With no Hub in front
 * of us the nearest honest equivalent is the product's own home.
 */
function HubBrandLockup({
  hubBaseUrl,
  brandTarget,
  isDark,
}: {
  hubBaseUrl: string | null
  brandTarget: ShellBrandTarget
  isDark: boolean
}) {
  const image = (
    <img
      className={styles.brandMark}
      // Next returns a `StaticImageData` object for an imported PNG while Vite
      // returns a URL string, so read `.src` when it is present. Importing the
      // asset (rather than pointing at `/mmsbuild-logo-*.png`) is what makes it
      // resolve under MMS Design's `/design` base path.
      src={assetUrl(isDark ? logoDark : logoLight)}
      // One box in both themes — the artwork swaps, the frame does not, so a
      // theme toggle cannot shift everything to the right of the lockup.
      width={145}
      height={30}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )

  if (hubBaseUrl) {
    return (
      <a
        className={styles.brand}
        href={hubLinkHref(hubBaseUrl, '/hub')}
        aria-label="MMSBUILD — Product Hub"
        data-testid="hub-header-brand"
      >
        {image}
      </a>
    )
  }

  return (
    <a
      className={styles.brand}
      href={brandTarget.href}
      aria-label="MMSBUILD"
      data-testid="hub-header-brand"
      onClick={(event) => {
        if (!brandTarget.onSelect || !isPlainClick(event)) return
        event.preventDefault()
        brandTarget.onSelect()
      }}
    >
      {image}
    </a>
  )
}

/**
 * Product Hub context control — primary label `Product Hub`, secondary label
 * naming the workspace the user is currently in.
 *
 * Without a Hub there is nowhere for this control to go, so it renders as a
 * label instead of a dead affordance.
 */
function HubContextControl({
  hubBaseUrl,
  productLabel,
}: {
  hubBaseUrl: string | null
  productLabel: string
}) {
  const content = (
    <>
      {/* The approved header leads this control with a tinted product mark, so
          the Hub lockup reads as an identity rather than as breadcrumb text. */}
      <span className={styles.contextMark} aria-hidden="true">
        <FaIcon name="diagram-project" size={15} />
      </span>
      <span className={styles.contextCopy}>
        <span className={styles.contextPrimary}>{HUB_LABEL}</span>
        <span className={styles.contextSecondary}>{productLabel}</span>
      </span>
      <FaIcon name="chevron-down" size={9} className={styles.contextCaret} />
    </>
  )

  if (!hubBaseUrl) {
    return (
      <span className={styles.context} data-testid="hub-header-context">
        {content}
      </span>
    )
  }

  return (
    <a className={styles.context} href={hubLinkHref(hubBaseUrl, '/hub')} data-testid="hub-header-context">
      {content}
    </a>
  )
}

/**
 * Help — the first utility.
 *
 * The approved header draws Help as a labelled pill, not a bare glyph: it is
 * the only utility in the row that carries its name, because it is the one
 * users hunt for rather than recognise. Whether it opens a command palette, a
 * menu or a docs panel is the product's business.
 */
function HelpButton({ help }: { help: ShellUtility }) {
  return (
    <Button
      variant="ghost"
      size="lg"
      className={styles.helpButton}
      aria-label="Help"
      data-testid="hub-header-help"
      disabled={help.disabled}
      onClick={help.onOpen}
    >
      <FaIcon name="circle-question" size={UTILITY_ICON_SIZE} />
      <span>Help</span>
    </Button>
  )
}

/**
 * Theme — the third utility.
 *
 * The glyph shows the theme this button switches TO, not the one that is
 * active: a sun while dark, a moon while light. That is the approved screen's
 * convention, and it is what makes the control readable as an action rather
 * than a status readout.
 */
function ThemeToggleButton({ isDark, onToggle }: { isDark: boolean; onToggle: () => void }) {
  const nextLabel = isDark ? 'Light' : 'Dark'
  return (
    <Button
      variant="ghost"
      size="lg"
      shape="pill"
      iconOnly
      aria-label={`Theme: ${isDark ? 'Dark' : 'Light'}. Switch to ${nextLabel}.`}
      tooltip={`Theme: ${isDark ? 'Dark' : 'Light'}`}
      onClick={onToggle}
      data-testid="toolbar-theme-toggle"
    >
      <FaIcon name={isDark ? 'sun' : 'moon'} size={UTILITY_ICON_SIZE} />
    </Button>
  )
}

/** Settings — the fourth utility. Round 44px header button. */
function SettingsButton({ settings }: { settings: ShellUtility }) {
  return (
    <Button
      variant="ghost"
      size="lg"
      shape="pill"
      iconOnly
      aria-label="Settings"
      tooltip="Settings"
      data-testid="hub-header-settings"
      disabled={settings.disabled}
      onClick={settings.onOpen}
    >
      <FaIcon name="gear" size={UTILITY_ICON_SIZE} />
    </Button>
  )
}

/**
 * Compact-width menu: the role-scoped Hub navigation plus the utilities that
 * leave the bar below the 1100px tier (Help, Theme, Settings).
 *
 * Row 2's own overflow is separate and must stay separate — the contract
 * forbids merging a specialist navigation into this menu, and forbids
 * repeating any utility across the two.
 */
function CompactHubMenu({
  hubContext,
  help,
  settings,
  isDark,
  onToggleTheme,
}: {
  hubContext: HubContext | null
  help: ShellUtility
  settings: ShellUtility
  isDark: boolean
  onToggleTheme: () => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const links = hubContext ? hubNavigationLinks(hubContext.role) : []

  function close(): void {
    setOpen(false)
  }

  return (
    <span className={styles.compactOnly}>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="lg"
        shape="pill"
        iconOnly
        active={open}
        aria-label="Product Hub menu"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="hub-header-compact-menu"
        onClick={() => setOpen((current) => !current)}
      >
        <FaIcon name="bars" size={UTILITY_ICON_SIZE} />
      </Button>
      {open && typeof document !== 'undefined' && (
        <ContextMenu
          ariaLabel="Product Hub menu"
          onClose={close}
          anchorRef={triggerRef}
          side="bottom"
          align="end"
          width={240}
          zIndex={10000}
          // Navigation chrome: scrolling the page means the user moved on.
          closeOnScroll
        >
          {links.map((link) => (
            <ContextMenuItem
              key={link.path}
              onClick={() => {
                close()
                window.location.assign(hubLinkHref(hubContext?.hubBaseUrl ?? '', link.path))
              }}
            >
              <span>{link.label}</span>
            </ContextMenuItem>
          ))}
          {links.length > 0 && <ContextMenuSeparator />}
          <ContextMenuItem
            disabled={help.disabled}
            onClick={() => {
              close()
              help.onOpen()
            }}
          >
            <FaIcon name="circle-question" size={12} />
            <span>Help</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              close()
              onToggleTheme()
            }}
          >
            <FaIcon name={isDark ? 'sun' : 'moon'} size={12} />
            <span>{isDark ? 'Light theme' : 'Dark theme'}</span>
          </ContextMenuItem>
          <ContextMenuItem
            disabled={settings.disabled}
            onClick={() => {
              close()
              settings.onOpen()
            }}
          >
            <FaIcon name="gear" size={12} />
            <span>Settings</span>
          </ContextMenuItem>
        </ContextMenu>
      )}
    </span>
  )
}

/**
 * True for a click that should be intercepted for soft navigation. Modifier
 * keys and non-primary buttons keep the browser's own behaviour, so
 * open-in-new-tab and copy-link still work on every shell link.
 */
export function isPlainClick(event: {
  button: number
  metaKey: boolean
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  defaultPrevented: boolean
}): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  )
}
