import type { CSSProperties } from 'react'
import { cn } from '@ui/cn'
import styles from './RemixIcon.module.css'

interface RemixIconProps {
  /**
   * Remix Icon glyph name WITHOUT the `ri-` prefix, e.g. `arrow-right-line`.
   * The full glyph set is defined in `src/styles/remixicon/remixicon.css`.
   */
  name: string
  /** Pixel size for the glyph box (font-size + width/height). Defaults to 16. */
  size?: number
  className?: string
  /**
   * When provided, the icon is exposed to assistive tech as an image with this
   * label; otherwise it is `aria-hidden` (decorative, paired with a text label).
   */
  'aria-label'?: string
}

/**
 * RemixIcon — the shared line-icon primitive (Remix Icon webfont).
 *
 * Renders `<i class="ri-NAME">`; the glyph comes from the vendored
 * `remixicon` webfont. Sizing flows through a `--ri-size` custom property so
 * the module owns the box geometry (no inline styles beyond the dynamic var).
 */
export function RemixIcon({ name, size = 16, className, 'aria-label': ariaLabel }: RemixIconProps) {
  return (
    <i
      className={cn(styles.icon, `ri-${name}`, className)}
      style={{ '--ri-size': `${size}px` } as CSSProperties}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
    />
  )
}
