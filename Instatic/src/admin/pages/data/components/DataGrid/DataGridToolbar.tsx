/**
 * DataGridToolbar — the single header row above the grid card.
 *
 * Search box on the left; the status/scope view chips (publish-workflow
 * tables only) plus an active-sort indicator on the right. The table title,
 * row-count and create action live in the workbench header above the card
 * (see `DataWorkbenchHeader`), so the card itself reads as just the data.
 */
import type { ReactElement } from 'react'
import { Button } from '@ui/components/Button'
import { SearchBar } from '@ui/components/SearchBar'
import { ArrowDownIcon } from '@admin/pages/data/icons'
import { DataGridViewChips } from './DataGridViewChips'
import type {
  SortState,
  StatusCounts,
  StatusFilter,
  StatusViewChip,
} from './dataGridRows'
import styles from './DataGrid.module.css'

interface DataGridToolbarProps {
  query: string
  onQueryChange: (q: string) => void
  hasPublishWorkflow: boolean
  statusViewOrder: StatusViewChip[]
  statusFilter: StatusFilter
  onStatusFilterChange: (key: StatusFilter) => void
  statusCounts: StatusCounts
  sort: SortState | null
  /** Human label of the active sort field, or null when unsorted. */
  sortLabel: string | null
  onClearSort: () => void
}

export function DataGridToolbar({
  query,
  onQueryChange,
  hasPublishWorkflow,
  statusViewOrder,
  statusFilter,
  onStatusFilterChange,
  statusCounts,
  sort,
  sortLabel,
  onClearSort,
}: DataGridToolbarProps): ReactElement {
  return (
    <div className={styles.toolbar}>
      <div className={styles.searchWrap}>
        <SearchBar
          value={query}
          onValueChange={onQueryChange}
          placeholder="Search…"
          aria-label="Search"
        />
      </div>

      <span className={styles.toolbarSpacer} />

      {hasPublishWorkflow && (
        <DataGridViewChips
          views={statusViewOrder}
          active={statusFilter}
          counts={statusCounts}
          onSelect={onStatusFilterChange}
        />
      )}

      {sort != null && sortLabel && (
        <Button
          variant="ghost"
          size="sm"
          shape="pill"
          className={styles.sortIndicator}
          onClick={onClearSort}
          aria-label={`Sorted by ${sortLabel} ${sort.dir === 'asc' ? 'ascending' : 'descending'} — click to clear`}
          tooltip="Clear sort"
        >
          <span className={styles.sortArrow} data-dir={sort.dir} aria-hidden="true">
            <ArrowDownIcon size={10} />
          </span>
          <span>{sortLabel}</span>
        </Button>
      )}
    </div>
  )
}
