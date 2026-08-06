/**
 * guidedCssControls — the approved Site screen's "Guided CSS controls".
 *
 * Responsive review does not show the raw CSS workbench. It shows five named
 * controls (`screens/site/src/App.jsx` → `ResponsiveInspector`) that each stand
 * for one real CSS declaration, so an author can make the common responsive
 * decisions without learning the property names:
 *
 *   Content width   → `maxWidth`      Full / Contained
 *   Text alignment  → `textAlign`     left / center / right
 *   Image position  → `objectPosition` the four crops the reference offers
 *   Section height  → `minHeight`     Tall (700px) / Medium (560px) / Content
 *
 * (The fifth, "Editing context", is the breakpoint switcher and is not a CSS
 * declaration — it lives in the review body.)
 *
 * Each control declares its own value set rather than deriving one from
 * `cssControlTypes`, because the reference's labels ARE the product copy — a
 * generic enum picker would print `700px` where the screen says `Tall (700 px)`.
 * Reading and writing still go through the same `CSSPropertyBag` the workbench
 * edits, so a value set here shows up in the raw rows and vice versa.
 */
import type { CSSPropertyBag } from '@core/page-tree'
import type { SegmentOption } from './inspector'

/** A guided control: one CSS property, a fixed value set, reference copy. */
export interface GuidedCssControl<T extends string = string> {
  /** Stable key for the field's `propKey` / test id. */
  id: string
  /** The reference's field label. */
  label: string
  /** The CSS property this control writes. */
  property: keyof CSSPropertyBag
  /** The reference's option set, in its order. */
  options: ReadonlyArray<SegmentOption<T>>
  /** Value written for each option id. */
  values: Record<T, string>
  /** Rendered as a native select rather than a segmented picker. */
  asSelect?: boolean
}

const CONTENT_WIDTH: GuidedCssControl<'full' | 'contained'> = {
  id: 'content-width',
  label: 'Content width',
  property: 'maxWidth',
  options: [
    { value: 'full', label: 'Full' },
    { value: 'contained', label: 'Contained' },
  ],
  values: { full: 'none', contained: '1200px' },
}

const TEXT_ALIGNMENT: GuidedCssControl<'left' | 'center' | 'right'> = {
  id: 'text-alignment',
  label: 'Text alignment',
  property: 'textAlign',
  options: [
    { value: 'left', glyph: 'align-left', ariaLabel: 'Align text left' },
    { value: 'center', glyph: 'align-center', ariaLabel: 'Align text center' },
    { value: 'right', glyph: 'align-right', ariaLabel: 'Align text right' },
  ],
  values: { left: 'left', center: 'center', right: 'right' },
}

/**
 * The reference labels these only by glyph and position ("Image position 1…4").
 * They map to the four crops its Hero offers, which is `object-position`.
 */
const IMAGE_POSITION: GuidedCssControl<'center' | 'top' | 'bottom' | 'cover'> = {
  id: 'image-position',
  label: 'Image position',
  property: 'objectPosition',
  options: [
    { value: 'center', glyph: 'image', ariaLabel: 'Image position 1' },
    { value: 'top', glyph: 'object-group', ariaLabel: 'Image position 2' },
    { value: 'bottom', glyph: 'panorama', ariaLabel: 'Image position 3' },
    { value: 'cover', glyph: 'images', ariaLabel: 'Image position 4' },
  ],
  values: {
    center: 'center center',
    top: 'center top',
    bottom: 'center bottom',
    cover: 'left center',
  },
}

const SECTION_HEIGHT: GuidedCssControl<'tall' | 'medium' | 'auto'> = {
  id: 'section-height',
  label: 'Section height',
  property: 'minHeight',
  options: [
    { value: 'tall', label: 'Tall (700 px)' },
    { value: 'medium', label: 'Medium (560 px)' },
    { value: 'auto', label: 'Content height' },
  ],
  values: { tall: '700px', medium: '560px', auto: 'auto' },
  asSelect: true,
}

/** The Layout tab's controls, in the reference's order. */
export const GUIDED_LAYOUT_CONTROLS: ReadonlyArray<GuidedCssControl> = [
  CONTENT_WIDTH as GuidedCssControl,
  TEXT_ALIGNMENT as GuidedCssControl,
  IMAGE_POSITION as GuidedCssControl,
  SECTION_HEIGHT as GuidedCssControl,
]

/**
 * The properties the guided controls own. Passed to the raw sections as
 * `excludeProperties` so `maxWidth` is not also a "Max width" row under Size
 * while "Content width" is editing it two fields above.
 */
export const GUIDED_PROPERTIES: ReadonlyArray<keyof CSSPropertyBag> =
  GUIDED_LAYOUT_CONTROLS.map((control) => control.property)

/**
 * Which option a control is currently on, or `undefined` when the stored value
 * matches none of them — the segmented picker then shows nothing pressed, which
 * is the honest state for a hand-written CSS value the guided set can't express.
 */
export function activeGuidedOption(
  control: GuidedCssControl,
  styles: Record<string, unknown>,
): string | undefined {
  const current = styles[control.property as string]
  if (typeof current !== 'string') return undefined
  return Object.keys(control.values).find((key) => control.values[key] === current)
}
