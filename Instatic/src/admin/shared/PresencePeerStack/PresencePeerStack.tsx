/**
 * PresencePeerStack — the overlapping avatars of everyone else currently in
 * this workspace, at the left edge of the header's action group.
 *
 * Geometry is the approved MMSBUILD Site screen's `.peer-stack`: 31px circles
 * overlapping by 9px, each ringed in the header's own background so the stack
 * reads as depth rather than as touching discs.
 *
 * Renders nothing when you are alone. The reference composite shows two
 * collaborators because its author staged two; an empty roster is the honest
 * state and an empty stack is better than a placeholder that implies company.
 */
import { UserAvatar } from '@admin/shared/UserAvatar'
import type { PresencePeer } from '@core/presence'
import styles from './PresencePeerStack.module.css'

/** Beyond this the stack stops growing and the remainder becomes a "+N" chip. */
const MAX_VISIBLE = 3

interface PresencePeerStackProps {
  peers: PresencePeer[]
}

export function PresencePeerStack({ peers }: PresencePeerStackProps) {
  if (peers.length === 0) return null

  const visible = peers.slice(0, MAX_VISIBLE)
  const overflow = peers.length - visible.length
  const names = peers.map((peer) => peer.displayName).join(', ')

  return (
    <div
      className={styles.stack}
      data-testid="presence-peer-stack"
      // One label for the group; the avatars themselves are decorative, so a
      // screen reader hears "2 collaborators: Mira, Noah" instead of two
      // unexplained images.
      role="img"
      aria-label={`${peers.length} ${peers.length === 1 ? 'collaborator' : 'collaborators'} active: ${names}`}
    >
      {visible.map((peer) => (
        <UserAvatar
          key={peer.userId}
          className={styles.peer}
          size={31}
          alt={null}
          user={{
            avatarUrl: peer.avatarUrl,
            gravatarHash: peer.gravatarHash,
            displayName: peer.displayName,
            // Presence never carries email addresses; initials come from the
            // display name, which is always present.
            email: '',
          }}
        />
      ))}
      {overflow > 0 && <span className={styles.overflow} aria-hidden="true">+{overflow}</span>}
    </div>
  )
}
