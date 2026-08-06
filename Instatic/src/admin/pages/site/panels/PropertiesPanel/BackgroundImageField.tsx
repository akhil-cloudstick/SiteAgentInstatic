/**
 * BackgroundImageField — a container's image, in "Instance parameters".
 *
 * The approved Site screen puts a "Hero image" field with a live preview and a
 * Replace-image button among the Hero's parameters. On a real page that image
 * is usually not a `base.image` node: a media/overlay band is a container
 * carrying a CSS `background-image`, so the selected layer's own schema is just
 * `HTML tag` and the picture is nowhere in sight — you have to know to dig into
 * the raw Background style section to find it.
 *
 * This promotes that one declaration to the top of the parameters for any node
 * that can have children, reusing `BackgroundImageControl` (which already wraps
 * the media library picker, asset thumbnails and the custom-URL fallback). It
 * is excluded from the raw Background section while promoted, so the value has
 * exactly one home.
 */
import { BackgroundImageControl } from '@site/property-controls/BackgroundImageControl'
import type { GuidedStyleTarget } from './useGuidedStyleTarget'

export function BackgroundImageField({ target }: { target: GuidedStyleTarget }) {
  const value = target.styles.backgroundImage

  return (
    <BackgroundImageControl
      propKey="backgroundImage"
      label="Background image"
      disabled={!target.editable}
      value={typeof value === 'string' ? value : ''}
      onChange={(_propKey, next) => target.setProperty('backgroundImage', String(next ?? ''))}
    />
  )
}
