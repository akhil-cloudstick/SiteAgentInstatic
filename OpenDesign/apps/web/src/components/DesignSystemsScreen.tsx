/**
 * DesignSystemsScreen — `/design-systems`, rebuilt as the approved MMSBUILD
 * reference screen (`prototype-reference/src/DesignSystemsScreen.jsx`).
 *
 * The reference lays out four blocks: a page head (kicker, title, subtitle,
 * primary action), the Product Hub handoff band, a scope/search row, and one
 * bordered `304px | 1fr` master-detail card whose right pane is a 2-column grid
 * of five read-only modules. This replaces the upstream tab, whose Create
 * button, search and filters lived inside the sidebar and whose detail pane
 * rendered the 10-module `DesignKitView`.
 *
 * ── What is deliberately absent ──────────────────────────────────────────
 * `DesignKitView` and everything that came with it on this surface: logo
 * upload, the image gallery, the colour editor, asset management and inline
 * DESIGN.md editing. None exist on the reference screen; all of them remain
 * reachable from the in-project Design System tab and the Brands tab, which
 * still render `DesignKitView` unchanged.
 *
 * The reference's "Share to team" overflow item is also absent: it is an
 * `onNotice(...)` stub with no handler behind it, and the build instructions
 * (§5) name prototype notices among the behaviours a developer must not
 * preserve.
 *
 * There is no Enterprise scope tab either — it was a "Coming soon" placeholder
 * with nothing behind it, and the approved screen has two scopes.
 *
 * ── What is added, and why ───────────────────────────────────────────────
 * The surface pills and the style-category select have no counterpart on the
 * reference, which browses two fixed arrays. They are real product filters over
 * a 150-package catalogue and are not being dropped, so they take the
 * reference's OWN filter treatment from its Plugins screen rather than an
 * invented one. The select sits at the top of the list column it filters; the
 * pills stay in a row under the scope tabs.
 *
 * The provenance flow is gated on the Harbour Suites fixture in the reference
 * (`selected.id === "harbour-suites"`), which §5 names as a defect. It renders
 * here for project-owned systems whenever a real Product Hub context fronts the
 * session — "keep provenance visible" (§3) without the fixture.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { VisuallyHidden } from '@open-design/components';
import { useAnalytics } from '../analytics/provider';
import {
  trackDesignSystemsTopClick,
  trackDesignSystemStatusResult,
  trackDesignSystemEditClick,
  trackPageView,
} from '../analytics/events';
import type { DesignSystemEditClickProps } from '@open-design/contracts/analytics';
import type {
  TrackingDesignSystemStatusAction,
  TrackingDesignSystemStatusValue,
} from '@open-design/contracts/analytics';
import { useI18n } from '../i18n';
import type { Locale } from '../i18n/types';
import {
  localizeDesignSystemCategory,
  localizeDesignSystemSummary,
} from '../i18n/content';
import { takeDesignSystemFocus } from '../runtime/brands';
import {
  deleteDesignSystemDraft,
  fetchDesignSystem,
  updateDesignSystemDraft,
} from '../providers/registry';
import { downloadDesignSystemArchive, downloadProjectArchive } from '../runtime/exports';
import { fontStack, useDesignKit, type DesignKit } from '../runtime/design-kit';
import { useHubContext } from '../state/hubContext';
import { deriveInheritedContext } from './start-desk/inherited-context';
import { ContextHandoffBand } from './start-desk/ContextSurfaces';
import { ProductHubContextDrawer } from './start-desk/ProductHubContextDrawer';
import { CreateDesignSystemDialog } from './CreateDesignSystemDialog';
import { CustomSelect } from './CustomSelect';
import { designSystemLogoHost, isUserSystem } from './design-system-metadata';
import { relativeTime } from './projectStatus';
import { Toast } from './Toast';
import type { DesignSystemDetail, DesignSystemSummary } from '../types';
import styles from './DesignSystemsScreen.module.css';

type ActionTone = 'success' | 'error' | 'loading';

interface Props {
  systems: DesignSystemSummary[];
  /** The globally-selected default design system, not the previewed row. */
  selectedId: string | null;
  /** `null` clears the default (config's `designSystemId` is nullable). */
  onSelect: (id: string | null) => void;
  loading?: boolean;
  onOpenSystem?: (id: string) => void;
  onSystemsRefresh?: () => Promise<void> | void;
  /** False while the view is parked off-screen, so the page view fires once. */
  isActive?: boolean;
}

const CATEGORY_ORDER = [
  'Starter',
  'AI & LLM',
  'Developer Tools',
  'Productivity & SaaS',
  'Backend & Data',
  'Design & Creative',
  'Fintech & Crypto',
  'E-Commerce & Retail',
  'Media & Consumer',
  'Automotive',
];

type DesignSystemCollection = 'mine' | 'official';
type DesignSystemActionKind = 'edit' | 'publish' | 'default' | 'delete';

/* The surface pill row (`All 151` / `Web 151` / …) was removed on request:
   every shipped preset is a `web` surface, so the row rendered one meaningful
   chip whose count equalled `All`'s — a filter that could not filter. The
   style-category select inside the list is the only preset filter now. */

/** Enough placeholder rows to fill the 304px column without overflowing it. */
const SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e'] as const;

// `system.status` is the DesignSystemSummary status string from the daemon; map
// it onto the tracking enum used by
// `design_system_status_result.status_before|status_after`. The summary type
// today only carries `'draft' | 'published'`; the wider tracking enum keeps room
// for `ready`/`failed`/`archived` once those land server-side. Unknown values
// collapse to `'unknown'`.
function mapStatusToTracking(
  status: string | null | undefined,
): TrackingDesignSystemStatusValue {
  switch (status) {
    case 'draft':
    case 'published':
      return status;
    default:
      return 'unknown';
  }
}

