/**
 * Presence wire shapes — the one source of truth shared by the server
 * broadcaster and the admin client, exactly like `@core/plugins/events`.
 *
 * Presence answers a single question: *who else has this workspace open right
 * now?* It is deliberately ephemeral — nothing here is persisted, there is no
 * migration, and a server restart simply empties the roster and every client
 * re-announces on reconnect.
 */
import { Type, type Static } from '@sinclair/typebox'

/** Workspaces that publish presence. Scoped so Site peers don't leak into Content. */
export const PresenceScopeSchema = Type.Union([
  Type.Literal('site'),
  Type.Literal('content'),
])
export type PresenceScope = Static<typeof PresenceScopeSchema>

export const PresencePeerSchema = Type.Object({
  /** Stable per-tab id — one user with two tabs open is two peers, one avatar. */
  sessionId: Type.String(),
  userId: Type.String(),
  displayName: Type.String(),
  avatarUrl: Type.Union([Type.String(), Type.Null()]),
  /**
   * SHA-256 of the normalized email — drives the Gravatar fallback. The hash
   * travels instead of the address itself: presence only requires `site.read`,
   * so it must not hand every reader a roster of colleagues' email addresses.
   */
  gravatarHash: Type.String(),
  /** Epoch ms of the last heartbeat; the client uses it only for ordering. */
  lastSeen: Type.Number(),
})
export type PresencePeer = Static<typeof PresencePeerSchema>

/**
 * Every SSE frame carries the WHOLE roster rather than join/leave deltas.
 * A roster is a handful of entries, so a full snapshot costs nothing and
 * removes the entire class of bug where a dropped delta desyncs the list.
 */
export const PresenceRosterSchema = Type.Object({
  scope: PresenceScopeSchema,
  peers: Type.Array(PresencePeerSchema),
})
export type PresenceRoster = Static<typeof PresenceRosterSchema>

export const PresenceHeartbeatSchema = Type.Object({
  scope: PresenceScopeSchema,
  sessionId: Type.String({ minLength: 1, maxLength: 64 }),
  /** True when the tab is going away (`pagehide`), so the peer drops at once. */
  leave: Type.Optional(Type.Boolean()),
})
export type PresenceHeartbeat = Static<typeof PresenceHeartbeatSchema>
