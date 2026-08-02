# Presence

Who currently has a workspace open, and whether this tab's own channel to the server is healthy. Drives the Site header's collaborator avatars and its draft-state pill.

---

## TL;DR

- **Ephemeral by design.** In-memory only, no table, no migration. A server restart empties the roster; every client re-announces within one heartbeat.
- Two endpoints, both gated by `site.read`:
  - `GET /admin/api/cms/presence/events?scope=site` — SSE, pushes the **whole roster** on every change.
  - `POST /admin/api/cms/presence/heartbeat` — announce / refresh / leave.
- Registry: `server/presence/presenceRegistry.ts`. Wire shapes: `src/core/presence/events.ts` (TypeBox, shared by both sides).
- Client: `usePresence(scope)` → `{ peers, connection }`. UI: `PresencePeerStack`, `SyncStatusButton`.
- **Liveness is heartbeat-based, not connection-based** — see below.

---

## Why heartbeats decide liveness

An SSE stream staying open is a weaker signal than it looks. It survives a suspended laptop, and a buffering proxy can hold a connection that is functionally dead. "This tab said hello 20 seconds ago" is the stronger claim, so a peer that misses `PEER_TTL_MS` (50s ≈ 2.5 heartbeats) is dropped whether or not its stream still appears alive. One dropped request is tolerated.

The same reasoning drives the client's `connection` state: it reflects whether **our own heartbeats are landing**, because that is what the header's pill is really asking — *is my draft still talking to the server?* A failed heartbeat means an edit might not be saved, which is precisely when Publish should be blocked.

## Why the whole roster, every time

A roster is a handful of entries, so a full snapshot costs nothing and removes the entire class of bug where a dropped join/leave delta desyncs the list. Eviction runs on read and write rather than on a timer: with no clients connected there is nothing to expire, and with clients connected the heartbeats are a better clock than an interval that would keep the process awake.

## Privacy

Identity comes from the authenticated session, never from the request body — a client picks its own tab id but not who it claims to be. Peers carry `gravatarHash`, **not** the email address: presence only requires `site.read`, so it must not hand every reader a roster of colleagues' addresses.

## Shapes

```ts
type PresencePeer = {
  sessionId: string      // one per tab
  userId: string
  displayName: string
  avatarUrl: string | null
  gravatarHash: string
  lastSeen: number
}
```

Client-side, a user's multiple tabs collapse to one avatar and the current tab is filtered out — the stack answers "who else", not "how many windows".

## Sync pill states

`SyncStatusButton` resolves the approved screen's four states from two real signals, `connection` (presence) and `saveStatus` (`usePersistence`). Connection loses ties: a green "Draft synced" while the channel is down would be the one genuinely dangerous lie this pill could tell.

| Shown | Condition |
|---|---|
| Sync failed | `connection === 'failed'`, or the last save errored |
| Offline — reconnecting | `connection === 'offline'` |
| Connecting | `connection === 'connecting'` or the site is still loading |
| Saving draft / Unsaved draft | `saveStatus.state` is `saving` / `unsaved` |
| Draft synced | otherwise |

The reference's popover was a state *picker* (it had no server); here it is read-only, because there is no such thing as choosing your own sync state.

## Related

- SSE mechanics are deliberately identical to the plugin event stream — `server/handlers/cms/plugins/events.ts`. Same heartbeat, lease cap, abort and cancel handling.
- Save status: [`editor.md`](../editor.md) → persistence.
