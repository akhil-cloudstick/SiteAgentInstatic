/**
 * The Product Hub handoff band as the approved MMSBUILD *resource* screens draw
 * it (`prototype-reference/src/PluginsScreen.jsx:62-78`,
 * `resource-screens.css:70-125`).
 *
 * This is NOT the Start Desk's `ContextHandoffBand`. The reference ships two
 * different bands: the 76px three-column one with the inherited-context facts
 * (Home / Projects), and this 58px single-line strip used by the four resource
 * screens — Plugins, Design systems, Automations, Integrations. Reproducing the
 * Plugins screen means reproducing this one.
 *
 * The reference falls back to a hardcoded "Harbour Suites" pair when no context
 * is supplied. The build kit names that fixture among the behaviours a port
 * must NOT preserve (§5, and §4 "never fall back to Harbour Suites"), so an
 * unscoped session states that instead.
 */
import type { HubContext } from '@mms/shell';
import styles from '../PluginsScreen.module.css';

export interface ResourceHandoffStripProps {
  hubContext: HubContext | null;
  onOpenContext: () => void;
  /** Screen-reader label for the strip. */
  label: string;
  /** `Product Hub handoff · {client} / {project}` when the session is scoped. */
  scopedTitle: (client: string, project: string) => string;
  /** Headline when Product Hub has not scoped this session. */
  unscopedTitle: string;
  /** The ownership sentence under the headline. */
  summary: string;
  /** Label of the button that opens the inherited-context drawer. */
  openLabel: string;
}

export function ResourceHandoffStrip({
  hubContext,
  onOpenContext,
  label,
  scopedTitle,
  unscopedTitle,
  summary,
  openLabel,
}: ResourceHandoffStripProps) {
  const client = hubContext?.client?.trim() ?? '';
  const project = hubContext?.project?.trim() ?? '';
  const title = client && project ? scopedTitle(client, project) : unscopedTitle;

  return (
    <aside className={styles.handoff} aria-label={label} data-testid="plugins-handoff-strip">
      <span className={styles.handoffIcon} aria-hidden="true">
        <i className="fa-solid fa-code-branch" />
      </span>
      <div>
        <strong title={title}>{title}</strong>
        <span>{summary}</span>
      </div>
      <button type="button" onClick={onOpenContext} data-testid="plugins-handoff-open">
        {openLabel} <i className="fa-solid fa-chevron-right" aria-hidden="true" />
      </button>
    </aside>
  );
}
