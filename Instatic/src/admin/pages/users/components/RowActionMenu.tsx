/**
 * RowActionMenu — overflow menu for a roster or workbench row.
 *
 * Renders the approved screen's `.row-menu-trigger` (a bordered square with a
 * vertical ellipsis) and toggles the shared portalled `ContextMenu`. Each item
 * fires its `onSelect` and the menu auto-closes. If `items` is empty the menu
 * is omitted entirely — the owner row has no actions, and an empty trigger
 * would read as a disabled affordance rather than an absent one.
 *
 * The menu is portalled to `document.body`, which lands it OUTSIDE the element
 * carrying `data-editor-screen="users"` — so the caller passes `scoped` to
 * re-stamp the scope on the menu and keep it on this screen's palette.
 */
import { useRef, useState } from 'react'
import { Button } from '@ui/components/Button'
import { ContextMenu, ContextMenuItem } from '@ui/components/ContextMenu'
import { FaIcon } from '@ui/components/FaIcon'
import type { RowActionMenuItem } from '../types'

interface RowActionMenuProps {
  triggerLabel: string
  menuLabel: string
  disabled: boolean
  items: RowActionMenuItem[]
  /** Sizes the trigger to the reference's 48px square. */
  triggerClassName?: string
  /** Applied to the portalled menu so it keeps the Users palette. */
  menuClassName?: string
}

export function RowActionMenu({
  triggerLabel,
  menuLabel,
  disabled,
  items,
  triggerClassName,
  menuClassName,
}: RowActionMenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  if (items.length === 0) return null

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        size="sm"
        iconOnly
        className={triggerClassName}
        disabled={disabled}
        active={open}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <FaIcon name="ellipsis-vertical" size={15} />
      </Button>
      {open && (
        <ContextMenu
          ariaLabel={menuLabel}
          onClose={() => setOpen(false)}
          anchorRef={triggerRef}
          side="bottom"
          align="end"
          width={190}
          menuClassName={menuClassName}
        >
          {items.map((item) => (
            <ContextMenuItem
              key={item.label}
              danger={item.danger}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </ContextMenuItem>
          ))}
        </ContextMenu>
      )}
    </>
  )
}
