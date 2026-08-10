/**
 * UploadQueueWindow — floating queue panel showing in-flight and finished
 * uploads with progress, retry and cancel. Lives outside the Media canvas so
 * it persists across folder navigation.
 *
 * Transcribed from the MMSBUILD Media reference (`screens/media/src/App.jsx`
 * → `UploadQueue`) plus the approved upload-queue master, which adds the
 * destination subtitle (`Uploading to <folder>`), the
 * `N in flight • N done • N failed` summary line and a per-row percentage.
 */
import { useEffect, useState } from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { EmptyState } from '@ui/components/EmptyState'
import { FloatingWindow } from '@admin/shared/FloatingWindow'
import type { CmsMediaFolder } from '@core/persistence/cmsMedia'
import type { UploadItem, UseUploadQueueResult } from '../../hooks/useUploadQueue'
import { formatBytes } from '../../utils/formatBytes'
import styles from './UploadQueueWindow.module.css'

interface UploadQueueWindowProps {
  queue: UseUploadQueueResult
  open: boolean
  onClose: () => void
  /** Resolves an upload's target folder id to a name for the subtitle. */
  folderById?: Map<string, CmsMediaFolder>
}

/** Human label for the folder the current batch is uploading into. */
function destinationLabel(
  items: UploadItem[],
  folderById: Map<string, CmsMediaFolder> | undefined,
): string | null {
  const inFlight = items.filter(
    (item) => item.status === 'uploading' || item.status === 'queued',
  )
  if (inFlight.length === 0) return null
  const ids = new Set(inFlight.map((item) => item.folderId))
  if (ids.size > 1) return 'Uploading to multiple folders'
  const [only] = [...ids]
  if (!only) return 'Uploading to All media'
  const name = folderById?.get(only)?.name
  return name ? `Uploading to ${name}` : 'Uploading to All media'
}

export function UploadQueueWindow({
  queue,
  open,
  onClose,
  folderById,
}: UploadQueueWindowProps) {
  const total = queue.items.length
  const succeeded = queue.items.filter((item) => item.status === 'succeeded').length
  const failed = queue.items.filter((item) => item.status === 'failed').length
  const inFlight = queue.items.filter(
    (item) => item.status === 'queued' || item.status === 'uploading',
  ).length

  const finishedExists = queue.items.some((item) =>
    item.status === 'succeeded' || item.status === 'failed' || item.status === 'cancelled',
  )

  const destination = destinationLabel(queue.items, folderById)

  return (
    <FloatingWindow
      panelId="mediaUploadQueue"
      open={open}
      onClose={onClose}
      title={total > 0 ? `Uploads (${succeeded}/${total})` : 'Uploads'}
      defaultPosition={{ x: 342, y: 420 }}
      width={390}
      maxHeight={600}
      ariaLabel="Upload queue"
      testId="media-upload-queue"
      // Becomes a full-width bottom sheet at ≤767px. Every floating surface
      // does, which is also what stops them overlapping on mobile.
      className={styles.sheet}
      // Only offered when there is something to clear. A permanently-disabled
      // control on an empty panel is noise, not an affordance.
      headerActions={finishedExists ? (
        <Button
          variant="ghost"
          size="xs"
          aria-label="Clear finished uploads"
          onClick={() => queue.clearFinished()}
        >
          Clear
        </Button>
      ) : undefined}
    >
      {/* The context strip only exists while there is something to report. An
          empty queue has no destination, no counts and nothing to clear — the
          empty state below says all of that once, on its own. */}
      {total > 0 && (
        <div className={styles.summary} role="status" aria-live="polite">
          {destination && <span className={styles.destination}>{destination}</span>}
          <span className={styles.counts}>
            {inFlight} in flight · {succeeded} done
            {failed > 0 && ` · ${failed} failed`}
          </span>
        </div>
      )}

      {total === 0 ? (
        <EmptyState
          compact
          plain
          align="center"
          icon={<FaIcon name="cloud-arrow-up" size={22} />}
          title="No uploads yet"
          description="Drop files onto the media canvas to upload them."
        />
      ) : (
        <ul className={styles.list} role="list">
          {queue.items.map((item) => (
            <UploadRow
              key={item.id}
              item={item}
              onRetry={() => queue.retry(item.id)}
              onRemove={() => queue.remove(item.id)}
            />
          ))}
        </ul>
      )}
    </FloatingWindow>
  )
}

interface UploadRowProps {
  item: UploadItem
  onRetry: () => void
  onRemove: () => void
}

/** Status word shown beside the file size. */
const STATUS_LABEL: Record<UploadItem['status'], string> = {
  queued: 'Queued',
  uploading: 'Uploading',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

/** Typed glyph for a file with no renderable thumbnail. */
function glyphForUpload(item: UploadItem): string {
  if (item.status === 'succeeded') return 'check'
  if (item.status === 'failed') return 'triangle-exclamation'
  if (item.file.type.startsWith('video/')) return 'video'
  if (item.file.type === 'image/svg+xml') return 'image'
  return 'file-arrow-up'
}

function UploadRow({ item, onRetry, onRemove }: UploadRowProps) {
  // Mint the preview blob URL once via a lazy initializer — NOT in the render
  // body, which re-runs on every progress tick and would leak a fresh URL each
  // render. A row's `item.file` is fixed for its mounted lifetime, so one URL
  // per row is correct; the effect revokes it on unmount.
  const [previewUrl] = useState<string | null>(() =>
    item.file.type.startsWith('image/') && item.file.type !== 'image/svg+xml'
      ? URL.createObjectURL(item.file)
      : null,
  )
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const pct = item.status === 'uploading'
    ? Math.round(item.progress * 100)
    : item.status === 'succeeded'
      ? 100
      : 0

  const showProgress = item.status === 'uploading'
  const retryable = item.status === 'failed' || item.status === 'cancelled'

  return (
    <li className={styles.row} data-status={item.status}>
      <span className={styles.preview} aria-hidden="true">
        {previewUrl ? (
          <img src={previewUrl} alt="" className={styles.previewImage} />
        ) : (
          <FaIcon name={glyphForUpload(item)} size={15} />
        )}
      </span>

      <span className={styles.body}>
        <span className={styles.name} title={item.file.name}>{item.file.name}</span>
        <span className={styles.meta}>
          {formatBytes(item.file.size)} · {STATUS_LABEL[item.status]}
        </span>

        {item.error && (
          <span className={styles.error} role="alert">
            <FaIcon name="triangle-exclamation" size={10} />
            <span>{item.error}</span>
          </span>
        )}
        {item.warning && !item.error && (
          <span className={styles.warning} role="status">
            <FaIcon name="triangle-exclamation" size={10} />
            <span>{item.warning}</span>
          </span>
        )}

        {showProgress && (
          <span className={styles.progressRow}>
            <span className={styles.progressTrack} aria-hidden="true">
              <span
                className={styles.progressFill}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className={styles.progressValue}>{pct}%</span>
          </span>
        )}
      </span>

      <span className={styles.actions}>
        {retryable && (
          <Button variant="ghost" size="xs" aria-label={`Retry ${item.file.name}`} onClick={onRetry}>
            Retry
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          aria-label={
            item.status === 'uploading' || item.status === 'queued'
              ? `Cancel ${item.file.name}`
              : `Remove ${item.file.name} from queue`
          }
          onClick={onRemove}
        >
          {item.status === 'uploading' || item.status === 'queued' ? 'Cancel' : 'Remove'}
        </Button>
      </span>
    </li>
  )
}
