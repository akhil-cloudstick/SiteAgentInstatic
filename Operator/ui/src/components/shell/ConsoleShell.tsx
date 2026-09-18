/**
 * ConsoleShell — the operator console's adapter for the shared MMS header.
 *
 * Both rows come from `@mms/shell`, the same component the MMS-CMS and
 * MMS-Design render; everything here is console wiring only — where Help goes,
 * who owns the theme, what the account control does, which tabs exist. Nothing
 * here decides how the rows LOOK; a visual change belongs in the shell so every
 * product gets it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  FaIcon,
  MmsShellHeader,
  MmsSpecialistRow,
  type ShellDestination,
  type ShellNotificationItem,
  type ShellTheme,
} from '@mms/shell'
import styles from './ConsoleShell.module.css'

export type ConsoleSection = 'org' | 'projects' | 'access' | 'mcp' | 'settings'
export type ScopeLevel = 'platform' | 'operator' | 'business'

export interface ConsoleShellProps {
  productName: string
  /** The console base with one trailing slash, e.g. `/operator/`. */
  base: string
  active: ConsoleSection
  admin: { email: string; level: ScopeLevel; scopeName: string | null }
  initialTheme: ShellTheme
  notifications: ShellNotificationItem[]
}

const READ_KEY = 'mms-operator:notifications-read'

function scopeLabel(level: ScopeLevel, name: string | null): string {
  if (level === 'platform') return 'Platform'
  const kind = level === 'operator' ? 'Operator' : 'Business'
  return name ? `${kind} · ${name}` : kind
}

function initials(email: string): string {
  const local = email.split('@')[0] ?? ''
  const parts = local.split(/[._-]+/).filter(Boolean)
  const letters = (parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : local.slice(0, 2)) || '?'
  return letters.toUpperCase()
}

function readIds(): string[] {
  try {
    const raw = window.localStorage.getItem(READ_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function applyTheme(theme: ShellTheme): void {
  document.documentElement.dataset.theme = theme
  // A cookie, so the server renders the next page in the same theme with no
  // flash; localStorage as the same preference for this browser.
  document.cookie = `sa_theme=${theme}; path=/operator; max-age=31536000; samesite=lax`
  try {
    window.localStorage.setItem('mms-operator:theme', theme)
  } catch {
    /* storage unavailable: the cookie still carries it */
  }
}

export function ConsoleShell({ productName, base, active, admin, initialTheme, notifications }: ConsoleShellProps) {
  const [theme, setTheme] = useState<ShellTheme>(initialTheme)
  const [helpOpen, setHelpOpen] = useState(false)
  const [read, setRead] = useState<string[]>([])

  useEffect(() => {
    setRead(readIds())
  }, [])

  const unreadCount = notifications.filter((n) => !read.includes(n.id)).length
  const isPlatform = admin.level === 'platform'

  const destinations: ShellDestination[] = [
    ...(admin.level !== 'business'
      ? [{ id: 'org', label: 'Organisation', icon: 'sitemap', href: `${base}org`, active: active === 'org' }]
      : []),
    { id: 'projects', label: 'Projects', icon: 'globe', href: `${base}projects`, active: active === 'projects' },
    { id: 'access', label: 'Access', icon: 'user-shield', href: `${base}access`, active: active === 'access' },
    { id: 'mcp', label: 'MCP Agents', icon: 'robot', href: `${base}mcp`, active: active === 'mcp' },
    ...(isPlatform
      ? [{ id: 'settings', label: 'Settings', icon: 'gear', href: `${base}settings`, active: active === 'settings' }]
      : []),
  ]

  return (
    <>
      <MmsShellHeader
        productLabel={productName}
        hubContext={null}
        theme={theme}
        onToggleTheme={() => {
          const next: ShellTheme = theme === 'dark' ? 'light' : 'dark'
          setTheme(next)
          applyTheme(next)
        }}
        help={{ onOpen: () => setHelpOpen(true) }}
        settings={{
          // Platform-wide configuration: platform administrators only.
          disabled: !isPlatform,
          onOpen: () => window.location.assign(`${base}settings`),
        }}
        notifications={{
          unreadCount,
          items: notifications,
          onOpen: () => {},
          onRead: () => {
            const ids = Array.from(new Set([...read, ...notifications.map((n) => n.id)]))
            setRead(ids)
            try {
              window.localStorage.setItem(READ_KEY, JSON.stringify(ids.slice(-200)))
            } catch {
              /* storage unavailable: unread again on the next page */
            }
          },
        }}
        accountSlot={<AccountMenu base={base} email={admin.email} scope={scopeLabel(admin.level, admin.scopeName)} />}
        brandTarget={{ href: base }}
      />
      <MmsSpecialistRow
        productName={productName}
        scope={[scopeLabel(admin.level, admin.scopeName)]}
        identityHref={base}
        destinations={destinations}
        navLabel={`${productName} navigation`}
        rowLabel={`${productName} console`}
      />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} base={base} showOrg={admin.level !== 'business'} />
    </>
  )
}

function AccountMenu({ base, email, scope }: { base: string; email: string; scope: string }): ReactNode {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="xs"
        type="button"
        active={open}
        aria-label={`Account menu for ${email}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${styles.trigger} mms-shell-avatar`}
        data-active={open ? 'true' : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {initials(email)}
      </Button>
      {/* Sign-out is a POST, so a plain link can never sign anyone out. */}
      <form ref={formRef} method="POST" action={`${base}logout`} hidden />
      {open && typeof document !== 'undefined' && createPortal(
        <ContextMenu
          ariaLabel="Account menu"
          onClose={() => setOpen(false)}
          anchorRef={triggerRef}
          side="bottom"
          align="end"
          width={250}
          zIndex={10000}
          closeOnScroll
        >
          <header className={styles.header}>
            <span className={styles.headerEmail}>{email}</span>
            <span className={styles.scopeBadge}>{scope}</span>
          </header>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => {
              setOpen(false)
              window.location.assign(`${base}access`)
            }}
          >
            <FaIcon name="user-shield" size={12} />
            <span>Console access</span>
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              setOpen(false)
              formRef.current?.submit()
            }}
          >
            <FaIcon name="power-off" size={12} />
            <span>Sign out</span>
          </ContextMenuItem>
        </ContextMenu>,
        document.body,
      )}
    </>
  )
}

