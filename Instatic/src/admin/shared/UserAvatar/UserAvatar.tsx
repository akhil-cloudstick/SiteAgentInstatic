/**
 * UserAvatar — circular avatar with `<img>` rendering and an initials
 * fallback. Used everywhere a user identity surfaces in the admin shell
 * (toolbar trigger, Account → Profile, account dropdown header).
 *
 * Rendering precedence:
 *   1. Uploaded avatar image (`user.avatarUrl`)
 *   2. Gravatar identicon URL built from `user.gravatarHash` (always exists
 *      for authenticated users, deterministic per email)
 *   3. Initials letter circle (final fallback, used when the image fails to
 *      load — `<img onError>` flips the state — or both URLs are absent)
 *
 * The size in CSS pixels is the only knob callers need to set. We hand it
 * through to `gravatarUrl` so Gravatar serves an appropriately-sized image
 * (with a 2× factor for retina), and to the CSS module via the
 * `--avatar-size` custom property so border radius, font size, and box
 * dimensions all derive from one source of truth.
 */
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { CmsCurrentUser } from '@core/persistence'
import { resolveAvatarUrl } from '@core/users/avatar'
import { cn } from '@ui/cn'
import styles from './UserAvatar.module.css'

interface UserAvatarProps {
  user: Pick<CmsCurrentUser, 'avatarUrl' | 'gravatarHash' | 'displayName' | 'email'>
  /** Rendered diameter in CSS pixels — must be > 0. */
  size: number
  /**
   * Optional accessible label. Defaults to `Avatar for <displayName | email>`
   * — pass null to mark the avatar as decorative when there's a separate
   * label already (e.g. inside a labelled button).
   */
  alt?: string | null
  className?: string
  /**
   * Skip the uploaded / Gravatar image and always render the initials fallback.
   * Used by the toolbar account trigger, which shows the identity-green initials
   * rather than a photo so the avatar reads as the account anchor.
   */
  initialsOnly?: boolean
  /**
   * How many initials the fallback draws. Defaults to 2 ("Akhil Joshy" → "AK").
   * The approved Team Access roster draws a single letter on a tinted disc, so
   * that screen passes 1.
   */
  maxInitials?: 1 | 2
}

/**
 * Up to two initials: the first letter of the first two name words
 * (e.g. "Akhil Joshy" → "AK"), or the first two characters of a single-word
 * name / email local-part (e.g. "admin@…" → "AD"). Always uppercased.
 */
function deriveInitials(
  user: { displayName: string; email: string },
  maxInitials: 1 | 2,
): string {
  const source = (user.displayName.trim() || user.email).trim()
  if (!source) return '?'
  if (maxInitials === 1) return source.charAt(0).toUpperCase()
  const words = source.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    const first = words[0]?.charAt(0) ?? ''
    const second = words[1]?.charAt(0) ?? ''
    return (first + second).toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

export function UserAvatar({
  user,
  size,
  alt,
  className,
  initialsOnly = false,
  maxInitials = 2,
}: UserAvatarProps): ReactNode {
  const [imageFailed, setImageFailed] = useState(false)
  const url = resolveAvatarUrl(user, { size })
  const showImage = url !== null && !imageFailed && !initialsOnly
  const displayName = user.displayName.trim() || user.email
  const altText = alt === null ? '' : alt ?? `Avatar for ${displayName}`

  const style: CSSProperties = { '--avatar-size': `${size}px` } as CSSProperties

  return (
    <span className={cn(styles.root, className)} style={style} aria-hidden={alt === null || undefined}>
      {showImage ? (
        <img
          className={styles.image}
          src={url}
          alt={altText}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className={styles.initials}>{deriveInitials(user, maxInitials)}</span>
      )}
    </span>
  )
}