function systemMatchesQuery(
  locale: Locale,
  system: DesignSystemSummary,
  query: string,
): boolean {
  if (!query) return true;
  const summary = localizeDesignSystemSummary(locale, system).toLowerCase();
  const categoryLabel = localizeDesignSystemCategory(
    locale,
    system.category || 'Uncategorized',
  ).toLowerCase();
  return (
    system.title.toLowerCase().includes(query) ||
    system.summary.toLowerCase().includes(query) ||
    summary.includes(query) ||
    categoryLabel.includes(query)
  );
}

/**
 * The reference's two-letter mark, derived with its own algorithm
 * (`DesignSystemsScreen.jsx:320`): the initials of the first two words,
 * uppercased. Its fixture carries `mark` as data; real systems do not.
 */
function markOf(title: string): string {
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
  return initials || '??';
}

/**
 * Deterministic stand-in palette for a system whose package declares no
 * swatches. Hashing the title keeps a given system's mark stable between
 * renders and sessions — a random palette would make the list flicker.
 */
function fallbackSwatches(seed: string): string[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const base = h % 360;
  return [
    `hsl(${base}, 24%, 94%)`,
    `hsl(${(base + 90) % 360}, 34%, 74%)`,
    `hsl(${(base + 180) % 360}, 42%, 34%)`,
    `hsl(${(base + 28) % 360}, 76%, 54%)`,
  ];
}

function swatchesOf(system: DesignSystemSummary): string[] {
  return system.swatches && system.swatches.length > 0
    ? system.swatches
    : fallbackSwatches(system.title || system.id);
}

/** `.ds-row-palette` — the reference sizes its columns from the swatch count. */
function SystemPalette({ colors, compact = false }: { colors: string[]; compact?: boolean }) {
  return (
    <span
      className={compact ? `${styles.rowPalette} ${styles.rowPaletteCompact}` : styles.rowPalette}
      style={{ gridTemplateColumns: `repeat(${colors.length}, minmax(0, 1fr))` }}
      aria-hidden
    >
      {colors.map((color, index) => (
        <span key={`${color}-${index}`} style={{ background: color }} />
      ))}
    </span>
  );
}

