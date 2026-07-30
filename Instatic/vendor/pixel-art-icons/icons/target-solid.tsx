import type { IconProps } from '../types'

// Remix Icon glyph "ri-focus-3-line" (MMS Design System line-icon set). Rendered as a
// webfont <i>; the pixel-art-icons specifier is retained so existing imports and
// the IconComponent contract keep resolving unchanged.
export function TargetSolidIcon({ size = 24, color = 'currentColor', className, style }: IconProps) {
  return (
    <i
      className={`ri-focus-3-line${className ? ' ' + className : ''}`}
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
