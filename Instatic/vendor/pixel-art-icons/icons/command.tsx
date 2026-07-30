import type { IconProps } from '../types'

// Remix Icon glyph "ri-command-line" (MMS Design System line-icon set). Rendered as a
// webfont <i>; the pixel-art-icons specifier is retained so existing imports and
// the IconComponent contract keep resolving unchanged.
export function CommandIcon({ size = 24, color = 'currentColor', className, style }: IconProps) {
  return (
    <i
      className={`ri-command-line${className ? ' ' + className : ''}`}
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
