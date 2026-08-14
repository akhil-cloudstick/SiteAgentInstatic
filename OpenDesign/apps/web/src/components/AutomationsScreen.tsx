/**
 * AutomationsScreen — `/automations`, rebuilt as the approved MMSBUILD
 * reference screen (`prototype-reference/src/AutomationsScreen.jsx:306-377`).
 *
 * The reference lays out five blocks and nothing else: a hero (kicker, title,
 * lede, metrics, primary action), the Product Hub handoff band, `Your
 * automations`, `Evolution proposals`, and `Templates` behind a ten-tab filter
 * rail. This replaces the upstream `TasksView`, which shared none of that
 * geometry.
 *
 * ── Reference shape, this app's data ─────────────────────────────────────
 * The build kit is explicit for this surface: "Follow the current upstream
 * scheduled-agent-session/Automations surface. Support the native title,
 * template, prompt, authorized `@` context, project target, schedule,
 * pause/run/edit and proposal states verified in the repository. Do not invent
 * automation targets or cross-client access."
 * (OPEN-DESIGN-DEVELOPER-BUILD-INSTRUCTIONS § Automations.)
 *
 * So every endpoint, payload and analytics event from the previous screen is
 * carried over unchanged; the prototype's two hardcoded Harbour Suites routines
 * and its single fixture proposal are not.
 *
 * ── What the reference does not have, and why it is here anyway ──────────
 *   - an error banner and a loading skeleton: the prototype has no failure or
 *     latency path at all. Both are drawn from the reference's own row card.
 *   - `Crystallize`: the reference has it too (`:348`); the kit requires the
 *     proposal states.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AutomationEvolutionProposal,
  AutomationEvolutionProposalListResponse,
  AutomationsClickProps,
  AutomationTemplate as ContractAutomationTemplate,
  AutomationTemplateListResponse,
  ConnectorDetail,
  Routine,
  RoutineRun,
  RoutineRunCrystallizeResponse,
} from '@open-design/contracts';
import { VisuallyHidden } from '@open-design/components';

import { navigate } from '../router';
import { useT } from '../i18n';
import { useAnalytics } from '../analytics/provider';
import { trackAutomationsClick, trackPageView } from '../analytics/events';
import { useHubContext } from '../state/hubContext';
import type { DesignSystemSummary, Project, SkillSummary } from '../types';
import { ContextHandoffBand } from './start-desk/ContextSurfaces';
import { ProductHubContextDrawer } from './start-desk/ProductHubContextDrawer';
import { deriveInheritedContext } from './start-desk/inherited-context';
import { resolveProjectDesignSystemId } from './design-system-project';
import { AutomationRow } from './AutomationRow';
import { AutomationComposeModal } from './AutomationComposeModal';
import {
  buildAutomationTemplates,
  filterTemplates,
  templateAccentClass,
  templateFilters,
  templateKindLabel,
  type AutomationTemplate,
  type TemplateFilter,
} from './automationTemplates';
import styles from './AutomationsScreen.module.css';

type ProjectSummary = { id: string; name: string };
type Modal = { kind: 'create'; template?: AutomationTemplate } | { kind: 'edit'; routine: Routine } | null;

/** Enough placeholder rows to fill the panel on a laptop without overflowing it. */
const SKELETON_ROWS = ['a', 'b', 'c'] as const;

export interface AutomationsScreenProps {
  skills?: SkillSummary[];
  designTemplates?: SkillSummary[];
  connectors?: ConnectorDetail[];
  connectorsLoading?: boolean;
  /**
   * Only for the handoff band's project-owned fact — the automation target
   * picker keeps its own `/api/projects` fetch, unchanged.
   */
  projects?: Project[];
  designSystems?: DesignSystemSummary[];
  /** False while the view is parked off-screen, so the page view fires once. */
  isActive?: boolean;
}

