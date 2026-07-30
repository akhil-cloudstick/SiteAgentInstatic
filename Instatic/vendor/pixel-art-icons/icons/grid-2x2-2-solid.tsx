import type { IconProps } from '../types'

// Remix Icon glyph "ri-layout-grid-line" (MMS Design System line-icon set). Rendered as a
// webfont <i>; the pixel-art-icons specifier is retained so existing imports and
// the IconComponent contract keep resolving unchanged.
export function Grid2x22SolidIcon({ size = 24, color = 'currentColor', className, style }: IconProps) {
  return (
    <i
      className={`ri-layout-grid-line${className ? ' ' + className : ''}`}
      aria-hidden="true"
      style={{
        fontSize: size,
        width: size,
        height: size,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color,
        ...style,
      }}
    />
  )
}
