/**
 * Posts widget — total post count + category caption + a scheduled
 * footer. Data comes from `usePostsStats()` (server-side aggregated
 * across every `kind: 'postType'` table).
 *
 * The approved MMSBUILD screen draws this block as a plain metric tile —
 * value, caption, footer — with no chart, so the 28-day histogram this
 * widget used to render was dropped. `daily28` still ships in the
 * endpoint payload for any plugin tile that wants it.
 *
 * Skeleton: `loading={loading}` and the Widget primitive
 * handles the rest.
 */
import { PenSquareSolidIcon } from 'pixel-art-icons/icons/pen-square-solid'
import { StatValue } from '@ui/components/charts'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '@ui/components/Widget'
import { WidgetPlaceholder } from './WidgetPlaceholder'
import styles from './widgets.module.css'
import { usePostsStats } from '../hooks/useDashboardStats'

export function PostsWidget({ span, editing }: DashboardWidgetRendererProps) {
  const { data: stats, loading } = usePostsStats()
  return (
    <Widget
      widgetId="posts"
      title="Posts"
      icon={PenSquareSolidIcon}
      tint="peach"
      span={span}
      editing={editing}
      loading={loading}
    >
      {stats && (
        <>
          <StatValue
            value={stats.total.toLocaleString()}
            sub={(
              stats.categories === 0
                ? <span>Total · no categories yet</span>
                : <span>Total · {stats.categories} categor{stats.categories === 1 ? 'y' : 'ies'}</span>
            )}
          />
          <div className={styles.subFootRow}>
            <span>{stats.scheduled} scheduled</span>
          </div>
        </>
      )}
      {!loading && !stats && (
        <WidgetPlaceholder
          reason="unavailable"
          icon="newspaper"
          title="No posts yet"
          detail="Your posts show up here once you add some."
        />
      )}
    </Widget>
  )
}
