/**
 * AutomationRow — one saved automation, drawn as the approved reference's
 * `.automation-list > li` (`prototype-reference/src/AutomationsScreen.jsx:324-352`,
 * `styles.css:6045-6269`).
 *
 * ── Two inline buttons and a kebab, not five buttons ─────────────────────
 * The reference keeps `Run` and `History` on the row and folds Edit,
 * Pause/Resume and Delete into a `⋯` menu (`:340-343`). That is the approved
 * workflow, and it is the same `.catalog-menu-wrap` + `.catalog-popover` idiom
 * `LinkedProjectRow` already ships on Projects. Dismissal goes through
 * `useDismissable` rather than the prototype's toggle-only handler, which
 * cannot be closed by clicking away or scrolling.
 *
 * Analytics fire BEFORE each handler, as they did on the old screen, so a
 * navigation that unmounts the row still reports.
 */
import { useEffect, useRef, useState } from 'react';
import type { AutomationsClickProps, Routine, RoutineRun } from '@open-design/contracts';

import { useT } from '../i18n';
import type { Dict } from '../i18n/types';
import { useDismissable } from './start-desk/useDismissable';
import { describeRoutineSchedule } from './routineScheduleLabels';
import styles from './AutomationsScreen.module.css';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;
type ClickElement = AutomationsClickProps['element'];

export interface AutomationRowProps {
  routine: Routine;
  /** Project name for a `reuse` target, or the "new project each run" label. */
  targetLabel: string;
  busy: boolean;
  running: boolean;
  expanded: boolean;
  /** Just created — scrolled into view and marked for a few seconds. */
  focused: boolean;
  /** Bumped to force the history panel to refetch. */
  historyTick: number;
  crystallizingRunId: string | null;
  onRun: () => void;
  onToggleHistory: () => void;
  onEdit: () => void;
  onTogglePaused: () => void;
  onDelete: () => void;
  onOpenResult: () => void;
  onOpenConversation: (run: RoutineRun) => void;
  onCrystallizeRun: (runId: string) => void;
  onFireClick: (element: ClickElement) => void;
  rowRef?: (node: HTMLLIElement | null) => void;
}

