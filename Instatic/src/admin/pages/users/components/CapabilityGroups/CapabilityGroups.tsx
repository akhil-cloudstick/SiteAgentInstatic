/**
 * CapabilityGroups — the workbench's inline capability accordion.
 *
 * The approved screen replaces the old modal capability picker with eleven
 * collapsible groups inside the role editor: a header row per group carrying
 * its glyph, an `k of m` count and a Select/Clear shortcut, and one checkbox
 * row per capability when open.
 *
 * Grouping and membership come from `../../utils/capabilities`, which is the
 * SAME `CAPABILITY_GROUPS` the shared `CapabilityPicker` (MCP connector
 * dialog) reads. `capability-picker-coverage.test.ts` asserts every
 * `CoreCapability` lives in exactly one group and has a meta entry — this
 * component may reorder or restyle, never drop.
 *
 * Labels and descriptions are this CMS's real ones from `CAPABILITY_META`,
 * not the reference's. The reference describes a fictional capability set
 * (`media.upload`, `pages.manage`); ours describe the permission that is
 * actually granted, and mislabelling a permission is a correctness bug, not a
 * styling choice. Documented as a deliberate deviation.
 */
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { FaIcon } from '@ui/components/FaIcon'
import { CAPABILITY_META } from '@admin/shared/CapabilityPicker'
import type { CoreCapability } from '@core/capabilities'
import { cn } from '@ui/cn'
import { CAPABILITY_GROUPS } from '../../utils/capabilities'
import styles from './CapabilityGroups.module.css'

/** Group glyph, in `CAPABILITY_GROUPS` order. */
const GROUP_ICONS: Record<string, string> = {
  'Dashboard': 'table-cells-large',
  'Site': 'window-restore',
  'Pages': 'file-lines',
  'Content': 'pen',
  'Data': 'database',
  'Media': 'image',
  'Runtime & storage': 'server',
  'Plugins': 'puzzle-piece',
  'AI': 'wand-magic-sparkles',
  'Users & Roles': 'user-group',
  'Audit': 'shield-halved',
}

/** `''` = all collapsed, `'all'` = all expanded, otherwise one group title. */
export type ExpandedGroup = string

interface CapabilityGroupsProps {
  selected: string[]
  /** Filters both group titles and individual capability labels. */
  search: string
  expanded: ExpandedGroup
  readonly: boolean
  onExpandedChange: (next: ExpandedGroup) => void
  onChange: (next: string[]) => void
}

function matchesSearch(title: string, capabilities: readonly CoreCapability[], query: string): boolean {
  if (!query) return true
  if (title.toLowerCase().includes(query)) return true
  return capabilities.some((capability) => {
    const meta = CAPABILITY_META[capability]
    return `${meta.label} ${meta.description}`.toLowerCase().includes(query)
  })
}

export function CapabilityGroups({
  selected,
  search,
  expanded,
  readonly,
  onExpandedChange,
  onChange,
}: CapabilityGroupsProps) {
  const chosen = new Set(selected)
  const query = search.trim().toLowerCase()
  const visibleGroups = CAPABILITY_GROUPS.filter((group) =>
    matchesSearch(group.title, group.capabilities, query),
  )

  function toggleCapability(capability: CoreCapability): void {
    const next = new Set(chosen)
    if (next.has(capability)) next.delete(capability)
    else next.add(capability)
    onChange([...next])
  }

  function toggleGroup(capabilities: readonly CoreCapability[], selectAll: boolean): void {
    const next = new Set(chosen)
    for (const capability of capabilities) {
      if (selectAll) next.add(capability)
      else next.delete(capability)
    }
    onChange([...next])
  }

  if (visibleGroups.length === 0) {
    return (
      <div className={styles.noMatches}>
        <strong>No matching capabilities</strong>
        <p>Change the search to see other capability groups.</p>
      </div>
    )
  }

  return (
    <div className={styles.groups}>
      {visibleGroups.map((group) => {
        const total = group.capabilities.length
        const count = group.capabilities.filter((capability) => chosen.has(capability)).length
        const isOpen = expanded === 'all' || expanded === group.title
        const allSelected = count === total
        return (
          <section key={group.title} className={cn(styles.group, isOpen && styles.groupOpen)}>
            <header className={styles.groupHeader}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                align="start"
                className={styles.groupToggle}
                aria-expanded={isOpen}
                onClick={() => onExpandedChange(isOpen ? '' : group.title)}
              >
                <FaIcon name={GROUP_ICONS[group.title] ?? 'shield-halved'} size={15} />
                <strong>{group.title}</strong>
              </Button>

              <span className={styles.groupCount}>{count} of {total}</span>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={styles.groupShortcut}
                disabled={readonly}
                aria-label={
                  allSelected
                    ? `Clear ${group.title} capabilities`
                    : `Select all ${group.title} capabilities`
                }
                onClick={() => toggleGroup(group.capabilities, !allSelected)}
              >
                <span>{allSelected ? 'Clear group' : 'Select group'}</span>
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconOnly
                className={styles.groupChevron}
                aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${group.title}`}
                onClick={() => onExpandedChange(isOpen ? '' : group.title)}
              >
                <FaIcon name={isOpen ? 'chevron-up' : 'chevron-down'} size={11} />
              </Button>
            </header>

            {isOpen && (
              <div className={styles.rows}>
                {group.capabilities.map((capability) => {
                  const meta = CAPABILITY_META[capability]
                  return (
                    <label key={capability} className={styles.row}>
                      <Checkbox
                        checked={chosen.has(capability)}
                        disabled={readonly}
                        onCheckedChange={() => toggleCapability(capability)}
                      />
                      <strong>{meta.label}</strong>
                      <small>{meta.description}</small>
                    </label>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
