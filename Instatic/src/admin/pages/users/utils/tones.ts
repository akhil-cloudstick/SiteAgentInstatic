/**
 * Tone selection for the Team Access roster.
 *
 * The approved screen colours two things categorically: the status/role chips
 * in the Access column, and the avatar disc behind a person's initials. Both
 * are identity cues, not decoration — a Client chip is violet on every screen
 * and every theme, so the mapping has to be deterministic rather than
 * position- or order-dependent.
 *
 * Pure: no React, no DOM, no API types beyond the persisted role shape.
 */
import type { AvatarTone, ChipTone } from '../types'

/**
 * Chip tone for a role pill.
 *
 * Owner and Admin both read blue in the reference — they are the two
 * administrative identities and share a tone; every other role (system or
 * custom) is violet. Matching on `slug` rather than `name` keeps a renamed
 * role on its tone.
 */
export function roleChipTone(role: { slug: string }): ChipTone {
  if (role.slug === 'owner') return 'owner'
  if (role.slug === 'admin') return 'admin'
  return 'role'
}

/** Active reads success, Suspended reads danger. */
export function statusChipTone(status: 'active' | 'suspended'): ChipTone {
  return status === 'active' ? 'success' : 'danger'
}

/** MFA on is a positive security signal; MFA off is neutral, not an error. */
export function mfaChipTone(mfaEnabled: boolean): ChipTone {
  return mfaEnabled ? 'success' : 'neutral'
}

const AVATAR_TONES: readonly AvatarTone[] = ['green', 'blue', 'violet', 'orange']

/**
 * Deterministic avatar tint from a stable identity string (the user id).
 *
 * FNV-1a — the same hash `@ui/railAccent` uses — so the same person keeps the
 * same disc across reloads, sorts and filter changes. A position-based tone
 * would visibly re-colour the roster every time a filter narrowed it.
 */
export function avatarTone(identity: string): AvatarTone {
  let hash = 0x811c9dc5
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length] ?? 'green'
}