export function AutomationRow({
  routine,
  targetLabel,
  busy,
  running,
  expanded,
  focused,
  historyTick,
  crystallizingRunId,
  onRun,
  onToggleHistory,
  onEdit,
  onTogglePaused,
  onDelete,
  onOpenResult,
  onOpenConversation,
  onCrystallizeRun,
  onFireClick,
  rowRef,
}: AutomationRowProps) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useDismissable({
    open: menuOpen,
    panelRef,
    triggerRef,
    onDismiss: () => setMenuOpen(false),
  });

  const rowClass = [styles.row, routine.enabled ? '' : styles.rowPaused]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      ref={rowRef}
      data-testid={`automation-row-${routine.id}`}
      data-focused={focused ? 'true' : 'false'}
      data-paused={routine.enabled ? 'false' : 'true'}
      className={rowClass}
    >
      <div className={styles.rowMain}>
        <span className={styles.rowIcon} aria-hidden="true">
          <i className={`fa-solid fa-${rowGlyph(routine)}`} />
        </span>
        <div className={styles.rowCopy}>
          <h3>{routine.name}</h3>
          <p className={styles.rowMeta}>
            <span>{scheduleStatusLabel(routine, t)}</span>
            <i>·</i>
            <span>{targetLabel}</span>
            <i>·</i>
            <span>{nextRunLabel(routine, t)}</span>
          </p>
          {routine.prompt ? <p className={styles.rowPrompt}>{routine.prompt}</p> : null}
          {routine.lastRun ? (
            <p className={styles.lastRun}>
              <StatusPill status={routine.lastRun.status} t={t} />
              <span>
                {t('automations.lastRun', {
                  time: formatAutomationTimestamp(routine.lastRun.startedAt),
                })}
              </span>
              <i>·</i>
              <button
                type="button"
                onClick={() => {
                  onFireClick('open_artifact');
                  onOpenResult();
                }}
              >
                {t('automations.openResult')}
              </button>
            </p>
          ) : null}
        </div>
      </div>

      <div className={styles.rowActions}>
        <button
          type="button"
          className={`${styles.rowButton} ${styles.rowButtonRun}`}
          onClick={() => {
            onFireClick('run_now');
            onRun();
          }}
          disabled={busy}
          title={t('automations.runNowTitle')}
        >
          <i className={`fa-solid fa-${running ? 'rotate' : 'play'}`} aria-hidden="true" />
          <span>{running ? t('automations.running') : t('automations.run')}</span>
        </button>
        <button
          type="button"
          className={styles.rowButton}
          aria-expanded={expanded}
          onClick={() => {
            onFireClick('history');
            onToggleHistory();
          }}
        >
          <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
          <span>{expanded ? t('automations.hideHistory') : t('automations.history')}</span>
        </button>
        <span className={styles.menuWrap}>
          <button
            ref={triggerRef}
            type="button"
            className={styles.iconButton}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t('automations.rowMenuAria', { name: routine.name })}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <i className="fa-solid fa-ellipsis" aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div ref={panelRef} className={styles.popover} role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  onFireClick('edit');
                  onEdit();
                }}
              >
                <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
                {t('automations.edit')}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  onFireClick(routine.enabled ? 'pause' : 'resume');
                  onTogglePaused();
                }}
              >
                <i
                  className={`fa-solid fa-${routine.enabled ? 'pause' : 'play'}`}
                  aria-hidden="true"
                />
                {routine.enabled ? t('automations.pause') : t('automations.resume')}
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.danger}
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  onFireClick('delete');
                  onDelete();
                }}
              >
                <i className="fa-solid fa-trash" aria-hidden="true" />
                {/* The reference's menu item reads plain `Delete`; `designs.menuDelete`
                    already carries exactly that string in all 19 locales and is what
                    LinkedProjectRow's kebab uses. */}
                {t('designs.menuDelete')}
              </button>
            </div>
          ) : null}
        </span>
      </div>

      {expanded ? (
        <AutomationRunHistory
          routineId={routine.id}
          refreshKey={historyTick}
          crystallizingRunId={crystallizingRunId}
          onCrystallizeRun={onCrystallizeRun}
          onOpenConversation={onOpenConversation}
          onFireClick={onFireClick}
          t={t}
        />
      ) : null}
    </li>
  );
}

/**
 * The reference gives a design-system automation the `sliders` glyph and
 * everything else `clock-rotate-left` (`AutomationsScreen.jsx:329`). Its own
 * test is the routine's NAME, which is locale-fragile, so the app's own data is
 * checked first: the skill it was created from, then the template marker
 * `automationTemplatePrompt` writes verbatim into the prompt, then the
 * reference's name test as the last resort.
 */
const DESIGN_SYSTEM_TEMPLATE_IDS = ['extract-design-system', 'design-system-refresh'];

function rowGlyph(routine: Routine): string {
  if (routine.skillId && DESIGN_SYSTEM_TEMPLATE_IDS.includes(routine.skillId)) return 'sliders';
  const prompt = routine.prompt ?? '';
  if (DESIGN_SYSTEM_TEMPLATE_IDS.some((id) => prompt.startsWith(`Use Automation template "${id}"`))) {
    return 'sliders';
  }
  if (/design system/i.test(routine.name)) return 'sliders';
  return 'clock-rotate-left';
}

function scheduleStatusLabel(routine: Routine, t: TranslateFn): string {
  if (!routine.enabled) return t('automations.scheduleStatusPaused');
  return describeRoutineSchedule(routine.schedule, t, routine.nextRunAt);
}

function nextRunLabel(routine: Routine, t: TranslateFn): string {
  if (!routine.enabled) return t('automations.nextRunManualOnly');
  if (!routine.nextRunAt) return t('automations.nextRunScheduled');
  const date = new Date(routine.nextRunAt);
  return t('automations.nextRunAt', {
    time: date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
  });
}

