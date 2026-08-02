import type { MouseEventHandler, ReactNode } from 'react'
import { EyeOffSolidIcon } from 'pixel-art-icons/icons/eye-off-solid'
import { TreeChevron, TreeIconSlot, TreeLabel, TreeLabelGroup } from '@site/ui/Tree'
import { FaIcon } from '@ui/components/FaIcon'
import { moduleGlyph } from '@site/sidebars/PageOutlinePanel/moduleGlyph'
import { TagPill } from '@ui/components/TagPill'
import styles from './TreeNode.module.css'

interface LayerTreeNodeContentProps {
  moduleId: string
  displayName: string
  htmlTag: string | null
  classSelectorChip: string | null
  hasChildren: boolean
  expanded: boolean
  showIcon: boolean
  showTag: boolean
  showClasses: boolean
  isRoot?: boolean
  locked?: boolean
  hidden?: boolean
  labelSlot?: ReactNode
  onToggle?: MouseEventHandler<HTMLSpanElement>
}

export function LayerTreeNodeContent({
  moduleId,
  displayName,
  htmlTag,
  classSelectorChip,
  hasChildren,
  expanded,
  showIcon,
  showTag,
  showClasses,
  isRoot = false,
  locked = false,
  hidden = false,
  labelSlot,
  onToggle,
}: LayerTreeNodeContentProps) {
  return (
    <>
      <TreeChevron
        onClick={onToggle}
        expanded={expanded}
        visible={hasChildren && !isRoot}
      />

      {showIcon && (
        // The SAME glyph resolution the Page outline uses (`moduleGlyph`), at
        // the reference's 15px in `currentColor`. The module registry's own
        // icon is the generic square the old dev tree drew — using it here is
        // what made a layer row look like a different component from the
        // outline row directly above it.
        <TreeIconSlot iconSize={15} iconColor="currentColor">
          <FaIcon name={moduleGlyph(moduleId, displayName)} size={15} />
        </TreeIconSlot>
      )}

      {labelSlot ?? (
        <TreeLabelGroup>
          {showTag && htmlTag && (
            <TagPill
              label={htmlTag}
              size="xs"
              monospace
              aria-hidden="true"
              className={styles.tagPill}
            />
          )}
          {/* The Site screen hides the tag pill (the approved row is icon +
              name), so the HTML tag travels in the tooltip instead of being
              dropped. */}
          {/* The Site screen hides the tag pill and class chip (the approved
              row is icon + name + `⋯`), so both travel in the tooltip rather
              than being dropped. */}
          <TreeLabel
            title={[displayName, htmlTag && `<${htmlTag}>`, classSelectorChip]
              .filter(Boolean)
              .join(' · ')}
          >
            {displayName}
          </TreeLabel>
          {showClasses && classSelectorChip && (
            <TagPill
              label={classSelectorChip}
              size="xs"
              monospace
              aria-hidden="true"
              className={styles.classChip}
            />
          )}
        </TreeLabelGroup>
      )}

      {locked && (
        <span title="Locked" aria-hidden="true" className={styles.indicator}>
          🔒
        </span>
      )}
      {hidden && (
        <span title="Hidden" aria-hidden="true" className={styles.hiddenIndicator}>
          <EyeOffSolidIcon size={13} color="currentColor" />
        </span>
      )}
    </>
  )
}