export function DesignSystemsScreen({
  systems,
  selectedId,
  onSelect,
  loading = false,
  onOpenSystem,
  onSystemsRefresh,
  isActive = true,
}: Props) {
  const { locale, t } = useI18n();
  const analytics = useAnalytics();
  const hubContext = useHubContext();

  const [filter, setFilter] = useState('');
  const [designSystemCollection, setDesignSystemCollection] = useState<DesignSystemCollection>('mine');
  const [category, setCategory] = useState<string>('All');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<{ systemId: string; action: DesignSystemActionKind } | null>(null);
  const [actionToast, setActionToast] = useState<{ message: string; tone: ActionTone } | null>(null);

  // A one-shot design-system id another surface asked us to preselect (e.g. the
  // brand-extraction "ready" prompt navigating here). Read+cleared from
  // sessionStorage exactly once; applied by the effect below once the system
  // actually shows up in the loaded list (which may arrive after a refresh).
  const [pendingFocus, setPendingFocus] = useState<string | null>(() => takeDesignSystemFocus());

  const busyId = busyAction?.systemId ?? null;
  const q = filter.trim().toLowerCase();

  const pageViewFired = useRef(false);
  const searchTracked = useRef(false);
  const categoryTracked = useRef(false);

  useEffect(() => {
    if (loading || pageViewFired.current || !isActive) return;
    pageViewFired.current = true;
    // v2 doc: the DS list page also carries `area` / `view_type` / `entry_from`
    // so it can stitch the cross-surface DS funnel. `entry_from` is `unknown`
    // here because the tab is reached through the specialist nav row.
    trackPageView(analytics.track, {
      page_name: 'design_systems',
      area: 'design_system_list',
      view_type: 'page',
      entry_from: 'unknown',
      available_design_system_count: systems.length,
    });
  }, [analytics.track, systems.length, loading, isActive]);

  const notifyAction = useCallback((tone: ActionTone, message: string) => {
    setActionToast({ tone, message });
  }, []);

  const notifyActionLoading = useCallback(
    (label?: string) => {
      const message = label
        ? label.endsWith('…') || label.endsWith('...')
          ? label
          : `${label}...`
        : t('common.loading');
      notifyAction('loading', message);
    },
    [notifyAction, t],
  );

  const librarySystems = useMemo(
    () => systems.filter((system) => !isUserSystem(system)),
    [systems],
  );

  const userSystems = useMemo(() => systems.filter(isUserSystem), [systems]);

  const userSearched = useMemo(
    () => userSystems.filter((s) => systemMatchesQuery(locale, s, q)),
    [userSystems, locale, q],
  );

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const s of librarySystems) cats.add(s.category || 'Uncategorized');
    const ordered: string[] = [];
    for (const c of CATEGORY_ORDER) if (cats.has(c)) ordered.push(c);
    for (const c of [...cats].sort()) if (!ordered.includes(c)) ordered.push(c);
    return ['All', ...ordered];
  }, [librarySystems]);

  // Drop a style category that the catalogue no longer contains, so the list
  // cannot end up filtered by a value the select can no longer show.
  useEffect(() => {
    if (category !== 'All' && !categories.includes(category)) setCategory('All');
  }, [systems, category, categories]);

  // Systems matching the active style category and search text.
  const queryScoped = useMemo(
    () =>
      librarySystems.filter((s) => {
        if (category !== 'All' && (s.category || 'Uncategorized') !== category) return false;
        return systemMatchesQuery(locale, s, q);
      }),
    [librarySystems, q, category, locale],
  );

  const filtered = queryScoped;

  const visibleSystems = useMemo<DesignSystemSummary[]>(() => {
    if (designSystemCollection === 'mine') return userSearched;
    if (designSystemCollection === 'official') return filtered;
    return [];
  }, [designSystemCollection, userSearched, filtered]);

  const visibleIds = useMemo(() => visibleSystems.map((s) => s.id), [visibleSystems]);

  // Reference `:279-281` — when the visible set no longer contains the
  // selection, fall back to the first row. Empty scopes clear it.
  useEffect(() => {
    if (visibleIds.length === 0) {
      setPreviewId(null);
      return;
    }
    setPreviewId((cur) => (cur && visibleIds.includes(cur) ? cur : visibleIds[0] ?? null));
  }, [visibleIds]);

  // Apply a pending focus once the requested system is present in the catalog.
  // Runs again whenever `systems` changes, so a focus that arrived before the
  // freshly-finalized brand design system loaded still lands after the refresh.
  useEffect(() => {
    if (!pendingFocus) return;
    const sys = systems.find((s) => s.id === pendingFocus);
    if (!sys) return; // not in the loaded list yet — wait for the next refresh
    if (isUserSystem(sys)) setDesignSystemCollection('mine');
    setPreviewId(pendingFocus);
    setPendingFocus(null);
  }, [pendingFocus, systems]);

  const selected = useMemo(
    () => visibleSystems.find((s) => s.id === previewId) ?? visibleSystems[0] ?? null,
    [previewId, visibleSystems],
  );

  const inherited = useMemo(
    () => deriveInheritedContext(hubContext, selected?.title ?? null),
    [hubContext, selected?.title],
  );

  // Category metadata is authored in English; keep raw values in state for
  // filtering while localizing the visible labels for the current UI locale.
  const renderCategory = (c: string) => {
    if (c === 'All') return t('ds.categoryAll');
    if (c === 'Uncategorized') return t('ds.categoryUncategorized');
    return localizeDesignSystemCategory(locale, c);
  };

  async function refreshSystems() {
    await onSystemsRefresh?.();
  }

  async function togglePublished(system: DesignSystemSummary) {
    if (busyAction) return;
    setBusyAction({ systemId: system.id, action: 'publish' });
    notifyActionLoading();
    const startedAt = performance.now();
    const willPublish = system.status !== 'published';
    const action: TrackingDesignSystemStatusAction = willPublish ? 'publish' : 'unpublish';
    const statusBefore = mapStatusToTracking(system.status);
    const isDefaultBefore = system.id === selectedId;
    let succeeded = false;
    let errorCode: string | undefined;
    try {
      const updated = await updateDesignSystemDraft(system.id, {
        status: willPublish ? 'published' : 'draft',
      });
      succeeded = Boolean(updated);
      if (!succeeded) errorCode = 'DS_STATUS_UPDATE_RETURNED_NULL';
      if (succeeded) {
        // Reference `:294` — unpublishing the chat default clears the default,
        // because an unpublished system is not eligible to back new chats.
        if (!willPublish && isDefaultBefore) onSelect(null);
        await refreshSystems();
        notifyAction('success', t('ds.actionDone'));
      } else {
        notifyAction('error', t('ds.actionFailed'));
      }
    } catch (err) {
      errorCode =
        err instanceof Error
          ? `DS_STATUS_UPDATE_THREW:${err.message.slice(0, 80)}`
          : 'DS_STATUS_UPDATE_THREW';
      notifyAction('error', t('ds.actionFailed'));
    } finally {
      trackDesignSystemStatusResult(analytics.track, {
        page_name: 'design_systems',
        area: 'design_system_status',
        action,
        result: succeeded ? 'success' : 'failed',
        design_system_id: system.id,
        project_id: system.projectId ?? undefined,
        status_before: statusBefore,
        status_after: succeeded
          ? willPublish
            ? 'published'
            : 'draft'
          : statusBefore,
        is_default_before: isDefaultBefore,
        is_default_after: succeeded && !willPublish && isDefaultBefore ? false : isDefaultBefore,
        error_code: errorCode,
        duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      });
      setBusyAction(null);
    }
  }

  async function deleteSystem(system: DesignSystemSummary) {
    if (busyAction) return;
    // Reference `:299` — a plain confirm before a destructive action.
    if (!window.confirm(t('ds.deleteProjectConfirm', { title: system.title }))) return;
    setBusyAction({ systemId: system.id, action: 'delete' });
    notifyActionLoading();
    try {
      const ok = await deleteDesignSystemDraft(system.id);
      if (ok) {
        if (system.id === selectedId) onSelect(null);
        await refreshSystems();
        notifyAction('success', t('ds.actionDone'));
      } else {
        notifyAction('error', t('ds.actionFailed'));
      }
    } catch {
      notifyAction('error', t('ds.actionFailed'));
    } finally {
      setBusyAction(null);
    }
  }

  async function makeDefault(system: DesignSystemSummary) {
    if (busyAction) return;
    setBusyAction({ systemId: system.id, action: 'default' });
    try {
      onSelect(system.id);
      notifyAction('success', t('ds.actionDone'));
    } finally {
      setBusyAction(null);
    }
  }

  function handleSelectSystem(system: DesignSystemSummary) {
    setPreviewId(system.id);
  }

  // Two scopes, matching the reference. There is no Enterprise tab: it was a
  // "Coming soon" placeholder with nothing behind it, and the approved screen
  // does not have one.
  const scopeTabs: {
    value: DesignSystemCollection;
    label: string;
    count: number;
  }[] = [
    { value: 'mine', label: t('dsManager.yourSystems'), count: userSearched.length },
    { value: 'official', label: t('dsManager.officialPresets'), count: queryScoped.length },
  ];

  const showPresetFilters = designSystemCollection === 'official';

  return (
    <main className={styles.screen} data-testid="design-systems-tab">
      <header className={styles.pageHead}>
        <div>
          <p className={styles.kicker}>
            <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
            {t('ds.pageKicker')}
          </p>
          <h1>{t('entry.navDesignSystems')}</h1>
          <p className={styles.pageHeadSub}>{t('ds.pageSubtitle')}</p>
        </div>
        {/* Always present, as on the reference. No ui_click here either:
            `design_systems_top_click` has no `create_button` element, and the
            create funnel is covered end-to-end by the dialog's own
            `design_system_create_click` rows plus `design_system_create_result`. */}
        <button
          type="button"
          className={styles.primaryAction}
          data-testid="design-systems-create"
          onClick={() => setCreateOpen(true)}
        >
          <i className="fa-solid fa-plus" aria-hidden="true" />
          {t('dsManager.createTitle')}
        </button>
      </header>

      <ContextHandoffBand
        context={inherited}
        className={styles.handoffCompact}
        onOpenContext={() => setContextOpen(true)}
      />

      <div className={styles.scopeRow}>
        <div className={styles.scopeTabs} role="tablist" aria-label={t('dsManager.sourceAria')}>
          {scopeTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={designSystemCollection === tab.value}
              className={`${styles.scopeTab} ${
                designSystemCollection === tab.value ? styles.scopeTabActive : ''
              }`}
              onClick={() => {
                // Reference `:343-344` — switching scope also clears the search.
                setDesignSystemCollection(tab.value);
                setFilter('');
              }}
            >
              <span>{tab.label}</span>
              <span className={styles.scopeCount} aria-hidden>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        <label className={styles.search}>
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            className={styles.searchInput}
            data-testid="design-systems-search"
            value={filter}
            placeholder={t('ds.searchPlaceholder')}
            aria-label={t('ds.searchPlaceholder')}
            onFocus={() => {
              if (searchTracked.current) return;
              searchTracked.current = true;
              trackDesignSystemsTopClick(analytics.track, {
                page_name: 'design_systems',
                area: 'design_systems',
                element: 'search_input',
              });
            }}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      </div>

      <div className={styles.shell}>
        {/* Spans both columns, above the list and the preview, so the whole
            card reads as loading. Same bar, same 1.9s sweep as the Projects
            panel — a static skeleton alone reads as "stuck". */}
        {loading ? <div className={styles.progressTrack} aria-hidden="true" /> : null}
        <aside
          className={styles.list}
          data-testid="design-systems-list"
          aria-label={
            designSystemCollection === 'mine'
              ? t('dsManager.yourSystemsAria')
              : t('dsManager.officialPresets')
          }
        >
          {/* The style-category select filters THIS list, so it leads the
              column it filters rather than sitting in a full-width bar above
              the card. Presets only — user systems are not categorised. */}
          {/* Sticky, so the filter stays reachable while 151 presets scroll
              under it. The wrapper bleeds over the list's 8px padding and
              carries the list's own background, otherwise rows would show
              through the gap above the control as they pass beneath.

              `CustomSelect`, not a native `<select>`: a native popup is an OS
              widget whose scrollbar CSS cannot reach, and this list's thin
              scrollbar has to look the same when the category menu is open. */}
          {showPresetFilters && !loading ? (
            <div className={styles.listFilter} data-testid="design-systems-category-filter">
              <CustomSelect
                value={category}
                options={categories.map((c) => ({ value: c, label: renderCategory(c) }))}
                onChange={setCategory}
                ariaLabel={t('dsManager.filterAria')}
                triggerClassName={styles.categorySelectTrigger}
                menuClassName={styles.categorySelectMenu}
                onFocus={() => {
                  if (categoryTracked.current) return;
                  categoryTracked.current = true;
                  trackDesignSystemsTopClick(analytics.track, {
                    page_name: 'design_systems',
                    area: 'design_systems',
                    element: 'search_dropdown',
                  });
                }}
              />
            </div>
          ) : null}

          {loading ? (
            <div
              className={styles.listStatus}
              role="status"
              aria-busy="true"
              data-testid="design-systems-sidebar-skeleton"
            >
              <VisuallyHidden>{t('designSystemPicker.loading')}</VisuallyHidden>
              {SKELETON_ROWS.map((key, index) => (
                <div
                  key={key}
                  className={styles.skeletonRow}
                  data-testid={`design-systems-loading-row-${index}`}
                  aria-hidden="true"
                >
                  <span className={`${styles.skeletonBlock} ${styles.skeletonMark}`} />
                  <span className={styles.skeletonLines}>
                    <span className={`${styles.skeletonBlock} ${styles.skeletonLineTitle}`} />
                    <span className={`${styles.skeletonBlock} ${styles.skeletonLineSub}`} />
                  </span>
                </div>
              ))}
            </div>
          ) : visibleSystems.length === 0 ? (
            <div className={styles.empty} data-testid="design-systems-empty">
              <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
              <strong>{t('ds.emptyListTitle')}</strong>
              <span>
                {designSystemCollection === 'official'
                  ? t('ds.emptyNoMatch')
                  : t('dsManager.emptyMine')}
              </span>
            </div>
          ) : (
            visibleSystems.map((system) => (
              <SystemRow
                key={system.id}
                system={system}
                active={system.id === selected?.id}
                isDefault={system.id === selectedId}
                subtitle={
                  // User systems: prefer the scenario (summary), then the source
                  // link (host, truncated by CSS), then the generic placeholder.
                  // Presets keep their localized category, which already reads
                  // as their scenario.
                  isUserSystem(system)
                    ? system.summary?.trim() ||
                      designSystemLogoHost(system) ||
                      t('brandDetail.designSystem')
                    : localizeDesignSystemCategory(locale, system.category || 'Uncategorized')
                }
                defaultLabel={t('dsManager.badgeDefault')}
                statusLabel={
                  (system.status ?? 'draft') === 'published'
                    ? t('dsManager.statusPublished')
                    : t('dsManager.statusDraft')
                }
                onSelect={() => handleSelectSystem(system)}
              />
            ))
          )}
        </aside>

        <section className={styles.preview} data-testid="design-systems-preview" aria-live="polite">
          {loading ? (
            <DetailSkeleton label={t('designSystemPicker.loadingPreview')} />
          ) : selected ? (
            <DesignSystemDetailPane
              key={selected.id}
              system={selected}
              isDefault={selected.id === selectedId}
              canBeDefault={!isUserSystem(selected) || (selected.status ?? 'draft') === 'published'}
              busy={busyId === selected.id}
              actionBusy={busyAction?.systemId === selected.id ? busyAction.action : null}
              inheritedTitle={inherited.hasHub ? inherited.title : null}
              inheritedSummary={inherited.summary}
              onOpenContext={() => setContextOpen(true)}
              onEdit={onOpenSystem}
              onMakeDefault={makeDefault}
              onTogglePublished={togglePublished}
              onDelete={deleteSystem}
              onActionFeedback={notifyAction}
            />
          ) : (
            <div className={`${styles.empty} ${styles.emptyPreview}`}>
              <i className="fa-solid fa-layer-group" aria-hidden="true" />
              <strong>{t('ds.emptyPreviewTitle')}</strong>
              <span>{t('ds.emptyPreviewBody')}</span>
            </div>
          )}
        </section>
      </div>

      {createOpen ? (
        <CreateDesignSystemDialog
          onClose={() => setCreateOpen(false)}
          onNotice={(message) => notifyAction('success', message)}
        />
      ) : null}

      <ProductHubContextDrawer
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        context={inherited}
        hubContext={hubContext}
      />

      {actionToast ? (
        <Toast
          key={`${actionToast.tone}-${actionToast.message}`}
          message={actionToast.message}
          tone={actionToast.tone}
          role={actionToast.tone === 'error' ? 'alert' : 'status'}
          ttlMs={actionToast.tone === 'loading' ? 60_000 : undefined}
          onDismiss={() => setActionToast(null)}
        />
      ) : null}
    </main>
  );
}

