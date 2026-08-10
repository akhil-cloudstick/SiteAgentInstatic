/**
 * DataMobileDock — the approved screen's narrow-viewport bottom dock.
 *
 * Below 1100px the Data Workbench stops being a three-column workspace and
 * becomes records-first: the grid takes the whole viewport and the two side
 * panels become labelled drawers behind a three-button dock —
 * Tables · Records · Details/Schema.
 *
 * The third label tracks what the inspector is actually showing, exactly as
 * the reference does: "Details" with a row selected, "Schema" without one.
 *
 * The dock is always mounted and hidden by CSS above 1100px, so there is no
 * width-dependent mount/unmount flicker while resizing. The drawers themselves
 * are mounted by `DataPage` only while open, and host the SAME components as
 * the desktop columns — not narrow re-implementations — so behaviour,
 * permissions and state stay identical at every width.
 */
import type { ReactElement } from 'react'
import { Button } from '@ui/components/Button'
import { DatabaseSolidIcon, ListBoxSolidIcon, Settings2SolidIcon } from '@admin/pages/data/icons'
import styles from './DataMobileDock.module.css'

export type DataMobilePanel = 'tables' | 'inspector'

interface DataMobileDockProps {
  active: DataMobilePanel | null
  onChange: (panel: DataMobilePanel | null) => void
  /** 'Details' when a row is selected, 'Schema' otherwise. */
  inspectorLabel: string
}

export function DataMobileDock({
  active,
  onChange,
  inspectorLabel,
}: DataMobileDockProps): ReactElement {
  return (
    <nav className={styles.dock} aria-label="Data workspace panels" data-testid="data-mobile-dock">
      <Button
        variant="ghost"
        className={styles.dockButton}
        data-active={active === 'tables' ? 'true' : undefined}
        pressed={active === 'tables'}
        onClick={() => onChange(active === 'tables' ? null : 'tables')}
      >
        <ListBoxSolidIcon size={16} aria-hidden="true" />
        <span className={styles.dockLabel}>Tables</span>
      </Button>

      <Button
        variant="ghost"
        className={styles.dockButton}
        data-active={active === null ? 'true' : undefined}
        pressed={active === null}
        onClick={() => onChange(null)}
      >
        <DatabaseSolidIcon size={16} aria-hidden="true" />
        <span className={styles.dockLabel}>Records</span>
      </Button>

      <Button
        variant="ghost"
        className={styles.dockButton}
        data-active={active === 'inspector' ? 'true' : undefined}
        pressed={active === 'inspector'}
        onClick={() => onChange(active === 'inspector' ? null : 'inspector')}
      >
        <Settings2SolidIcon size={16} aria-hidden="true" />
        <span className={styles.dockLabel}>{inspectorLabel}</span>
      </Button>
    </nav>
  )
}
