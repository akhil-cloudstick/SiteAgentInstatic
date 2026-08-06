/**
 * SlotContentList — the approved Site screen's "Slot content · <slot>" list.
 *
 * The reference draws one row per slot child: a reorder grip, a thumbnail, the
 * child's name and a destructive delete, followed by an "Insert …" CTA. Those
 * children are ORDINARY page-tree nodes living under a `base.slot-instance`
 * (see `syncSlotInstances`), so every affordance here routes through the same
 * store actions the canvas and Layers tree use — `moveNode`, `deleteNode`,
 * `insertNode` — rather than a bespoke slot mutation.
 *
 * Permissions map the reference's `canStructure = role !== "client"` onto
 * `canEditStructure`: the grip renders DISABLED (the reference keeps it visible
 * so the row geometry does not shift), and the delete and insert affordances
 * are not rendered at all.
 */
import { selectActiveCanvasPage, useEditorStore } from '@site/store/store'
import { registry } from '@core/module-engine'
import { getNodeDisplayName, type PageNode } from '@core/page-tree'
import { useEditorPermissions } from '@site/editorPermissionsContext'
import { moduleGlyph } from '@site/moduleGlyph'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import styles from './Inspector.module.css'

/** Props that commonly hold a child's preview image, in resolution order. */
const THUMBNAIL_PROP_KEYS = ['src', 'image', 'imageUrl', 'backgroundImage', 'poster'] as const

interface SlotContentListProps {
  /** The `base.slot-instance` node whose children fill the slot. */
  slotInstanceId: string
  /** Module id inserted by the "Insert …" CTA — the slot's own child default. */
  insertModuleId: string
  /** CTA copy, e.g. `Insert service card`. */
  insertLabel: string
}

function thumbnailUrl(node: PageNode): string | null {
  for (const key of THUMBNAIL_PROP_KEYS) {
    const value = node.props[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

export function SlotContentList({
  slotInstanceId,
  insertModuleId,
  insertLabel,
}: SlotContentListProps) {
  const permissions = useEditorPermissions()
  const page = useEditorStore(selectActiveCanvasPage)
  const visualComponents = useEditorStore((s) => s.site?.visualComponents)
  const moveNode = useEditorStore((s) => s.moveNode)
  const deleteNode = useEditorStore((s) => s.deleteNode)
  const insertNode = useEditorStore((s) => s.insertNode)
  const selectNode = useEditorStore((s) => s.selectNode)

  const slotInstance = page?.nodes[slotInstanceId]
  if (!slotInstance) return null

  const childIds = slotInstance.children
  const canStructure = permissions.canEditStructure

  return (
    <>
      <div className={styles.slotList} role="list">
        {childIds.map((childId, index) => {
          const child = page?.nodes[childId]
          if (!child) return null
          const name = getNodeDisplayName(child, registry.get(child.moduleId), visualComponents)
          const thumbnail = thumbnailUrl(child)

          return (
            <div key={childId} className={styles.slotRow} role="listitem">
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                className={styles.slotGrip}
                // The first row has nothing to move ahead of, exactly as the
                // reference's `moveEarlier` no-ops at index 0.
                disabled={!canStructure || index === 0}
                aria-label={`Move ${name} earlier`}
                onClick={() => moveNode(childId, slotInstanceId, index - 1)}
              >
                <FaIcon name="grip-vertical" size={13} />
              </Button>

              {thumbnail ? (
                <img className={styles.slotThumb} src={thumbnail} alt="" />
              ) : (
                <span className={styles.slotThumb} aria-hidden="true">
                  <FaIcon name={moduleGlyph(child.moduleId, name)} size={13} />
                </span>
              )}

              <Button
                variant="ghost"
                size="xs"
                className={styles.slotLabel}
                onClick={() => selectNode(childId)}
              >
                {name}
              </Button>

              {canStructure && (
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  className={styles.slotDelete}
                  aria-label={`Delete ${name}`}
                  onClick={() => deleteNode(childId)}
                >
                  <FaIcon name="trash" size={13} />
                </Button>
              )}
            </div>
          )
        })}
      </div>

      {canStructure && (
        <Button
          variant="ghost"
          size="md"
          className={styles.addSlot}
          onClick={() => insertNode(insertModuleId, {}, slotInstanceId, childIds.length)}
        >
          <FaIcon name="plus" size={12} />
          <span>{insertLabel}</span>
        </Button>
      )}
    </>
  )
}