/* ── List row — reference `:351-357` ─────────────────────────────────────── */

interface SystemRowProps {
  system: DesignSystemSummary;
  active: boolean;
  isDefault: boolean;
  subtitle: string;
  defaultLabel: string;
  statusLabel: string;
  onSelect: () => void;
}

function SystemRow({
  system,
  active,
  isDefault,
  subtitle,
  defaultLabel,
  statusLabel,
  onSelect,
}: SystemRowProps) {
  const status = system.status ?? 'draft';
  const isUser = isUserSystem(system);
  return (
    <button
      type="button"
      data-testid={`design-system-card-${system.id}`}
      className={`${styles.row} ${active ? styles.rowActive : ''}`}
      aria-pressed={active}
      onClick={onSelect}
    >
      <span className={styles.rowMark}>
        <SystemPalette colors={swatchesOf(system).slice(0, 4)} compact />
      </span>
      <span className={styles.rowCopy}>
        <strong className={styles.rowTitle}>
          <span className={styles.rowTitleText}>{system.title}</span>
          {isDefault ? <em className={styles.rowBadge}>{defaultLabel}</em> : null}
        </strong>
        <small className={styles.rowSub}>{subtitle}</small>
      </span>
      {isUser ? (
        <span
          className={`${styles.statusDot} ${
            status === 'published' ? styles.statusDotPublished : styles.statusDotDraft
          }`}
          title={statusLabel}
          aria-label={statusLabel}
        >
          <i className="fa-solid fa-circle" aria-hidden="true" />
        </span>
      ) : null}
    </button>
  );
}