const HELP_STEPS: Array<{ icon: string; title: string; body: string }> = [
  {
    icon: 'sitemap',
    title: 'Organisation',
    body: 'Create an operator (an agency), then the businesses it serves. A business with no operator sits directly under the platform.',
  },
  {
    icon: 'globe',
    title: 'Projects',
    body: 'Each website is a project inside a business. New project provisions the site and gives you the owner’s one-time invite link.',
  },
  {
    icon: 'users',
    title: 'People',
    body: 'Open a project’s People to invite its team. Publishers can publish; Authors edit content only; Viewers can look.',
  },
  {
    icon: 'user-shield',
    title: 'Access',
    body: 'Invite other console administrators, each limited to the platform, one operator or one business.',
  },
]

function HelpDialog({ open, onClose, base, showOrg }: { open: boolean; onClose: () => void; base: string; showOrg: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="mms-modal mms-modal--lg"
      aria-labelledby="console-help-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="mms-modal__head">
        <div>
          <p className="mms-eyebrow">Help</p>
          <h2 id="console-help-title">How the console fits together</h2>
        </div>
        <button type="button" className="mms-iconbtn" aria-label="Close" onClick={onClose}>
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </div>
      <div className="mms-modal__body">
        <ol className={styles.steps}>
          {HELP_STEPS.filter((s) => showOrg || s.title !== 'Organisation').map((step, i) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepIcon}>
                <i className={`fa-solid fa-${step.icon}`} aria-hidden="true" />
              </span>
              <div>
                <strong>
                  {i + 1}. {step.title}
                </strong>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="mms-modal__foot">
        <a className="mms-btn mms-btn--secondary" href={`${base}mcp/documentation`}>
          <i className="fa-solid fa-book" aria-hidden="true" />
          MCP documentation
        </a>
        <button type="button" className="mms-btn mms-btn--primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </dialog>
  )
}
