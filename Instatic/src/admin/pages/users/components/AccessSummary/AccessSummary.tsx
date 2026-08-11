/**
 * AccessSummary — the workbench's right pane.
 *
 * Answers "what does this role actually mean" in four blocks: the plain-language
 * outcome, when the role was created and last changed, how changes to it are
 * protected, and the four rules that govern roles in general.
 *
 * DATA NOTE — the approved screen shows "Created … by Akhil" / "Last updated …
 * by Akhil". `role.createdAt` / `role.updatedAt` are real and ship on every
 * role, but there is NO actor attribution anywhere in the schema: no
 * `created_by_user_id` column, and the audit log is capped at the newest 100
 * events so joining it would be unreliable. The "by <name>" line is therefore
 * omitted rather than invented. Documented as a deliberate deviation.
 */
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { formatDateTime } from '../../utils/format'
import { roleOutcome } from '../../utils/roleOutcome'
import styles from './AccessSummary.module.css'

interface AccessSummaryProps {
  slug: string
  capabilities: string[]
  /** Null while a new role is being drafted — it has no timestamps yet. */
  createdAt: string | null
  updatedAt: string | null
  /** Null when the viewer cannot read the audit log. */
  onViewActivity: (() => void) | null
}

export function AccessSummary({
  slug,
  capabilities,
  createdAt,
  updatedAt,
  onViewActivity,
}: AccessSummaryProps) {
  const outcome = roleOutcome({ slug, capabilities })
  const created = createdAt === null ? 'Not saved yet' : formatDateTime(createdAt)
  const updated = updatedAt === null ? 'Not saved yet' : formatDateTime(updatedAt)

  return (
    <aside className={styles.summary} aria-label="Access summary">
      <h2>Access summary</h2>

      <section className={styles.card}>
        <span className={styles.shield}>
          <FaIcon name="shield-halved" size={18} />
        </span>
        <div className={styles.cardBody}>
          <strong>{outcome.can}</strong>
          <p>{outcome.cannot}</p>
        </div>
      </section>

      <h3>About this role</h3>
      <dl className={styles.meta}>
        <div>
          <dt>
            <FaIcon name="calendar-days" size={12} className={styles.metaGlyph} />
            <span>Created</span>
          </dt>
          <dd>{created}</dd>
        </div>
        <div>
          <dt>
            <FaIcon name="pen" size={12} className={styles.metaGlyph} />
            <span>Last updated</span>
          </dt>
          <dd>{updated}</dd>
        </div>
      </dl>

      <h3>Security &amp; audit</h3>
      <p className={styles.note}>
        <FaIcon name="shield-halved" size={13} className={styles.noteGlyph} />
        <span>Capability changes are step-up protected and audited.</span>
      </p>
      {onViewActivity && (
        <Button
          type="button"
          variant="ghost"
          size="md"
          align="between"
          fullWidth
          className={styles.auditLink}
          onClick={onViewActivity}
        >
          <span className={styles.auditLinkLabel}>
            <FaIcon name="file-shield" size={13} />
            <span>View audit log</span>
          </span>
          <FaIcon name="chevron-right" size={11} />
        </Button>
      )}

      <h3>Role rules</h3>
      <ul className={styles.rules}>
        <li>Owner role is locked and cannot be edited.</li>
        <li>System roles cannot be deleted.</li>
        <li>Custom roles can be deleted if no users are assigned.</li>
        <li>The roles.manage capability is owner-only.</li>
      </ul>
    </aside>
  )
}
