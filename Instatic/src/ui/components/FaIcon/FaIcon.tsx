import type { CSSProperties } from 'react'
import { cn } from '@ui/cn'
import styles from './FaIcon.module.css'

interface FaIconProps {
  /**
   * Font Awesome Solid glyph name WITHOUT the `fa-` prefix, e.g. `pen`,
   * `circle-check`, `mobile-screen-button`. The full glyph set is defined
   * in `src/styles/fontawesome/fontawesome-solid.css`.
   */
  name: string
  /** Pixel size for the glyph. Defaults to 16. */
  size?: number
  className?: string
  /**
   * When provided, the icon is exposed to assistive tech as an image with
   * this label; otherwise it is `aria-hidden` (decorative, paired with a
   * text label).
   */
  'aria-label'?: string
}

/**
 * FaIcon — Font Awesome Solid glyph primitive.
 *
 * Renders `<i class="fa-solid fa-NAME">`; the glyph comes from the
 * vendored `fa-solid-900` webfont. This exists ONLY because the approved
 * MMSBUILD Dashboard screen is drawn in Font Awesome Solid and the
 * acceptance bar for that screen is identical glyphs — everywhere else in
 * the admin, keep using `RemixIcon` / the `pixel-art-icons` components.
 *
 * Sizing flows through a `--fa-size` custom property so the module owns
 * the box geometry (no inline styles beyond the dynamic var).
 */
export function FaIcon({ name, size = 16, className, 'aria-label': ariaLabel }: FaIconProps) {
  return (
    <i
      className={cn(styles.icon, 'fa-solid', `fa-${name}`, className)}
      style={{ '--fa-size': `${size}px` } as CSSProperties}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
    />
  )
}