export function AutomationsScreen({
  skills = [],
  designTemplates = [],
  connectors = [],
  projects: hubProjects = [],
  designSystems = [],
  isActive = true,
}: AutomationsScreenProps) {
  const t = useT();
  const analytics = useAnalytics();
  const hubContext = useHubContext();

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [templateFilter, setTemplateFilter] = useState<TemplateFilter>('all');
  const [automationCatalog, setAutomationCatalog] = useState<ContractAutomationTemplate[]>([]);
  const [proposals, setProposals] = useState<AutomationEvolutionProposal[]>([]);
  const [proposalBusyId, setProposalBusyId] = useState<string | null>(null);
  const [crystallizingRunId, setCrystallizingRunId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [focusRoutineId, setFocusRoutineId] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [contextOpen, setContextOpen] = useState(false);
  const routineRowRefs = useRef<Record<string, HTMLLIElement | null>>({});

  // P2 `page_view page_name=automations`, once per mount.
  const pageViewFired = useRef(false);
  useEffect(() => {
    if (pageViewFired.current || !isActive) return;
    pageViewFired.current = true;
    trackPageView(analytics.track, { page_name: 'automations' });
  }, [analytics.track, isActive]);

  // P2 `ui_click page_name=automations`. Fired BEFORE each handler so a
  // navigation that unmounts the view still reports.
  const fireClick = useCallback(
    (
      element: AutomationsClickProps['element'],
      extra?: Pick<AutomationsClickProps, 'type_id' | 'filter_id' | 'template_kind'>,
    ) => {
      trackAutomationsClick(analytics.track, {
        page_name: 'automations',
        area: 'automations',
        element,
        ...extra,
      });
    },
    [analytics.track],
  );

  const templates = useMemo(
    () => buildAutomationTemplates(designTemplates, automationCatalog, t),
    [automationCatalog, designTemplates, t],
  );
  const filteredTemplates = useMemo(
    () => filterTemplates(templates, templateFilter),
    [templates, templateFilter],
  );

  const refresh = useCallback(async (): Promise<{ proposalRefreshFailed: boolean }> => {
    let proposalRefreshFailed = false;
    try {
      const templateRequest = fetch('/api/automation-templates')
        .then(async (res) => {
          if (!res.ok) return null;
          return (await res.json()) as AutomationTemplateListResponse;
        })
        .catch(() => null);
      const proposalRequest = fetch('/api/automation-proposals?status=pending-review')
        .then(async (res) => {
          if (!res.ok) {
            proposalRefreshFailed = true;
            return null;
          }
          return (await res.json()) as AutomationEvolutionProposalListResponse;
        })
        .catch(() => {
          proposalRefreshFailed = true;
          return null;
        });
      const [rRes, pRes, tJson, proposalJson] = await Promise.all([
        fetch('/api/routines'),
        fetch('/api/projects'),
        templateRequest,
        proposalRequest,
      ]);
      if (!rRes.ok) throw new Error(`routines: ${rRes.status}`);
      const rJson = await rRes.json();
      setRoutines(rJson.routines ?? []);
      if (pRes.ok) {
        const pJson = await pRes.json();
        setProjects(
          (pJson.projects ?? []).map((p: ProjectSummary) => ({ id: p.id, name: p.name })),
        );
      }
      if (tJson) setAutomationCatalog(Array.isArray(tJson.templates) ? tJson.templates : []);
      if (proposalJson) setProposals(Array.isArray(proposalJson.proposals) ? proposalJson.proposals : []);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
    return { proposalRefreshFailed };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const projectsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) map.set(project.id, project.name);
    return map;
  }, [projects]);

  const sortedRoutines = useMemo(() => sortRoutinesNewestFirst(routines), [routines]);

  useEffect(() => {
    if (!focusRoutineId) return;
    routineRowRefs.current[focusRoutineId]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const timer = window.setTimeout(() => setFocusRoutineId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [focusRoutineId, sortedRoutines]);

  // The handoff band's project-owned fact, derived exactly as the Projects
  // screen derives it so both surfaces report the same design system.
  const boundDesignSystemName = useMemo(() => {
    const ordered = [...hubProjects].sort((a, b) => b.updatedAt - a.updatedAt);
    const scoped = hubContext?.project
      ? ordered.find((project) => project.name === hubContext.project)
      : undefined;
    const source = scoped ?? ordered[0];
    if (!source) return null;
    const id = resolveProjectDesignSystemId(source);
    return designSystems.find((system) => system.id === id)?.title ?? null;
  }, [designSystems, hubContext?.project, hubProjects]);

  const inherited = useMemo(
    () => deriveInheritedContext(hubContext, boundDesignSystemName),
    [boundDesignSystemName, hubContext],
  );

  const activeCount = sortedRoutines.filter((routine) => routine.enabled).length;
  const pausedCount = sortedRoutines.length - activeCount;

  const reviewProposal = async (id: string, action: 'apply' | 'reject') => {
    setProposalBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/automation-proposals/${id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: action === 'reject' ? JSON.stringify({ reason: t('automations.proposalsDismissReason') }) : '{}',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `${action} failed: ${res.status}`);
      }
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setProposalBusyId(null);
    }
  };

  const runNow = async (id: string) => {
    setBusyId(id);
    setRunningId(id);
    setError(null);
    try {
      const res = await fetch(`/api/routines/${id}/run`, { method: 'POST' });
      if (!res.ok && res.status !== 202) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `run failed: ${res.status}`);
      }
      const json = await res.json().catch(() => null);
      if (json?.projectId) {
        navigate({
          kind: 'project',
          projectId: json.projectId,
          conversationId: json.conversationId ?? null,
          fileName: null,
        });
        return;
      }
      void refresh();
      setExpandedId(id);
      setHistoryTick((tick) => tick + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
      setRunningId(null);
    }
  };

  const crystallizeRun = async (routineId: string, runId: string) => {
    setCrystallizingRunId(runId);
    setError(null);
    try {
      const res = await fetch(`/api/routines/${routineId}/runs/${runId}/crystallize`, {
        method: 'POST',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `crystallize failed: ${res.status}`);
      }
      const json = (await res.json()) as RoutineRunCrystallizeResponse;
      const createdProposals = Array.isArray(json.proposals) ? json.proposals : [];
      if (createdProposals.length > 0) {
        setProposals((current) => mergeAutomationProposals(current, createdProposals));
      }
      const { proposalRefreshFailed } = await refresh();
      if (proposalRefreshFailed) {
        setError(
          createdProposals.length > 0
            ? t('automations.crystallizePartialSuccess')
            : t('automations.crystallizeRefreshFailed'),
        );
      } else if (createdProposals.length === 0) {
        setError(t('automations.crystallizeNoProposals'));
      }
    } catch (err) {
      setError(t('automations.crystallizeFailed', { error: errorMessage(err) }));
    } finally {
      setCrystallizingRunId(null);
    }
  };

  const togglePaused = async (routine: Routine) => {
    setBusyId(routine.id);
    try {
      const res = await fetch(`/api/routines/${routine.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !routine.enabled }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `update failed: ${res.status}`);
      }
      void refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('automations.deleteConfirm'))) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/routines/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `delete failed: ${res.status}`);
      }
      if (expandedId === id) setExpandedId(null);
      void refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const openConversation = (projectId: string, conversationId: string | null) => {
    navigate({ kind: 'project', projectId, conversationId, fileName: null });
  };

  return (
    <main className={styles.screen} aria-labelledby="automations-title" data-testid="tasks-view">
      <header className={styles.hero}>
        <div>
          <p className={styles.kicker}>{t('automations.eyebrow')}</p>
          <h1 id="automations-title">{t('automations.title')}</h1>
          <p className={styles.heroLede}>{t('automations.lede')}</p>
        </div>
        <div className={styles.heroActions}>
          <div className={styles.metrics} aria-label={t('automations.summaryAria')}>
            <span>
              <strong>{activeCount}</strong>
              {t('automations.metricActive')}
            </span>
            <span>
              <strong>{pausedCount}</strong>
              {t('automations.metricPaused')}
            </span>
            <span>
              <strong>{templates.length}</strong>
              {t('automations.metricTemplates')}
            </span>
          </div>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={() => {
              fireClick('new_automation');
              setModal({ kind: 'create' });
            }}
            data-testid="automations-new"
          >
            <i className="fa-solid fa-plus" aria-hidden="true" />
            <span>{t('automations.newAutomation')}</span>
          </button>
        </div>
      </header>

      <ContextHandoffBand
        context={inherited}
        className={styles.handoffCompact}
        onOpenContext={() => setContextOpen(true)}
      />

      {error ? (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      ) : null}

      <section className={styles.section} aria-label={t('automations.yourAutomations')}>
        <div className={styles.sectionHead}>
          <h2>{t('automations.yourAutomations')}</h2>
          <span className={styles.sectionMeta}>
            {loading
              ? t('automations.loading')
              : t('automations.savedCount', { n: sortedRoutines.length })}
          </span>
        </div>

        {loading ? (
          <div data-testid="automations-loading" role="status" aria-busy="true">
            <VisuallyHidden>{t('automations.loading')}</VisuallyHidden>
            {/* Sweeping bar above the placeholder rows. Static bars alone read
                as a stalled page; the same pairing the Projects screen uses. */}
            <div className={styles.progressTrack} aria-hidden="true" />
            {SKELETON_ROWS.map((key) => (
              <div key={key} className={styles.skeletonRow} aria-hidden="true">
                <span className={styles.skeletonMark} />
                <div className={styles.skeletonLines}>
                  <span />
                  <span />
                  <span />
                </div>
                <span className={styles.skeletonAction} />
              </div>
            ))}
          </div>
        ) : sortedRoutines.length === 0 ? (
          <div className={styles.empty} data-testid="automations-empty">
            <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
            <strong>{t('automations.emptyTitle')}</strong>
            <span>{t('automations.emptyBody')}</span>
          </div>
        ) : (
          <ul className={styles.list}>
            {sortedRoutines.map((routine) => (
              <AutomationRow
                key={routine.id}
                routine={routine}
                targetLabel={
                  routine.target.mode === 'reuse'
                    ? (projectsById.get(routine.target.projectId) ?? routine.target.projectId)
                    : t('automations.targetNewEachRun')
                }
                busy={busyId === routine.id}
                running={runningId === routine.id}
                expanded={expandedId === routine.id}
                focused={focusRoutineId === routine.id}
                historyTick={historyTick}
                crystallizingRunId={crystallizingRunId}
                rowRef={(node) => {
                  routineRowRefs.current[routine.id] = node;
                }}
                onRun={() => void runNow(routine.id)}
                onToggleHistory={() => {
                  const next = expandedId === routine.id ? null : routine.id;
                  setExpandedId(next);
                  if (next) setHistoryTick((tick) => tick + 1);
                }}
                onEdit={() => setModal({ kind: 'edit', routine })}
                onTogglePaused={() => void togglePaused(routine)}
                onDelete={() => void remove(routine.id)}
                onOpenResult={() => {
                  const lastRun = routine.lastRun;
                  if (!lastRun) return;
                  openConversation(lastRun.projectId, lastRun.conversationId);
                }}
                onOpenConversation={(run: RoutineRun) =>
                  openConversation(run.projectId, run.conversationId)
                }
                onCrystallizeRun={(runId) => void crystallizeRun(routine.id, runId)}
                onFireClick={fireClick}
              />
            ))}
          </ul>
        )}
      </section>

      {proposals.length > 0 ? (
        <section className={styles.section} aria-label={t('automations.proposalsAria')}>
          <div className={styles.sectionHead}>
            <div>
              <h2>{t('automations.proposalsTitle')}</h2>
              <p>{t('automations.proposalsSub')}</p>
            </div>
            <span className={styles.sectionMeta}>
              {t('automations.proposalsPending', { n: proposals.length })}
            </span>
          </div>
          <ul className={styles.list}>
            {proposals.map((proposal) => (
              <li key={proposal.id} className={styles.proposalRow}>
                <span className={styles.rowIcon} aria-hidden="true">
                  <i
                    className={`fa-solid fa-${
                      proposal.targetKind === 'design-system' ? 'sliders' : 'wand-magic-sparkles'
                    }`}
                  />
                </span>
                <div className={styles.rowCopy}>
                  <h3>{proposal.title}</h3>
                  <p className={styles.rowMeta}>
                    <span>{proposalTargetLabel(proposal.targetKind, t)}</span>
                    <i>·</i>
                    <span>{proposalActionLabel(proposal.action, t)}</span>
                    <i>·</i>
                    <span>{reviewPolicyLabel(proposal.reviewPolicy, t)}</span>
                  </p>
                  <p className={styles.proposalSummary}>{proposal.summary}</p>
                  {proposal.patch.diffSummary ? (
                    <small className={styles.proposalDiff}>{proposal.patch.diffSummary}</small>
                  ) : null}
                </div>
                <div className={styles.proposalActions}>
                  <button
                    type="button"
                    className={styles.proposalButton}
                    onClick={() => {
                      fireClick('proposal_apply');
                      void reviewProposal(proposal.id, 'apply');
                    }}
                    disabled={proposalBusyId === proposal.id}
                  >
                    <i className="fa-solid fa-check" aria-hidden="true" />
                    <span>{t('automations.apply')}</span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.proposalButton} ${styles.danger}`}
                    onClick={() => {
                      fireClick('proposal_reject');
                      void reviewProposal(proposal.id, 'reject');
                    }}
                    disabled={proposalBusyId === proposal.id}
                  >
                    {t('automations.reject')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.section} aria-label={t('automations.templatesAria')}>
        <div className={styles.sectionHead}>
          <div>
            <h2>{t('automations.templatesTitle')}</h2>
            <p>{t('automations.templatesSub')}</p>
          </div>
          <span className={styles.sectionMeta}>
            {t('automations.templatesCount', {
              filtered: filteredTemplates.length,
              total: templates.length,
            })}
          </span>
        </div>

        <div
          className={styles.filterTabs}
          role="tablist"
          aria-label={t('automations.templateFiltersAria')}
        >
          {templateFilters(t).map((filter) => {
            const isActiveTab = templateFilter === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                role="tab"
                aria-selected={isActiveTab}
                className={`${styles.filterTab} ${isActiveTab ? styles.filterTabActive : ''}`.trim()}
                onClick={() => {
                  fireClick('filter_tab', { filter_id: filter.id });
                  setTemplateFilter(filter.id);
                }}
              >
                {filter.label}
                <span>{filterTemplates(templates, filter.id).length}</span>
              </button>
            );
          })}
        </div>

        {filteredTemplates.length === 0 ? (
          <div className={styles.empty} role="status">
            <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
            <strong>{t('automations.templatesEmptyTitle')}</strong>
            <span>{t('automations.templatesEmptyBody')}</span>
          </div>
        ) : (
          <div className={styles.templateGrid} key={templateFilter}>
            {filteredTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`${styles.templateCard} ${templateAccentClass(template.category, styles)}`.trim()}
                onClick={() => {
                  fireClick('type_card', { template_kind: template.kind });
                  setModal({ kind: 'create', template });
                }}
              >
                <span className={styles.cardIcon} aria-hidden="true">
                  <i className={`fa-solid fa-${template.icon}`} />
                </span>
                <span className={styles.templateContent}>
                  <small>
                    <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
                    {templateKindLabel(template.kind, t)}
                  </small>
                  <strong>{template.title}</strong>
                  <p>{template.description}</p>
                  <em>
                    {t('automations.useTemplate')}
                    <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                  </em>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <AutomationComposeModal
        open={modal !== null}
        initial={
          modal?.kind === 'edit'
            ? { routine: modal.routine }
            : modal?.kind === 'create' && modal.template
              ? { template: modal.template }
              : null
        }
        templates={templates}
        projects={projects}
        skills={skills}
        connectors={connectors}
        onClose={() => setModal(null)}
        onSaved={(routine) => {
          void (async () => {
            await refresh();
            setExpandedId(routine.id);
            setFocusRoutineId(routine.id);
          })();
        }}
      />

      <ProductHubContextDrawer
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        context={inherited}
        hubContext={hubContext}
      />
    </main>
  );
}

export function sortRoutinesNewestFirst(routines: Routine[]): Routine[] {
  return [...routines].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

type TranslateFn = ReturnType<typeof useT>;

function proposalTargetLabel(
  target: AutomationEvolutionProposal['targetKind'],
  t: TranslateFn,
): string {
  if (target === 'memory-node') return t('automations.proposalTargetMemory');
  if (target === 'design-system') return t('automations.proposalTargetDesignSystem');
  if (target === 'skill') return t('automations.proposalTargetSkill');
  return t('automations.proposalTargetTemplate');
}

function proposalActionLabel(action: AutomationEvolutionProposal['action'], t: TranslateFn): string {
  if (action === 'create') return t('automations.proposalActionCreate');
  if (action === 'update') return t('automations.proposalActionUpdate');
  if (action === 'merge') return t('automations.proposalActionMerge');
  if (action === 'move') return t('automations.proposalActionMove');
  if (action === 'delete') return t('automations.proposalActionDelete');
  return t('automations.proposalActionPromote');
}

/**
 * The reference's third meta chip reads as prose ("Human review",
 * `AutomationsScreen.jsx:275`); the contract carries the raw policy enum, which
 * previously leaked to the UI as `always` / `trusted-source`.
 */
function reviewPolicyLabel(
  policy: AutomationEvolutionProposal['reviewPolicy'],
  t: TranslateFn,
): string {
  if (policy === 'trusted-source') return t('automations.reviewPolicyTrustedSource');
  if (policy === 'auto-apply') return t('automations.reviewPolicyAutoApply');
  return t('automations.reviewPolicyAlways');
}

function mergeAutomationProposals(
  current: AutomationEvolutionProposal[],
  incoming: AutomationEvolutionProposal[],
): AutomationEvolutionProposal[] {
  const merged = new Map(current.map((proposal) => [proposal.id, proposal]));
  for (const proposal of incoming) merged.set(proposal.id, proposal);
  return Array.from(merged.values()).sort((a, b) => {
    const bTime = Date.parse(b.createdAt);
    const aTime = Date.parse(a.createdAt);
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
