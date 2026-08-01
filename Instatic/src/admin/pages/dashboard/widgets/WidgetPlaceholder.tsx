/**
 * WidgetPlaceholder — what a dashboard tile shows once loading has
 * FINISHED and there is still nothing to draw.
 *
 * The three states every widget owes the operator are distinct:
 *
 *   loading            → the shimmer skeleton (`<Widget loading>`)
 *   settled, no data   → this placeholder
 *   settled, data      → the real content
 *
 * Collapsing the first two — which the dashboard used to do, because the
 * data hooks returned a single `T | null` — meant a widget whose endpoint
 * 404s or 403s sat under a shimmer forever, telling the operator nothing
 * and looking like a hang. `useDashboardEndpoint` now returns `data` and
 * `loading` separately so every tile can land here instead.
 *
 * COPY IS DELIBERATELY PLAIN. Earlier this component printed a different,
 * technical message for a failed request ("couldn't be loaded… may need a
 * permission your role doesn't have"). The dashboard's audience is site
 * owners and editors, not operators reading HTTP statuses — capability
 * gates and endpoint failures are our problem, not something to hand the
 * user mid-sentence. So both cases render the same calm "there's nothing
 * here yet" copy the widget supplies.
 *
 * `reason` therefore no longer changes what the user reads; it survives
 * only as a `data-reason` attribute so the state is still visible in
 * devtools and assertable in tests.
 */
import { FaIcon } from '@ui/components/FaIcon'
import styles from './widgets.module.css'

interface WidgetPlaceholderProps {
  /**
   * `empty` — the query succeeded and returned nothing.
   * `unavailable` — the query failed (offline, a capability the role
   * lacks, or a server that predates the endpoint).
   *
   * Surfaced as `data-reason` for debugging only — the rendered copy is
   * identical either way, on purpose.
   */
  reason: 'empty' | 'unavailable'
  /** Font Awesome Solid glyph name, no `fa-` prefix. */
  icon: string
  title: string
  detail: string
}

export function WidgetPlaceholder({ reason, icon, title, detail }: WidgetPlaceholderProps) {
  return (
    <div className={styles.widgetEmpty} role="status" data-reason={reason}>
      <FaIcon name={icon} size={24} className={styles.widgetEmptyIcon} />
      <strong className={styles.widgetEmptyTitle}>{title}</strong>
      <span className={styles.widgetEmptyDetail}>{detail}</span>
    </div>
  )
}
