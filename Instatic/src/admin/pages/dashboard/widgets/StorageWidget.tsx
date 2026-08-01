/**
 * Storage widget — total used + a StackedBar showing the per-category
 * breakdown.
 *
 * There is intentionally **no quota** here. Self-hosted Instatic
 * never imposes an artificial disk cap, so the headline stat is the
 * total currently in use and the breakdown bar stretches to fill its
 * full width — each segment reads as a proportion of *what is used*,
 * not of an imaginary plan limit. The widget caption surfaces which
 * database adapter is active (`SQLite` / `Postgres`) so the operator
 * knows where data physically lives.
 *
 * Data comes from `useStorageStats()` → `/admin/api/cms/dashboard/storage`.
 * Sizing detail per segment:
 *   • Images     — sum of `media_assets.size_bytes` for `image/*`.
 *   • Videos     — sum of `media_assets.size_bytes` for `video/*`.
 *   • Documents  — sum of `media_assets.size_bytes` for everything else
 *                  (audio, PDFs, archives, NULL mime types).
 *   • Plugins    — total bytes under `<uploadsDir>/plugins/` on disk.
 *   • Database   — for SQLite the file + WAL/SHM sidecars; for
 *                  Postgres `pg_database_size(current_database())`.
 */
import { DatabaseSolidIcon } from 'pixel-art-icons/icons/database-solid'
import { StatValue } from '@ui/components/charts'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '@ui/components/Widget'
import { FaIcon } from '@ui/components/FaIcon'
import { useStorageStats } from '../hooks/useDashboardStats'
import { WidgetPlaceholder } from './WidgetPlaceholder'
import styles from './widgets.module.css'

/**
 * Human-readable byte formatter — drops decimals for B/KB/MB and keeps
 * one significant decimal for GB/TB so values like "1.4 GB" read
 * naturally. Matches the formatter in `MediaWidget.tsx` so users see
 * the same units across both tiles.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function dialectLabel(dialect: 'sqlite' | 'postgres'): string {
  return dialect === 'postgres' ? 'Postgres' : 'SQLite'
}

export function StorageWidget({ span, editing }: DashboardWidgetRendererProps) {
  const { data: stats, loading } = useStorageStats()
  return (
    <Widget
      widgetId="storage"
      title="Storage"
      icon={DatabaseSolidIcon}
      tint="sky"
      span={span}
      editing={editing}
      loading={loading}
    >
      {stats && (
        <>
          <StatValue
            value={formatSize(stats.totalBytes)}
            sub={<span>used · {dialectLabel(stats.dialect)} · self-hosted</span>}
          />
          {/* The approved screen draws a single native <progress> track
              plus a wrapped legend of coloured squares — not a segmented
              bar. With no quota there is nothing to measure "used" against,
              so the track is filled proportionally to the largest single
              category; the legend carries the real per-category totals.
              `max` falls back to 1 when the host is empty so the element
              never renders a NaN-width fill. */}
          <progress
            className={styles.storageBar}
            value={stats.totalBytes - stats.databaseBytes}
            max={stats.totalBytes > 0 ? stats.totalBytes : 1}
            aria-label={`${formatSize(stats.totalBytes)} used`}
          >
            {formatSize(stats.totalBytes)}
          </progress>
          <ul className={styles.storageKey} aria-label="Storage breakdown">
            {[
              { key: 'Images', bytes: stats.imageBytes, tone: styles.storageKeyImages },
              { key: 'Videos', bytes: stats.videoBytes, tone: styles.storageKeyVideos },
              { key: 'Documents', bytes: stats.documentBytes, tone: styles.storageKeyDocuments },
              { key: 'Plugins', bytes: stats.pluginBytes, tone: styles.storageKeyPlugins },
              { key: 'Database', bytes: stats.databaseBytes, tone: styles.storageKeyDatabase },
            ].map((row) => (
              <li key={row.key} className={row.tone}>
                <FaIcon name="square" size={10} />
                <span>{row.key} · {formatSize(row.bytes)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {!loading && !stats && (
        <WidgetPlaceholder
          reason="unavailable"
          icon="hard-drive"
          title="Nothing stored yet"
          detail="Your files and content show up here as you add them."
        />
      )}
    </Widget>
  )
}
