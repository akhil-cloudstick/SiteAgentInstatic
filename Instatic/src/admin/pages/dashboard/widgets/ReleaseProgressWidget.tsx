/**
 * Release progress widget (MMSBUILD "Live Release Desk", Screen 1).
 *
 * A vertical stepper — Editing → Preview → Client approval → Published — driven
 * by the REAL publish status (`getCmsPublishStatus`): draft page count, whether
 * the draft matches what's published, and whether a published version exists.
 *
 * Honesty note: Instatic has no client-approval workflow (that lives in the
 * MMSBUILD Hub / a plugin, not core state), so the "Client approval" stage
 * renders as an explicit "Approval not required" rather than a fabricated
 * pending/approved status. The other three stages are all derived from real
 * repository state.
 */
import { useEffect, useState } from 'react'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { getCmsPublishStatus } from '@core/persistence'
import { Widget } from '@ui/components/Widget'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { useNavigate } from '@admin/lib/routing'
import styles from './widgets.module.css'

type StepState = 'complete' | 'current' | 'pending' | 'na'

interface ReleaseStep {
  icon: string
  label: string
  detail: string
  state: StepState
}

type PublishStatus = Awaited<ReturnType<typeof getCmsPublishStatus>>

/**
 * Derive the four release stages from real publish status. No fabricated
 * numbers — only the draft/published page counts and the draft-vs-published
 * match flag the repository actually reports.
 */
function buildSteps(status: PublishStatus): ReleaseStep[] {
  const hasDraft = status.draftPages > 0
  const upToDate = status.draftMatchesPublished
  const live = status.hasPublishedVersion

  const editing: ReleaseStep = {
    icon: 'pen',
    label: 'Editing',
    detail: hasDraft
      ? `${status.draftPages} ${status.draftPages === 1 ? 'page' : 'pages'} in draft`
      : 'No pages yet',
    state: hasDraft ? 'complete' : 'pending',
  }

  const preview: ReleaseStep = {
    icon: 'eye',
    label: 'Preview',
    detail: !hasDraft
      ? 'Nothing to preview yet'
      : upToDate
        ? 'Matches the published site'
        : 'Review unpublished changes',
    state: !hasDraft ? 'pending' : upToDate ? 'complete' : 'current',
  }

  const approval: ReleaseStep = {
    icon: 'user-group',
    label: 'Client approval',
    detail: 'Approval not required',
    state: 'na',
  }

  const published: ReleaseStep = {
    icon: 'check',
    label: 'Published',
    detail: !live
      ? 'Not published yet'
      : upToDate
        ? 'Live for everyone'
        : 'Changes waiting to publish',
    state: !live ? 'pending' : upToDate ? 'complete' : 'current',
  }

  return [editing, preview, approval, published]
}

/**
 * Right-hand stage marker. The reference draws a single 19px glyph, not a
 * filled badge: a green circle-check once a stage is done, an amber
 * ring-dot on the stage the site is currently sitting at, a flat grey disc
 * for anything still ahead, and a struck-through disc for a stage that
 * doesn't apply to this install.
 */
const MARKER_GLYPH: Record<StepState, string> = {
  complete: 'circle-check',
  current: 'circle-dot',
  pending: 'circle',
  na: 'circle-minus',
}

function StepMarker({ state }: { state: StepState }) {
  return (
    <span className={styles.stepMarker} aria-hidden="true">
      <FaIcon name={MARKER_GLYPH[state]} size={19} />
    </span>
  )
}

export function ReleaseProgressWidget({ span, editing }: DashboardWidgetRendererProps) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<PublishStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void getCmsPublishStatus()
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch((err) => {
        console.error('[release-progress] failed to load publish status:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const steps = status ? buildSteps(status) : []
  const hasChanges = status ? !status.draftMatchesPublished : false

  return (
    <Widget
      widgetId="release-progress"
      title="Release progress"
      tint="mint"
      span={span}
      editing={editing}
      className={styles.cardRelease}
      loading={status === null}
    >
      <ol className={styles.stepper}>
        {steps.map((step, index) => (
          <li key={step.label} className={styles.step} data-state={step.state}>
            {/* The connector is a child of the ROW (not the rail cell) so it
                can overshoot into the gap and meet the next stage's line. */}
            {index < steps.length - 1 && (
              <span className={styles.stepLine} aria-hidden="true" />
            )}
            <span className={styles.stepRail} aria-hidden="true">
              <span className={styles.stepNum}>{index + 1}</span>
            </span>
            <span className={styles.stepIcon} aria-hidden="true">
              <FaIcon name={step.icon} size={18} />
            </span>
            <span className={styles.stepBody}>
              <span className={styles.stepLabel}>{step.label}</span>
              <span className={styles.stepDetail}>{step.detail}</span>
            </span>
            <StepMarker state={step.state} />
          </li>
        ))}
      </ol>
      <Button
        variant="ghost"
        className={styles.releaseCta}
        onClick={() => navigate('/admin/site')}
      >
        <FaIcon name={hasChanges ? 'eye' : 'pen'} size={15} />
        {hasChanges ? 'Review changes' : 'Open site editor'}
      </Button>
    </Widget>
  )
}
