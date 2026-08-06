/**
 * InspectorChrome — the approved Site screen's inspector furniture.
 *
 * One file for the small, stateless pieces the three mode bodies share:
 * the tab strip, the scrolling body, the component card and Visual-component
 * badge, the kicker/helper text, the "Open component in canvas" action, the
 * info/override notes and the Responsive review title row.
 *
 * Every value comes from `Inspector.module.css`, which is transcribed from
 * `screens/site/src/styles.css`. These wrap the shared primitives (`Button`,
 * `FaIcon`) rather than emitting bare elements — `button-primitive-usage`
 * requires it and the primitives already carry the focus-ring behaviour.
 */
import type { ReactNode } from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { cn } from '@ui/cn'
import styles from './Inspector.module.css'

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export interface InspectorTab<T extends string> {
  id: T
  label: string
}

interface InspectorTabsProps<T extends string> {
  tabs: ReadonlyArray<InspectorTab<T>>
  value: T
  onChange: (next: T) => void
  'aria-label': string
}

/**
 * `.inspector-tabs` — equal tracks across the full panel width, hairlines top
 * and bottom, and a 2px accent underline on the active tab inset 9px from each
 * edge. Rendered as a real tablist so the tabs are reachable by keyboard.
 */
export function InspectorTabs<T extends string>({
  tabs,
  value,
  onChange,
  'aria-label': ariaLabel,
}: InspectorTabsProps<T>) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          variant="ghost"
          size="xs"
          role="tab"
          aria-selected={value === tab.id}
          className={styles.tab}
          active={value === tab.id}
          data-testid={`inspector-tab-${tab.id}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Body + text
// ---------------------------------------------------------------------------

/** `.inspector-body` — the scrolling column every mode body fills. */
export function InspectorBody({ children }: { children: ReactNode }) {
  return <div className={styles.body}>{children}</div>
}

/** `.inspector-body > h3` — a group title such as "Instance parameters". */
export function InspectorGroupTitle({ children }: { children: ReactNode }) {
  return <h3 className={styles.groupTitle}>{children}</h3>
}

/** `.panel-kicker` — the muted 11px line above a guided field group. */
export function InspectorKicker({ children }: { children: ReactNode }) {
  return <p className={styles.kicker}>{children}</p>
}

/** `.helper` — the 9px footnote under a slot list. */
export function InspectorHelper({ children }: { children: ReactNode }) {
  return <p className={styles.helper}>{children}</p>
}

// ---------------------------------------------------------------------------
// Component card / badge / text action
// ---------------------------------------------------------------------------

interface ComponentCardProps {
  /** Font Awesome glyph for the component's module, without the `fa-` prefix. */
  glyph: string
  name: string
  /** e.g. `2 parameters · 1 content slot`. */
  summary: string
  onOpenInCanvas?: () => void
}

/** `.component-card` — the focused section's identity block. */
export function ComponentCard({ glyph, name, summary, onOpenInCanvas }: ComponentCardProps) {
  return (
    <div className={styles.componentCard}>
      <span className={styles.componentGlyph} aria-hidden="true">
        <FaIcon name={glyph} size={14} />
      </span>
      <span className={styles.componentMeta}>
        <span className={styles.componentName}>{name}</span>
        <small className={styles.componentCount}>{summary}</small>
        {onOpenInCanvas && (
          <OpenInCanvasAction onClick={onOpenInCanvas} />
        )}
      </span>
    </div>
  )
}

/** `.visual-badge` — "Visual component" on a selected component instance. */
export function VisualBadge() {
  return (
    <div className={styles.visualBadge}>
      <FaIcon name="gear" size={11} /> Visual component
    </div>
  )
}

/** `.text-action` — the underlined "Open component in canvas ↗" link. */
export function OpenInCanvasAction({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="xs" className={styles.textAction} onClick={onClick}>
      Open component in canvas <FaIcon name="arrow-up-right-from-square" size={11} />
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/** `.info-note` — the green-glyph footnote at the end of the Live body. */
export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <p className={styles.note}>
      <span className={styles.noteIcon}>
        <FaIcon name="circle-info" size={11} />
      </span>
      {children}
    </p>
  )
}

/**
 * `.override-note` — Responsive review's breakpoint-override state. Warm and
 * warning-glyphed while the selected layer has no overrides; green and
 * check-glyphed once it does.
 */
export function OverrideNote({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <p className={cn(styles.note, styles.overrideNote, active && styles.overrideActive)}>
      <span className={styles.noteIcon}>
        <FaIcon name={active ? 'circle-check' : 'circle-info'} size={11} />
      </span>
      {children}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Responsive review title
// ---------------------------------------------------------------------------

/** `.responsive-title` — node name plus the "Visual component" pill. */
export function ResponsiveTitle({ name, pill }: { name: string; pill?: string }) {
  return (
    <div className={styles.responsiveTitle}>
      <h3>{name}</h3>
      {pill && <span className={styles.responsivePill}>{pill}</span>}
    </div>
  )
}