/* ── Detail pane — reference `:360-420` ──────────────────────────────────── */

interface DetailProps {
  system: DesignSystemSummary;
  isDefault: boolean;
  canBeDefault: boolean;
  busy: boolean;
  actionBusy: DesignSystemActionKind | null;
  inheritedTitle: string | null;
  inheritedSummary: string;
  onOpenContext: () => void;
  onEdit?: (id: string) => void;
  onMakeDefault: (system: DesignSystemSummary) => void;
  onTogglePublished: (system: DesignSystemSummary) => void | Promise<void>;
  onDelete: (system: DesignSystemSummary) => void | Promise<void>;
  onActionFeedback: (tone: ActionTone, message: string) => void;
}

function DesignSystemDetailPane({
  system,
  isDefault,
  canBeDefault,
  busy,
  actionBusy,
  inheritedTitle,
  inheritedSummary,
  onOpenContext,
  onEdit,
  onMakeDefault,
  onTogglePublished,
  onDelete,
  onActionFeedback,
}: DetailProps) {
  const { t } = useI18n();
  const analytics = useAnalytics();
  const isUser = isUserSystem(system);
  const status = system.status ?? 'draft';
  const published = status === 'published';

  const [detail, setDetail] = useState<DesignSystemDetail | null>(null);
  const [detailResolved, setDetailResolved] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // The summary lacks the DESIGN.md body + packageInfo the kit needs, so fetch
  // the full detail. The kit derives every module from brand.json (when a
  // backing project carries one) or the parsed DESIGN.md (presets).
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setDetailResolved(false);
    void fetchDesignSystem(system.id)
      .then((d) => {
        if (cancelled) return;
        if (d) setDetail(d);
        setDetailResolved(true);
      })
      .catch(() => {
        if (!cancelled) setDetailResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [system.id]);

  const host = designSystemLogoHost(system) || undefined;
  const projectId = detail?.projectId ?? system.projectId;

  const { kit } = useDesignKit({
    designSystemId: system.id,
    title: system.title,
    projectId,
    body: detail?.body,
    packageInfo: detail?.packageInfo,
    swatches: system.swatches,
    showcaseHtml: null,
    // This surface is read-only (the reference's is too); editing lives on the
    // in-project Design System tab. `editable` still tracks user systems so the
    // kit renders live from the project rather than a stale published snapshot.
    editable: isUser,
    host,
  });

  // Direct in-panel DS actions (E3 / §3.6). All carry
  // edit_surface=direct_module + artifact_kind=design_system + the DS id so
  // "edit depth" drills down.
  function emitEditClick(
    element: DesignSystemEditClickProps['element'],
    module: DesignSystemEditClickProps['module'],
  ) {
    trackDesignSystemEditClick(analytics.track, {
      page_name: 'design_systems',
      area: 'design_system_edit',
      element,
      module,
      edit_surface: 'direct_module',
      artifact_kind: 'design_system',
      design_system_id: system.id,
      project_id: projectId ?? undefined,
    });
  }

  async function handleDownload() {
    if (downloading) return;
    emitEditClick('download', 'general');
    setDownloading(true);
    onActionFeedback('loading', t('dsManager.downloadTitle'));
    try {
      const ok =
        (await downloadDesignSystemArchive({
          designSystemId: system.id,
          fallbackTitle: system.title,
        })) ||
        (projectId
          ? await downloadProjectArchive({ projectId, fallbackTitle: system.title })
          : false);
      onActionFeedback(ok ? 'success' : 'error', ok ? t('ds.actionDone') : t('dsManager.downloadFailed'));
    } catch {
      onActionFeedback('error', t('dsManager.downloadFailed'));
    } finally {
      setDownloading(false);
    }
  }

  const sourceLine = useMemo(() => {
    if (!isUser) {
      return `${t('ds.officialPresetSource')} · ${system.category || 'Uncategorized'}`;
    }
    return system.provenance?.sourceUrls?.[0] || host || t('brandDetail.designSystem');
  }, [isUser, system.provenance, system.category, host, t]);

  const updatedLine = useMemo(() => {
    const ts = system.updatedAt ? Date.parse(system.updatedAt) : Number.NaN;
    if (!Number.isFinite(ts)) return null;
    return relativeTime(ts, t);
  }, [system.updatedAt, t]);

  const swatches = kit?.colors?.length
    ? kit.colors.map((c) => c.hex).filter(Boolean)
    : swatchesOf(system);

  return (
    <>
      <header className={styles.detailHead}>
        <div className={styles.detailIdentity}>
          <span className={styles.detailMark} aria-hidden>
            {markOf(system.title)}
          </span>
          <div className={styles.detailCopy}>
            <div className={styles.titleLine}>
              <h2>{system.title}</h2>
              {isDefault ? (
                <span className={styles.titleBadge}>{t('dsManager.badgeDefault')}</span>
              ) : null}
            </div>
            <p title={system.summary}>{system.summary}</p>
            <small title={sourceLine}>
              {updatedLine
                ? t('ds.detailSourceUpdated', { source: sourceLine, time: updatedLine })
                : sourceLine}
            </small>
          </div>
        </div>

        <div className={styles.detailActions}>
          {isUser && onEdit ? (
            <button
              type="button"
              className={styles.primaryButton}
              disabled={busy}
              aria-busy={actionBusy === 'edit' || undefined}
              title={t('dsManager.openSystemAria', { title: system.title })}
              onClick={() => {
                emitEditClick('edit_with_agent', 'general');
                onEdit(system.id);
              }}
            >
              <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
              {t('dsManager.editWithAgent')}
            </button>
          ) : null}

          {isUser ? (
            <button
              type="button"
              className={`${styles.publishToggle} ${published ? styles.publishToggleOn : ''}`}
              aria-pressed={published}
              aria-busy={actionBusy === 'publish' || undefined}
              disabled={busy}
              onClick={() => void onTogglePublished(system)}
            >
              <span>{published ? t('dsManager.statusPublished') : t('dsManager.statusDraft')}</span>
              <span className={styles.publishTrack} aria-hidden />
            </button>
          ) : null}

          <OverflowMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            label={t('designs.menuMore')}
            items={[
              ...(isUser
                ? [
                    {
                      id: 'download',
                      icon: 'download',
                      label: t('dsManager.downloadTitle'),
                      disabled: busy || downloading,
                      onClick: () => void handleDownload(),
                    },
                  ]
                : []),
              ...(canBeDefault && !isDefault
                ? [
                    {
                      id: 'make-default',
                      icon: 'star',
                      label: t('dsManager.makeDefault'),
                      disabled: busy,
                      onClick: () => onMakeDefault(system),
                    },
                  ]
                : []),
              ...(isUser
                ? [
                    {
                      id: 'delete',
                      icon: 'trash',
                      label: t('dsManager.deleteSystemAria', { title: system.title }),
                      danger: true,
                      disabled: busy,
                      onClick: () => void onDelete(system),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </header>

      <div className={styles.detailScroll} data-testid={`design-system-detail-${system.id}`}>
        {isUser && inheritedTitle ? (
          <section className={styles.provenance}>
            <div>
              <small>{t('ds.provenanceInherited')}</small>
              <strong title={inheritedTitle}>{inheritedTitle}</strong>
              <p>{inheritedSummary}</p>
            </div>
            <i className={`fa-solid fa-arrow-right ${styles.provenanceArrow}`} aria-hidden="true" />
            <div>
              <small>{t('ds.provenanceOwned')}</small>
              <strong title={system.title}>{system.title}</strong>
              <p>{t('ds.provenanceOwnedBody')}</p>
            </div>
            <button type="button" onClick={onOpenContext}>
              {t('ds.inspectSourceContext')}
            </button>
          </section>
        ) : null}

        {kit ? (
          <>
            <DetailModule icon="layer-group" title={t('brandDetail.identity')} wide>
              <p className={styles.description}>
                {kit.description || system.summary || t('ds.emptyPreviewBody')}
              </p>
              <div className={styles.packageStrip}>
                {packageChips(detail, t).map((chip) => (
                  <span key={chip.id} className={styles.chip}>
                    {chip.id === 'design-md' ? (
                      <i className="fa-solid fa-file-code" aria-hidden="true" />
                    ) : null}
                    {chip.label}
                  </span>
                ))}
              </div>
            </DetailModule>

            <DetailModule
              icon="palette"
              title={t('brandDetail.palette')}
              action={
                <button
                  type="button"
                  className={styles.moduleAction}
                  aria-label={t('ds.copyPalette')}
                  title={t('ds.copyPalette')}
                  /* No ui_click: copying a palette is not an edit, and
                     `design_system_edit_click` has no element for it. */
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(swatches.join(', '))
                      .then(() => onActionFeedback('success', t('ds.paletteCopied')))
                      .catch(() => onActionFeedback('error', t('ds.actionFailed')));
                  }}
                >
                  <i className="fa-solid fa-copy" aria-hidden="true" />
                </button>
              }
            >
              <div className={styles.largePalette}>
                {swatches.map((color, index) => (
                  <span key={`${color}-${index}`} className={styles.swatch} style={{ background: color }}>
                    <em className={styles.swatchLabel}>{color}</em>
                  </span>
                ))}
              </div>
            </DetailModule>

            <DetailModule icon="font" title={t('brandDetail.typography')}>
              <TypeSpecimen kit={kit} role="display" meta={t('ds.typeDisplayMeta')} />
              <TypeSpecimen kit={kit} role="body" meta={t('ds.typeBodyMeta')} />
            </DetailModule>

            <DetailModule icon="quote-left" title={t('brandDetail.voiceTone')}>
              <blockquote className={styles.quote}>
                {kit.voice?.tone || t('ds.voiceEmpty')}
              </blockquote>
              {kit.voice?.adjectives?.length ? (
                <div className={styles.toneChips}>
                  {kit.voice.adjectives.slice(0, 3).map((adjective) => (
                    <span key={adjective} className={styles.chip}>
                      {adjective}
                    </span>
                  ))}
                </div>
              ) : null}
            </DetailModule>

            <DetailModule icon="image" title={t('brandDetail.imageryLayout')}>
              <p>{kit.imagery?.style || t('ds.imageryEmpty')}</p>
              <div className={styles.imageryRule} aria-hidden>
                <span />
                <span />
                <span />
              </div>
            </DetailModule>
          </>
        ) : (
          <ModuleSkeletons
            label={detailResolved ? t('common.loading') : t('designSystemPicker.loadingPreview')}
          />
        )}
      </div>
    </>
  );
}

/** `DetailModule` — reference `:254-261`. */
function DetailModule({
  icon,
  title,
  action,
  wide = false,
  children,
}: {
  icon: string;
  title: string;
  action?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`${styles.module} ${wide ? styles.moduleWide : ''}`}>
      <header className={styles.moduleHead}>
        <div className={styles.moduleHeadTitle}>
          <i className={`fa-solid fa-${icon}`} aria-hidden="true" />
          <h3>{title}</h3>
        </div>
        {action ?? null}
      </header>
      <div className={styles.moduleBody}>{children}</div>
    </section>
  );
}

/**
 * The reference draws the display glyph in Playfair regardless of the family it
 * labels — a fixture shortcut. Here the glyph is set in the system's OWN display
 * stack (the thing the module is documenting), with the reference's Playfair as
 * the real, vendored fallback when a system declares no display face.
 */
function TypeSpecimen({
  kit,
  role,
  meta,
}: {
  kit: DesignKit;
  role: 'display' | 'body';
  meta: string;
}) {
  const font = role === 'display' ? kit.typography.display : kit.typography.body;
  const family = font ? fontStack(font) : undefined;
  return (
    <div className={`${styles.specimen} ${role === 'body' ? styles.specimenBody : ''}`}>
      <strong
        className={styles.specimenGlyph}
        style={
          role === 'display'
            ? { fontFamily: family ?? '"Playfair Display", serif' }
            : family
              ? { fontFamily: family }
              : undefined
        }
        aria-hidden
      >
        Aa
      </strong>
      <div className={styles.specimenCopy}>
        <b title={font?.family}>{font?.family ?? '—'}</b>
        <span>{meta}</span>
      </div>
    </div>
  );
}

/**
 * The reference's package strip is four fixed labels. Here the first three are
 * confirmed against the package the daemon actually served, so the strip never
 * claims a file the system does not ship; `DESIGN.md` is always present because
 * it is the one required file in the package contract.
 */
function packageChips(
  detail: DesignSystemDetail | null,
  t: ReturnType<typeof useI18n>['t'],
): { id: string; label: string }[] {
  const files = detail?.packageInfo?.availableFiles ?? [];
  const has = (name: string) => files.some((file) => file.endsWith(name));
  const chips = [{ id: 'design-md', label: t('ds.packageDesignMd') }];
  if (files.length === 0 || has('tokens.css')) {
    chips.push({ id: 'tokens', label: t('ds.packageTokens') });
  }
  if (files.length === 0 || has('components.html')) {
    chips.push({ id: 'ui-kit', label: t('ds.packageUiKit') });
  }
  if (files.length === 0 || files.some((file) => file.startsWith('preview/'))) {
    chips.push({ id: 'previews', label: t('ds.packagePreviews') });
  }
  return chips;
}

/* ── Overflow menu — reference `:371-381` ────────────────────────────────── */

interface OverflowItem {
  id: string;
  icon: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/**
 * The reference only toggles this open and leaves it there. Outside-click,
 * scroll and Escape dismissal are added because a popover that survives a scroll
 * detaches from its trigger — a standing rule in this product, not a deviation
 * from the visual spec.
 */
function OverflowMenu({
  open,
  onOpenChange,
  label,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  items: OverflowItem[];
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: MouseEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      onOpenChange(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onOpenChange(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
    // `capture` so a scroll inside the list or the entry scroller closes it too;
    // those containers scroll without the window ever emitting an event.
    const closeOnScroll = () => onOpenChange(false);
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [open, onOpenChange]);

  if (items.length === 0) return null;

  return (
    <div className={styles.menuWrap} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.iconButton}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => onOpenChange(!open)}
      >
        <i className="fa-solid fa-ellipsis" aria-hidden="true" />
      </button>
      {open ? (
        <div className={styles.popover} role="menu">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`${styles.popoverItem} ${item.danger ? styles.popoverDanger : ''}`}
              onClick={() => {
                onOpenChange(false);
                item.onClick();
              }}
            >
              <i className={`fa-solid fa-${item.icon}`} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── Skeletons ───────────────────────────────────────────────────────────── */

function DetailSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" data-testid="design-systems-preview-skeleton">
      <VisuallyHidden>{label}</VisuallyHidden>
      <header className={styles.detailHead}>
        <div className={styles.detailIdentity}>
          <span className={`${styles.skeletonBlock} ${styles.detailMark}`} aria-hidden />
          <div className={styles.detailCopy}>
            <span
              className={`${styles.skeletonBlock} ${styles.skeletonLineTitle}`}
              style={{ display: 'block', width: 180, height: 20 }}
              aria-hidden
            />
            <span
              className={`${styles.skeletonBlock} ${styles.skeletonLineSub}`}
              style={{ display: 'block', width: 240, marginTop: 8 }}
              aria-hidden
            />
          </div>
        </div>
      </header>
      <div className={styles.detailScroll}>
        <ModuleSkeletons label={label} bare />
      </div>
    </div>
  );
}

function ModuleSkeletons({ label, bare = false }: { label: string; bare?: boolean }) {
  const body = (
    <>
      <section className={`${styles.module} ${styles.moduleWide}`}>
        <header className={styles.moduleHead}>
          <span
            className={`${styles.skeletonBlock} ${styles.skeletonParagraphShort}`}
            style={{ width: 96, height: 12 }}
            aria-hidden
          />
        </header>
        <div className={styles.moduleBody}>
          <div className={styles.skeletonModuleBody}>
            <span className={`${styles.skeletonBlock} ${styles.skeletonParagraph}`} aria-hidden />
            <span className={`${styles.skeletonBlock} ${styles.skeletonParagraphShort}`} aria-hidden />
          </div>
        </div>
      </section>
      <section className={styles.module}>
        <header className={styles.moduleHead}>
          <span
            className={`${styles.skeletonBlock} ${styles.skeletonParagraphShort}`}
            style={{ width: 72, height: 12 }}
            aria-hidden
          />
        </header>
        <div className={styles.moduleBody}>
          <div className={styles.skeletonSwatchRow}>
            {[0, 1, 2, 3, 4].map((index) => (
              <span key={index} className={`${styles.skeletonBlock} ${styles.skeletonSwatch}`} aria-hidden />
            ))}
          </div>
        </div>
      </section>
      <section className={styles.module}>
        <header className={styles.moduleHead}>
          <span
            className={`${styles.skeletonBlock} ${styles.skeletonParagraphShort}`}
            style={{ width: 84, height: 12 }}
            aria-hidden
          />
        </header>
        <div className={styles.moduleBody}>
          <div className={styles.skeletonModuleBody}>
            <span className={`${styles.skeletonBlock} ${styles.skeletonParagraph}`} aria-hidden />
            <span className={`${styles.skeletonBlock} ${styles.skeletonParagraphShort}`} aria-hidden />
          </div>
        </div>
      </section>
    </>
  );
  if (bare) return body;
  return (
    <>
      <VisuallyHidden role="status">{label}</VisuallyHidden>
      {body}
    </>
  );
}
