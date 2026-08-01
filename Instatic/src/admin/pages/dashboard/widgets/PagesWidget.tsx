/**
 * Pages widget — total published / drafts / scheduled counts pulled
 * from `usePagesStats()`. The "+N this week" delta reads
 * `deltaPublishedThisWeek` from the server-side count of pages
 * whose `published_at` is within the trailing 7 days.
 *
 * Loading state: passing `loading={isLoading}` to `<Widget>` is the
 * entire skeleton story. The Widget primitive renders the universal
 * skeleton body until `stats` resolves; we gate the real children on
 * `stats &&` so they never see a null value.
 */
import { FileTextSolidIcon } from 'pixel-art-icons/icons/file-text-solid'
import { StatValue, Delta } from '@ui/components/charts'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '@ui/components/Widget'
import { usePagesStats } from '../hooks/useDashboardStats'
import { WidgetPlaceholder } from './WidgetPlaceholder'
import styles from './widgets.module.css'

export function PagesWidget({ span, editing }: DashboardWidgetRendererProps) {
  const { data: stats, loading } = usePagesStats()
  return (
    <Widget
      widgetId="pages"
      title="Pages"
      icon={FileTextSolidIcon}
      tint="lilac"
      span={span}
      editing={editing}
      loading={loading}
    >
      {stats && (
        <>
          <StatValue
            value={stats.published.toLocaleString()}
            sub={(
              <>
                <span>Published</span>
                {stats.deltaPublishedThisWeek > 0 && (
                  <Delta>+{stats.deltaPublishedThisWeek} this week</Delta>
                )}
              </>
            )}
          />
          <div className={styles.subFootRow}>
            <span>{stats.drafts} draft{stats.drafts === 1 ? '' : 's'}</span>
            <span>{stats.scheduled} scheduled</span>
          </div>
        </>
      )}
      {!loading && !stats && (
        <WidgetPlaceholder
          reason="unavailable"
          icon="file-lines"
          title="No pages yet"
          detail="Your published pages and drafts show up here."
        />
      )}
    </Widget>
  )
}
