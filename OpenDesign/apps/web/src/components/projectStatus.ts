/**
 * projectStatus — the shared vocabulary for a project's display status.
 *
 * These used to live in `DesignsTab.tsx`, which was both the Projects page and
 * the only home for constants the Home page's `RecentProjectsStrip` also needs.
 * The Projects page was rebuilt to the approved MMS Design reference and
 * `DesignsTab` went away with it, so the vocabulary moved here rather than into
 * whichever component happened to render it next.
 */
import type { useT } from '../i18n';
import type { ProjectDisplayStatus } from '../types';

/**
 * Display order for the seven distinct statuses. `queued` is absent on purpose:
 * it normalizes into `running` (see `normalizeStatus`), so it never gets a slot
 * of its own.
 */
export const STATUS_ORDER = [
  'not_started',
  'running',
  'awaiting_input',
  'incomplete',
  'succeeded',
  'failed',
  'canceled',
] as const satisfies readonly ProjectDisplayStatus[];

export const STATUS_LABEL_KEYS = {
  not_started: 'designs.status.notStarted',
  queued: 'designs.status.queued',
  running: 'designs.status.running',
  awaiting_input: 'designs.status.awaitingInput',
  incomplete: 'designs.status.incomplete',
  succeeded: 'designs.status.succeeded',
  failed: 'designs.status.failed',
  canceled: 'designs.status.canceled',
} as const satisfies Record<ProjectDisplayStatus, Parameters<ReturnType<typeof useT>>[0]>;

/** `queued` and `running` read identically to a user; collapse them. */
export function normalizeStatus(
  status: ProjectDisplayStatus,
): Exclude<ProjectDisplayStatus, 'queued'> {
  return status === 'queued' ? 'running' : status;
}

export function statusLabel(status: ProjectDisplayStatus, t: ReturnType<typeof useT>): string {
  return t(STATUS_LABEL_KEYS[status]);
}

/**
 * Statuses that mean "nothing is waiting on the user". The reference row draws
 * these in the `.ready` (green) meta tone.
 */
export function isReadyStatus(status: ProjectDisplayStatus): boolean {
  return normalizeStatus(status) === 'succeeded' || normalizeStatus(status) === 'not_started';
}

/**
 * Statuses that mean "this needs attention". The reference row draws these in
 * the `.pending` (amber) meta tone. Everything else is neutral.
 */
export function isPendingStatus(status: ProjectDisplayStatus): boolean {
  const normalized = normalizeStatus(status);
  return (
    normalized === 'awaiting_input' || normalized === 'incomplete' || normalized === 'failed'
  );
}

export function relativeTime(ts: number, t: ReturnType<typeof useT>): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return t('common.justNow');
  if (diff < hr) return t('common.minutesAgo', { n: Math.floor(diff / min) });
  if (diff < day) return t('common.hoursAgo', { n: Math.floor(diff / hr) });
  if (diff < 7 * day) return t('common.daysAgo', { n: Math.floor(diff / day) });
  return new Date(ts).toLocaleDateString();
}
