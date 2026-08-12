import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'
import styles from './Separator.module.css'

interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical'
  decorative?: boolean
  spacing?: 'none' | 'compact' | 'normal'
}

/** `forwardRef` so this primitive works on React 18 and 19 alike — see Button. */
export const Separator = forwardRef<HTMLDivElement, SeparatorProps>(function Separator(
  { orientation = 'horizontal', decorative = true, spacing = 'normal', className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      role={decorative ? undefined : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      aria-hidden={decorative ? true : undefined}
      data-orientation={orientation}
      data-spacing={spacing}
      className={cn(styles.separator, className)}
      {...props}
    />
  )
})