export function formatAutomationTimestamp(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatRunDuration(run: RoutineRun, t: TranslateFn): string {
  if (!run.completedAt) return t('automations.runInProgress');
  const seconds = Math.max(1, Math.round((run.completedAt - run.startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function statusLabel(status: RoutineRun['status'], t: TranslateFn): string {
  if (status === 'succeeded') return t('automations.statusSucceeded');
  if (status === 'failed') return t('automations.statusFailed');
  if (status === 'running') return t('automations.statusRunning');
  if (status === 'queued') return t('automations.statusQueued');
  return t('automations.statusCanceled');
}

/**
 * `AutomationsScreen.jsx:264-266`. The reference only ever renders `succeeded`
 * and `running`; `failed` gets the same recipe in the danger tone because this
 * app has a real failure path and a neutral pill would hide it. `queued` and
 * `canceled` keep the reference's neutral base.
 */
export function StatusPill({ status, t }: { status: RoutineRun['status']; t: TranslateFn }) {
  const tone =
    status === 'succeeded'
      ? styles.statusSucceeded
      : status === 'running'
        ? styles.statusRunning
        : status === 'failed'
          ? styles.statusFailed
          : '';
  const glyph = status === 'succeeded' ? 'check' : status === 'running' ? 'rotate' : 'circle';
  return (
    <span className={`${styles.status} ${tone}`.trim()} data-status={status}>
      <i className={`fa-solid fa-${glyph}`} aria-hidden="true" />
      {statusLabel(status, t)}
    </span>
  );
}

function AutomationRunHistory({
  routineId,
  refreshKey,
  crystallizingRunId,
  onCrystallizeRun,
  onOpenConversation,
  onFireClick,
  t,
}: {
  routineId: string;
  refreshKey: number;
  crystallizingRunId: string | null;
  onCrystallizeRun: (runId: string) => void;
  onOpenConversation: (run: RoutineRun) => void;
  onFireClick: (element: ClickElement) => void;
  t: TranslateFn;
}) {
  const [runs, setRuns] = useState<RoutineRun[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRuns(null);
    void (async () => {
      try {
        const res = await fetch(`/api/routines/${routineId}/runs?limit=10`);
        if (!res.ok) throw new Error(`runs: ${res.status}`);
        const json = await res.json();
        if (!cancelled) setRuns(json.runs ?? []);
      } catch {
        if (!cancelled) setRuns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, routineId]);

  if (runs === null) {
    return <div className={styles.historyEmpty}>{t('automations.runHistoryLoading')}</div>;
  }

  if (runs.length === 0) {
    return <div className={styles.historyEmpty}>{t('automations.runHistoryEmpty')}</div>;
  }

  return (
    <div className={styles.historyPanel} aria-label={t('automations.runHistoryAria')}>
      <div className={styles.historyTitle}>
        <strong>{t('automations.runHistoryTitle')}</strong>
        <span>{t('automations.runHistoryLatest')}</span>
      </div>
      <ul className={styles.historyList}>
        {runs.map((run) => (
          <li key={run.id} className={styles.historyEntry}>
            <StatusPill status={run.status} t={t} />
            <div className={styles.historyBody}>
              {/* `automations.trigger*`, not `routines.trigger*`: the latter is
                  lowercase for Settings' mid-sentence use, and this line starts
                  with it (`AutomationsScreen.jsx:348`). */}
              <strong>
                {run.trigger === 'manual'
                  ? t('automations.triggerManual')
                  : t('automations.triggerScheduled')}{' '}
                · {formatAutomationTimestamp(run.startedAt)}
              </strong>
              <span>
                {formatRunDuration(run, t)} · {run.agentRunId}
              </span>
              {run.summary || run.error ? (
                <p className={run.error ? styles.historyMessageError : undefined}>
                  {run.error ?? run.summary}
                </p>
              ) : null}
            </div>
            <div className={styles.historyActions}>
              <button
                type="button"
                className={styles.historyButton}
                onClick={() => {
                  onFireClick('view_progress');
                  onOpenConversation(run);
                }}
              >
                {/* No glyph — the reference's `Open conversation` is text only
                    (`AutomationsScreen.jsx:348`). */}
                {t('automations.openConversation')}
              </button>
              {run.status === 'succeeded' ? (
                <button
                  type="button"
                  className={styles.historyButton}
                  onClick={() => {
                    onFireClick('crystallize');
                    onCrystallizeRun(run.id);
                  }}
                  disabled={crystallizingRunId === run.id}
                  title={t('automations.crystallizeTitle')}
                >
                  <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
                  <span>
                    {crystallizingRunId === run.id
                      ? t('automations.crystallizing')
                      : t('automations.crystallize')}
                  </span>
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
