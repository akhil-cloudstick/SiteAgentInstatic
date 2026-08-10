/**
 * ProductHubHeader — row 1 of the MMSBUILD shared shell.
 *
 * The shared-header contract splits admin chrome into two rows:
 *
 *   ROW 1 (this file)  [MMSBUILD] [Product Hub + context]  [Hub nav]
 *                                    [Help][Bell][Theme][Settings][Account]
 *   ROW 2 (`Toolbar`)  [product identity + site]  [CMS nav]  [local actions]
 *                                                      [Back to Product Hub]
 *
 * Row 1 must look and behave as ONE shared component across Product Hub, MMS
 * Design and this CMS — so everything here is deliberately product-agnostic.
 * Nothing in this file knows what a page tree or a media asset is; the CMS's
 * own navigation lives entirely in row 2.
 *
 * Placed in `shared/` (not under `pages/site/`) so all three layouts can mount
 * it without one layout's module graph reaching into another's. It must never
 * import `@site/store` — `AdminPageLayout`'s bundle contract keeps the ~165 KB
 * editor store off Plugins / Users / Account, and this row renders there too.
 *
 * ── Degrading without a Hub ────────────────────────────────────────────────
 * Product Hub is a real destination only when this install runs behind one.
 * On a plain self-hosted install `useHubContext()` returns null and the row
 * renders logo + context label + utilities, with no Hub navigation and no
 * return affordance. The contract forbids defaulting to some other project
 * when context is missing, and a link to a Hub that isn't there is the same
 * failure wearing a nicer coat — so we render nothing rather than a 404.
 *
 * ── Active state ───────────────────────────────────────────────────────────
 * No Hub destination is ever marked active here. The user is inside the CMS,
 * so the active destination belongs to row 2 (contract §"Active state"). Hub
 * links carry no `aria-current`.
 *
 * Accessibility: this row owns the `banner` landmark for the page; row 2 is a
 * plain labelled `<nav>` region beneath it.
 */
import { useContext, useRef, useState } from 'react'
import { BRAND_NAME } from '@core/brand'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@ui/components/ContextMenu'
import { Link } from '@admin/lib/routing'
import { AccountMenuButton } from '@admin/shared/AccountMenuButton'
import { ThemeToggleButton } from '@site/toolbar/ThemeToggleButton'
import {
  useEditorSelectPreference,
  setEditorSelectPreference,
} from '@site/preferences/editorPreferences'
import { useAdminUi } from '@admin/state/adminUi'
import { useHubContext } from '@admin/state/hubContext'
import { SpotlightContext } from '@admin/spotlight/spotlightContext'
import { HelpButton } from './HelpButton'
import { NotificationsButton } from './NotificationsButton'
import { SettingsButton } from './SettingsButton'
import { hubLinkHref, hubNavigationLinks } from './hubNavigation'
import styles from './ProductHubHeader.module.css'

/** Shared-shell product label. Not a nav item — the visible label is fixed. */
const HUB_LABEL = 'Product Hub'

/** Icon size shared by every row-1 utility, matching the reference header. */
const UTILITY_ICON_SIZE = 17

