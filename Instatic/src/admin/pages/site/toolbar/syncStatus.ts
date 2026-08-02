/**
 * The draft-state resolver behind the header's sync pill.
 *
 * Lives apart from `SyncStatusButton.tsx` so that file exports only a
 * component (Fast Refresh requirement) — and so the decision table can be
 * unit-tested without mounting anything.
 *
 * Two real signals feed it and they answer different questions:
 *   - `connection` (presence heartbeats) — can we reach the server at all?
 *   - `saveStatus` (usePersistence)      — did the last draft write land?
 *
 * Connection loses ties. A green "Draft synced" while the channel is down
 * would be the one genuinely dangerous lie this pill could tell, since the
 * user would keep editing believing their work is safe.
 */
import type { PersistenceSaveStatus } from '@admin/pages/site/hooks/usePersistence'
import type { PresenceConnectionState } from '@admin/pages/site/hooks/usePresence'

export type SyncTone = 'safe' | 'waiting' | 'warning' | 'danger'

export interface SyncStatusView {
  label: string
  /** Font Awesome glyph name, without the `fa-` prefix. */
  icon: string
  tone: SyncTone
  detail: string
  spin?: boolean
}

export function resolveSyncStatus(
  connection: PresenceConnectionState,
  saveStatus: PersistenceSaveStatus,
): SyncStatusView {
  if (connection === 'failed') {
    return {
      label: 'Sync failed',
      icon: 'triangle-exclamation',
      tone: 'danger',
      detail: 'The draft channel stopped responding. Reload to reconnect.',
    }
  }
  if (connection === 'offline') {
    return {
      label: 'Offline — reconnecting',
      icon: 'cloud-arrow-up',
      tone: 'warning',
      detail: 'Edits are held locally and will sync when the connection returns.',
    }
  }
  if (saveStatus.state === 'error') {
    return {
      label: 'Sync failed',
      icon: 'triangle-exclamation',
      tone: 'danger',
      detail: saveStatus.message ?? 'The last draft save did not complete.',
    }
  }
  if (connection === 'connecting' || saveStatus.state === 'loading') {
    return {
      label: 'Connecting',
      icon: 'spinner',
      tone: 'waiting',
      detail: 'Establishing the draft channel.',
      spin: true,
    }
  }
  if (saveStatus.state === 'saving') {
    return {
      label: 'Saving draft',
      icon: 'spinner',
      tone: 'waiting',
      detail: 'Writing your changes to the server.',
      spin: true,
    }
  }
  if (saveStatus.state === 'unsaved') {
    return {
      label: 'Unsaved draft',
      icon: 'circle-dot',
      tone: 'waiting',
      detail: 'Changes are pending — they save automatically, or press Ctrl+S.',
    }
  }
  return {
    label: 'Draft synced',
    icon: 'circle-check',
    tone: 'safe',
    detail: lastSavedDetail(saveStatus),
  }
}

function lastSavedDetail(saveStatus: PersistenceSaveStatus): string {
  if (!saveStatus.lastSavedAt) return 'Every change is saved on the server.'
  const time = new Date(saveStatus.lastSavedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `Last saved at ${time}.`
}
