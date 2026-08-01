/**
 * DataGridSkeleton — full DataGrid-shaped placeholder shown while
 * the table list is still loading (`loadingTables === true`), before
 * any specific table has been selected.
 *
 * Mirrors the chrome of `DataGrid.tsx` 1:1 — the rounded card surface,
 * the single-row toolbar (search placeholder + chip filter placeholders),
 * and the column-track skeleton grid — so the transition into the real
 * DataGrid (which has its own row-loading skeleton with the actual schema)
 * reads as a single continuous "loading" state, not two competing skeletons.
 *
 * Column count is generic (6 fields) because the table schema isn't
 * known yet. Once a table is selected, the real DataGrid takes over
 * with the live `orderedFields` ladder; the visual jump between the
 * two is tiny.
 */
import { type CSSProperties } from 'react'
import { Skeleton } from '@ui/components/Skeleton'
import { DataGridSkeletonRows } from './DataGridSkeletonRows'
import styles from './DataGrid.module.css'

const SKELETON_FIELD_COUNT = 6
const SKELETON_ROW_COUNT = 8

// Column-track template matching the real DataGrid:
//   [ checkbox 36px ] [ primary 220px ] [ ...fields 180px ] [ actions 1fr ]
const SKELETON_COLUMN_WIDTHS = [
  '36px',
  '220px',
  ...Array.from({ length: SKELETON_FIELD_COUNT - 1 }, () => '180px'),
  'minmax(min-content, 1fr)',
]

export function DataGridSkeleton() {
  const gridStyle = {
    '--data-grid-columns': SKELETON_COLUMN_WIDTHS.join(' '),
  } as CSSProperties

  const primaryStickyLeft: CSSProperties = { left: '36px' }
  const checkboxStickyLeft: CSSProperties = { left: '0' }

  return (
    <div className={styles.gridWrapper} aria-busy="true" aria-label="Loading data tables">
      {/* Toolbar — matches the real single-row `.toolbar`: search on the left,
          status/view chips on the right. */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <Skeleton width="100%" height={28} radius={6} />
        </div>
        <span className={styles.toolbarSpacer} />
        {/* Chip placeholders — three pills (All / Published / Drafts) is the
            common shape on post-types. */}
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton
            key={`chip-${i}`}
            width={64 + (i % 3) * 10}
            height={28}
            radius={999}
          />
        ))}
      </div>

      {/* Scrollable grid area */}
      <div className={styles.scrollContainer}>
        <div
          role="grid"
          className={styles.grid}
          style={gridStyle}
          aria-label="Loading data rows"
          aria-busy="true"
        >
          {/* Header row — matches the real DataGrid's column-header cells. */}
          <div role="row" className={styles.headerRow}>
            <div
              role="columnheader"
              className={styles.headerCell}
              data-sticky="checkbox"
              style={checkboxStickyLeft}
              aria-hidden="true"
            />
            <div
              role="columnheader"
              className={styles.headerCell}
              data-sticky="primary"
              style={primaryStickyLeft}
              aria-hidden="true"
            >
              <Skeleton width={64} height={10} />
            </div>
            {Array.from({ length: SKELETON_FIELD_COUNT - 1 }, (_, i) => (
              <div
                key={`header-${i}`}
                role="columnheader"
                className={styles.headerCell}
                aria-hidden="true"
              >
                <Skeleton width={48 + (i % 3) * 14} height={10} />
              </div>
            ))}
            <div
              role="columnheader"
              className={styles.headerCell}
              aria-hidden="true"
            />
          </div>

          {/* Skeleton rows — shared with the live `DataGrid`'s loading state
              so the column ladder + sticky positioning is identical. */}
          <DataGridSkeletonRows
            fieldCount={SKELETON_FIELD_COUNT - 1}
            rowCount={SKELETON_ROW_COUNT}
            primaryStickyLeft={primaryStickyLeft}
          />
        </div>
      </div>
    </div>
  )
}