export function ProductHubHeader() {
  const hubContext = useHubContext()
  const links = hubContext ? hubNavigationLinks(hubContext.role) : []

  return (
    <header
      className={styles.header}
      aria-label="Product Hub"
      data-testid="product-hub-header"
      data-has-hub={hubContext ? 'true' : 'false'}
    >
      <HubBrandLockup hubBaseUrl={hubContext?.hubBaseUrl ?? null} />
      <HubContextControl hubBaseUrl={hubContext?.hubBaseUrl ?? null} />

      {links.length > 0 && (
        <nav className={styles.hubNav} aria-label="Product Hub navigation">
          {links.map((link) => (
            <a
              key={link.path}
              className={styles.hubLink}
              href={hubLinkHref(hubContext?.hubBaseUrl ?? '', link.path)}
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
          <HelpButton />
        </span>
        <NotificationsButton />
        <span className={styles.wideOnly}>
          <ThemeToggleButton />
        </span>
        <span className={styles.wideOnly}>
          <SettingsButton />
        </span>
        {/* Account stays visible at every width: it is the identity anchor, and
            folding it into the compact menu would hide *who you are signed in
            as* behind a hamburger. Notifications stays for the same reason —
            an unread count that only exists inside a closed menu is not a
            count. Everything else collapses into `CompactHubMenu`. */}
        <AccountMenuButton />
        <CompactHubMenu />
      </div>
    </header>
  )
}

/**
 * Fixed MMS product brand at the shell's left edge — moved here from the CMS
 * toolbar when the shared row took ownership of it.
 *
 * The approved screen ships the lockup as ONE artwork per theme (mascot +
 * wordmark baked into a single PNG) rather than a mascot beside live text, and
 * the dark asset is drawn slightly larger — so the source and the intrinsic
 * size both swap with the theme. Served from `public/mmsbuild-logo-{light,dark}.png`.
 *
 * Destination follows the contract: "always returns to the signed-in user's
 * role-scoped Product Hub dashboard", preserving context. With no Hub in front
 * of us the nearest honest equivalent is the CMS dashboard.
 */
function HubBrandLockup({ hubBaseUrl }: { hubBaseUrl: string | null }) {
  const isDark = useEditorSelectPreference('theme') === 'dark'
  const image = (
    <img
      className={styles.brandMark}
      src={isDark ? '/mmsbuild-logo-dark.png' : '/mmsbuild-logo-light.png'}
      width={isDark ? 148 : 141}
      height={isDark ? 30 : 25}
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
    <Link
      className={styles.brand}
      to="/cms/dashboard"
      aria-label="MMSBUILD"
      data-testid="hub-header-brand"
    >
      {image}
    </Link>
  )
}

/**
 * Product Hub context control — primary label `Product Hub`, secondary label
 * naming the workspace context the user is currently in.
 *
 * The secondary label is the product's own brand constant rather than the
 * literal string from the contract document: `@core/brand` is the white-label
 * surface every user-facing product mention flows through, and the Product Hub
 * OS spec maps this product to its client-facing name there. Changing that one
 * constant re-labels the whole admin, including this row.
 */
function HubContextControl({ hubBaseUrl }: { hubBaseUrl: string | null }) {
  const content = (
    <>
      <span className={styles.contextPrimary}>{HUB_LABEL}</span>
      <FaIcon name="chevron-right" size={10} className={styles.contextCaret} />
      <span className={styles.contextSecondary}>{BRAND_NAME}</span>
    </>
  )

  // Without a Hub there is nowhere for this control to go, so it renders as a
  // label instead of a dead affordance.
  if (!hubBaseUrl) {
    return (
      <span className={styles.context} data-testid="hub-header-context">
        {content}
      </span>
    )
  }

  return (
    <a
      className={styles.context}
      href={hubLinkHref(hubBaseUrl, '/hub')}
      data-testid="hub-header-context"
    >
      {content}
    </a>
  )
}

/**
 * Compact-width menu: the role-scoped Hub navigation plus the utilities that
 * leave the bar below the 1100px tier (Help, Theme, Settings).
 *
 * Row 2's own overflow is separate and must stay separate — the contract
 * forbids merging the specialist navigation into this menu, and forbids
 * repeating any utility across the two.
 */
function CompactHubMenu() {
  const hubContext = useHubContext()
  const openSettings = useAdminUi((s) => s.openSettings)
  const spotlight = useContext(SpotlightContext)
  const theme = useEditorSelectPreference('theme')
  const isDark = theme === 'dark'
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
            disabled={spotlight === null}
            onClick={() => {
              close()
              spotlight?.open()
              spotlight?.pushScope('help')
            }}
          >
            <FaIcon name="circle-question" size={12} />
            <span>Help</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              close()
              setEditorSelectPreference('theme', isDark ? 'light' : 'dark')
            }}
          >
            <FaIcon name={isDark ? 'sun' : 'moon'} size={12} />
            <span>{isDark ? 'Light theme' : 'Dark theme'}</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              close()
              openSettings('general')
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
