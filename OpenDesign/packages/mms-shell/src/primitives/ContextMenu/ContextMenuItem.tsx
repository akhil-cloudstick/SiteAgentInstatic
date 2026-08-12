import { forwardRef } from 'react'
import { Button, type ButtonProps } from '../Button'
import { Separator } from '../Separator'
import { cn } from '../../lib/cn'
import styles from './ContextMenu.module.css'

interface ContextMenuItemProps extends Omit<ButtonProps, 'variant' | 'size' | 'menuItem' | 'tone'> {
  danger?: boolean
}

/** `forwardRef` so this primitive works on React 18 and 19 alike — see Button. */
export const ContextMenuItem = forwardRef<HTMLButtonElement, ContextMenuItemProps>(
  function ContextMenuItem({ danger = false, className, children, ...props }, ref) {
    return (
      <Button
        ref={ref}
        variant="ghost"
        size="xs"
        menuItem
        role="menuitem"
        tone={danger ? 'danger' : 'default'}
        className={cn(styles.item, className)}
        {...props}
      >
        {children}
      </Button>
    )
  },
)

export function ContextMenuSeparator() {
  return <Separator spacing="compact" className={styles.separator} />
}
