/**
 * PluginsScreen — `/plugins`, rebuilt as the approved MMSBUILD reference screen
 * (`prototype-reference/src/PluginsScreen.jsx`).
 *
 * The reference lays out six blocks and nothing else: a bare page head (title +
 * Add), the Product Hub handoff strip, an Expert suites / Skills tab row, a
 * filter block (scope tabs + search, with a category chip row under it), a
 * two-column card grid, and a setup-note footer. This replaces the upstream
 * `PluginsView`, which shared none of it.
 *
 * ── What is deliberately absent ──────────────────────────────────────────
 * The stat cards, the Installed/Available/Sources/Team tab row, the preview-tile
 * gallery, the Trending/Newest sort toggle, the Saved collection, and the
 * marketplace-source management panel. None exist on the reference screen.
 * Marketplace catalogues are still READ (they are what produces the installable
 * rows, and the build kit's §3 requires upstream-native catalogs) — only the
 * register/refresh/remove UI is gone; `od marketplace …` still owns it.
 *
 * ── Why real catalogues and not the fixture ──────────────────────────────
 * The reference renders four hardcoded "expert suites" and answers every action
 * with a local prototype notice. The build kit requires upstream-native catalogs
 * (§3) and names both the hardcoded fixture and the prototype notices among the
 * behaviours a developer "must not preserve" (§5). So the shape is the
 * reference's and the rows, actions and provenance are the app's.
 *
 * ── Scope mapping ────────────────────────────────────────────────────────
 * Expert suites · MMS Design official = bundled plugins + catalogue entries that
 * are not installed yet. Expert suites · Personal = everything the user brought
 * in (user/project/marketplace/github/url/local). Skills · official = built-in
 * skills, Skills · Personal = user-owned skills. Skill authoring/editing is not
 * duplicated here; it stays in Integrations → Skills.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VisuallyHidden } from '@open-design/components';
import { resolveLocalizedText, type InstalledPluginRecord } from '@open-design/contracts';
import { useAnalytics } from '../analytics/provider';
import {
  trackPageView,
  trackPluginsAvailableTabClick,
  trackPluginsInstalledTabClick,
  trackPluginsTopClick,
} from '../analytics/events';
import { useI18n } from '../i18n';
import {
  installPluginSource,
  listPluginMarketplaces,
  listPlugins,
  uploadPluginFolder,
  uploadPluginZip,
  type PluginInstallOutcome,
  type PluginMarketplace,
} from '../state/projects';
import { useHubContext } from '../state/hubContext';
import type { SkillSummary } from '../types';
import { buildCategoryCatalog, extractCategories } from './plugins-home/facets';
import {
  localizePluginDescription,
  localizePluginTitle,
} from './plugins-home/localization';
import { useInView } from './plugins-home/useInView';
import { PluginDetailsModal } from './PluginDetailsModal';
import { Toast } from './Toast';
import { ProductHubContextDrawer } from './start-desk/ProductHubContextDrawer';
import { deriveInheritedContext } from './start-desk/inherited-context';
import { AddResourceDialog, type AddResourceKind } from './plugins-screen/AddResourceDialog';
import { PluginProvenanceModal } from './plugins-screen/PluginProvenanceModal';
import { ResourceHandoffStrip } from './plugins-screen/ResourceHandoffStrip';
import {
  availableToItem,
  buildAvailablePlugins,
  buildCategoryOptions,
  filterItems,
  pluginToItem,
  skillToItem,
  type AvailableMarketplacePlugin,
  type CatalogBadge,
  type CatalogItem,
} from './plugins-screen/catalogItem';
import type { PluginUseAction } from './plugins-home/useActions';
import styles from './PluginsScreen.module.css';

type Mode = 'plugins' | 'skills';
type Scope = 'official' | 'personal';

/** `sourceKind`s that mean "the user brought this in", i.e. the Personal scope. */
const USER_SOURCE_KINDS = new Set<InstalledPluginRecord['sourceKind']>([
  'user',
  'project',
  'marketplace',
  'github',
  'url',
  'local',
]);

/**
 * Rows rendered before the invisible sentinel grows the page. The reference has
 * four cards; a real official catalogue has hundreds, and painting them all on
 * first commit is the only thing about this grid that does not scale. Paging is
 * invisible — no control is added and the grid is unchanged.
 */
const PAGE_SIZE = 24;

/** Enough placeholder cards to fill the two-column grid on a laptop. */
const SKELETON_CARDS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

export interface PluginsScreenProps {
  /** Union of functional skills + design templates, from `/api/skills`. */
  skills: SkillSummary[];
  skillsLoading?: boolean;
  /** False while the view is parked off-screen, so the page view fires once. */
  isActive?: boolean;
  /** Hand the Home composer the plugin-authoring prompt. */
  onCreatePlugin?: (goal?: string) => void;
  /** Hand the Home composer the skill-authoring prompt. */
  onCreateSkill?: () => void;
  /** Attach a plugin to the Home composer (optionally with its example query). */
  onUsePlugin?: (record: InstalledPluginRecord, action: PluginUseAction) => void;
  /** Preselect a skill on the Home composer. */
  onUseSkill?: (skill: SkillSummary) => void;
}

export function PluginsScreen({
  skills,
  skillsLoading = false,
  isActive = true,
  onCreatePlugin,
  onCreateSkill,
  onUsePlugin,
  onUseSkill,
}: PluginsScreenProps) {
  const { locale, t } = useI18n();
  const analytics = useAnalytics();
  const hubContext = useHubContext();

  const [mode, setMode] = useState<Mode>('plugins');
  const [scope, setScope] = useState<Scope>('official');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [menuId, setMenuId] = useState('');
  const [importWorking, setImportWorking] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [contextOpen, setContextOpen] = useState(false);
  const [detailsRecord, setDetailsRecord] = useState<InstalledPluginRecord | null>(null);
  const [provenance, setProvenance] = useState<CatalogItem | null>(null);
  // Install / import feedback. The reference raises the same outcomes through
  // its global toast (`App.jsx:210`); this app already has that component, so
  // the page adds no block of its own for it.
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const [plugins, setPlugins] = useState<InstalledPluginRecord[]>([]);
  const [allPlugins, setAllPlugins] = useState<InstalledPluginRecord[]>([]);
  const [marketplaces, setMarketplaces] = useState<PluginMarketplace[]>([]);
  const [loading, setLoading] = useState(true);

  const addButtonRef = useRef<HTMLButtonElement>(null);

  // P0 `page_view page_name=plugins`, once per mount. ref-keyed so parent state
  // changes that re-render without remounting do not re-fire it.
  const pageViewFired = useRef(false);
  useEffect(() => {
    if (pageViewFired.current || !isActive) return;
    pageViewFired.current = true;
    trackPageView(analytics.track, { page_name: 'plugins' });
  }, [analytics.track, isActive]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [rows, allRows, catalogs] = await Promise.all([
      listPlugins(),
      listPlugins({ includeHidden: true }),
      listPluginMarketplaces(),
    ]);
    setPlugins(rows);
    setAllPlugins(allRows);
    setMarketplaces(catalogs);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener('open-design:plugins-changed', onChanged);
    return () => window.removeEventListener('open-design:plugins-changed', onChanged);
  }, [refresh]);

  /* ── Rows ──────────────────────────────────────────────────────────────── */

  // Atoms are pipeline infrastructure (`code-import`, `patch-edit`), never a
  // card the user picks. The superseded gallery filtered them out; so does this.
  const userFacingPlugins = useMemo(
    () => plugins.filter((plugin) => plugin.manifest?.od?.kind !== 'atom'),
    [plugins],
  );

  // Facet labels for the uppercase category line and the chip row. Built from
  // the whole installed catalogue so a label never disappears mid-filter.
  const categoryLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of buildCategoryCatalog(userFacingPlugins)) {
      map.set(option.slug, option.label);
    }
    return map;
  }, [userFacingPlugins]);

  const availablePlugins = useMemo(
    () => buildAvailablePlugins(marketplaces, allPlugins),
    [marketplaces, allPlugins],
  );

  const pluginItem = useCallback(
    (record: InstalledPluginRecord): CatalogItem => {
      const slug = extractCategories(record)[0] ?? '';
      return pluginToItem(
        record,
        {
          title: localizePluginTitle(locale, record),
          description: localizePluginDescription(locale, record) ?? '',
        },
        { slug, label: slug ? categoryLabels.get(slug) ?? '' : '' },
      );
    },
    [categoryLabels, locale],
  );

  const availableItem = useCallback(
    (plugin: AvailableMarketplacePlugin): CatalogItem =>
      availableToItem(plugin, {
        title:
          resolveLocalizedText(plugin.entry.title_i18n, locale)
          || plugin.entry.title
          || plugin.entry.name,
        description:
          resolveLocalizedText(plugin.entry.description_i18n, locale)
          || plugin.entry.description
          || '',
      }),
    [locale],
  );

  const skillItem = useCallback(
    (skill: SkillSummary): CatalogItem =>
      skillToItem(skill, {
        title: resolveLocalizedText(skill.displayName, locale) || skill.name,
        description: resolveLocalizedText(skill.descriptionI18n, locale) || skill.description,
      }),
    [locale],
  );

  /** Every row for the current mode + scope, before search and category. */
  const scopedItems = useMemo(() => {
    if (mode === 'skills') {
      const wanted = skills.filter((skill) =>
        scope === 'personal' ? skill.source === 'user' : skill.source !== 'user',
      );
      return wanted.map(skillItem);
    }
    if (scope === 'personal') {
      return userFacingPlugins
        .filter((plugin) => USER_SOURCE_KINDS.has(plugin.sourceKind))
        .map(pluginItem);
    }
    // Official: what ships with the runtime, plus catalogue entries that are
    // registered but not installed yet (those carry the Install action).
    const bundled = userFacingPlugins
      .filter((plugin) => plugin.sourceKind === 'bundled')
      .map(pluginItem);
    const installable = availablePlugins
      .filter((plugin) => !plugin.installedRecord)
      .map(availableItem);
    return [...bundled, ...installable];
  }, [
    availableItem,
    availablePlugins,
    mode,
    pluginItem,
    scope,
    skillItem,
    skills,
    userFacingPlugins,
  ]);

  const categories = useMemo(() => buildCategoryOptions(scopedItems), [scopedItems]);

  const cards = useMemo(() => {
    const byCategory = category
      ? scopedItems.filter((item) => item.categorySlug === category)
      : scopedItems;
    return filterItems(byCategory, query);
  }, [category, query, scopedItems]);

  const filtered = Boolean(query.trim() || category !== null);
  const busyLoading = mode === 'skills' ? skillsLoading : loading;

  /* ── Paging sentinel (invisible) ───────────────────────────────────────── */

  const { ref: sentinelRef, inView } = useInView<HTMLDivElement>({
    once: false,
    rootMargin: '600px',
  });

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [mode, scope, category, query]);

  useEffect(() => {
    if (!inView) return;
    setVisibleCount((current) => (current >= cards.length ? current : current + PAGE_SIZE));
  }, [cards.length, inView]);

  const visibleCards = useMemo(
    () => cards.slice(0, visibleCount),
    [cards, visibleCount],
  );

  /* ── Menus ─────────────────────────────────────────────────────────────── */

  // A kebab must close when the user looks away from it — outside click, scroll
  // or Escape. The reference only toggles, which strands an open menu over the
  // grid; that is a defect, not a design decision.
  useEffect(() => {
    if (!menuId) return undefined;
    const close = () => setMenuId('');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
    };
  }, [menuId]);

  /* ── Actions ───────────────────────────────────────────────────────────── */

  function changeMode(next: Mode) {
    setMode(next);
    setQuery('');
    setCategory(null);
    setMenuId('');
    trackPluginsTopClick(analytics.track, {
      page_name: 'plugins',
      area: 'plugins',
      element: next === 'plugins' ? 'installed_tab' : 'available_tab',
    });
  }

  function tryItem(item: CatalogItem) {
    setMenuId('');
    if (item.skill) {
      onUseSkill?.(item.skill);
      return;
    }
    // A catalogue entry that is not installed cannot be tried, but the card is
    // still a live target: clicking it opens what the entry does have, its
    // record. (Disabling the button instead would dim the whole card body to
    // 48% — the product-wide `button:disabled` style — which the reference
    // never does.)
    if (!item.record) {
      setProvenance(item);
      return;
    }
    trackPluginsInstalledTabClick(analytics.track, {
      page_name: 'plugins',
      area: 'installed_tab',
      element: 'templates_use',
      template_id: item.id,
    });
    const action: PluginUseAction = item.record.manifest?.od?.useCase?.query
      ? 'use-with-query'
      : 'use';
    onUsePlugin?.(item.record, action);
  }

  async function installItem(item: CatalogItem) {
    if (busyId || !item.entry) return;
    setBusyId(item.key);
    setToast(null);
    trackPluginsAvailableTabClick(analytics.track, {
      page_name: 'plugins',
      area: 'available_tab',
      element: 'install',
      plugin_id: item.id,
    });
    const outcome = await installPluginSource(item.entry.installSource ?? item.entry.entry.name);
    setBusyId('');
    applyOutcome(outcome, t('pluginsScreen.installed', { title: item.title }));
    if (outcome.ok) await refresh();
  }

  function applyOutcome(outcome: PluginInstallOutcome, okMessage: string) {
    setToast(
      outcome.ok
        ? { message: okMessage, tone: 'success' }
        : { message: outcome.message || t('pluginsScreen.actionFailed'), tone: 'error' },
    );
  }

  function openDetails(item: CatalogItem) {
    setMenuId('');
    trackPluginsInstalledTabClick(analytics.track, {
      page_name: 'plugins',
      area: 'installed_tab',
      element: 'templates_details',
      template_id: item.id,
    });
    // Installed plugins already have a rich inspector (preview, prompt body,
    // design-system tabs); catalogue entries and skills have no such surface, so
    // they open the provenance sheet, which is the record they DO have.
    if (item.record) {
      setDetailsRecord(item.record);
      return;
    }
    setProvenance(item);
  }

  function openProvenance(item: CatalogItem) {
    setMenuId('');
    setProvenance(item);
  }

  async function importLink(url: string): Promise<boolean> {
    setImportWorking(true);
    setToast(null);
    const outcome = await installPluginSource(url);
    setImportWorking(false);
    applyOutcome(outcome, t('pluginsScreen.importedLink'));
    if (outcome.ok) await refresh();
    return outcome.ok;
  }

  async function importFiles(files: File[]): Promise<boolean> {
    setImportWorking(true);
    setToast(null);
    // One control, both capabilities: the reference offers a single "upload
    // local folder" affordance, and this daemon accepts either a directory or a
    // packed archive. Picking a lone .zip routes to the archive endpoint.
    const zip = files.length === 1 && /\.zip$/i.test(files[0]!.name) ? files[0]! : null;
    const outcome = zip ? await uploadPluginZip(zip) : await uploadPluginFolder(files);
    setImportWorking(false);
    applyOutcome(outcome, t('pluginsScreen.importedUpload'));
    if (outcome.ok) await refresh();
    return outcome.ok;
  }

  function startFromPrompt(kind: AddResourceKind) {
    trackPluginsTopClick(analytics.track, {
      page_name: 'plugins',
      area: 'plugins',
      element: 'create_plugin',
    });
    if (kind === 'skills') {
      onCreateSkill?.();
      return;
    }
    onCreatePlugin?.();
  }

  const inherited = useMemo(() => deriveInheritedContext(hubContext, null), [hubContext]);

  const badgeLabel = (badge: CatalogBadge): string => {
    if (badge === 'official') return t('pluginsScreen.badgeOfficial');
    if (badge === 'trusted') return t('pluginsScreen.badgeTrusted');
    if (badge === 'restricted') return t('pluginsScreen.badgeRestricted');
    return t('pluginsScreen.badgePersonal');
  };

  const searchPlaceholder = mode === 'plugins'
    ? t('pluginsScreen.searchPlugins')
    : t('pluginsScreen.searchSkills');

  /* ── Render ────────────────────────────────────────────────────────────── */

  return (
    <main className={styles.screen} aria-labelledby="plugins-screen-title" data-testid="plugins-screen">
      <header className={styles.pageHead}>
        <h1 id="plugins-screen-title">{t('entry.navPlugins')}</h1>
        <button
          ref={addButtonRef}
          type="button"
          className={styles.primaryButton}
          onClick={() => {
            trackPluginsTopClick(analytics.track, {
              page_name: 'plugins',
              area: 'plugins',
              element: 'import_plugin',
            });
            setAddOpen(true);
          }}
          aria-haspopup="dialog"
          data-testid="plugins-add-button"
        >
          <i className="fa-solid fa-plus" aria-hidden="true" /> {t('pluginsScreen.add')}
        </button>
      </header>

      <ResourceHandoffStrip
        hubContext={hubContext}
        onOpenContext={() => setContextOpen(true)}
        label={t('pluginsScreen.handoffAria')}
        scopedTitle={(client, project) =>
          t('pluginsScreen.handoffTitle', { client, project })}
        unscopedTitle={t('pluginsScreen.handoffTitleUnscoped')}
        summary={t('pluginsScreen.handoffSummary')}
        openLabel={t('pluginsScreen.handoffOpen')}
      />

      <div className={styles.modeSwitch} role="tablist" aria-label={t('pluginsScreen.modeAria')}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'plugins'}
          className={mode === 'plugins' ? styles.active : ''}
          onClick={() => changeMode('plugins')}
          data-testid="plugins-mode-plugins"
        >
          {t('pluginsScreen.modePlugins')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'skills'}
          className={mode === 'skills' ? styles.active : ''}
          onClick={() => changeMode('skills')}
          data-testid="plugins-mode-skills"
        >
          {t('pluginsScreen.modeSkills')}
        </button>
      </div>

      <div className={styles.filterBlock}>
        <div className={styles.filterRow} aria-label={t('pluginsScreen.filtersAria')}>
          <div className={styles.scopeTabs} role="tablist" aria-label={t('pluginsScreen.scopeAria')}>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'official'}
              className={scope === 'official' ? styles.active : ''}
              onClick={() => setScope('official')}
              data-testid="plugins-scope-official"
            >
              {t('pluginsScreen.scopeOfficial')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'personal'}
              className={scope === 'personal' ? styles.active : ''}
              onClick={() => setScope('personal')}
              data-testid="plugins-scope-personal"
            >
              {t('pluginsScreen.scopePersonal')}
            </button>
          </div>
          <label className={styles.search}>
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
            <span className="visually-hidden">{searchPlaceholder}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              data-testid="plugins-search"
            />
          </label>
        </div>

        {categories.length > 1 ? (
          <div className={styles.categoryRow} aria-label={t('pluginsScreen.categoriesAria')}>
            <button
              type="button"
              aria-pressed={category === null}
              className={category === null ? styles.active : ''}
              onClick={() => setCategory(null)}
              data-testid="plugins-category-all"
            >
              {t('pluginsScreen.categoryAll')}
            </button>
            {categories.map((option) => (
              <button
                key={option.slug}
                type="button"
                aria-pressed={category === option.slug}
                className={category === option.slug ? styles.active : ''}
                onClick={() => setCategory(option.slug)}
                data-testid={`plugins-category-${option.slug}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Sits between the filters and the grid so it stays put while the cards
          fill in below it. Same bar as Projects / Design systems / Automations. */}
      {busyLoading && cards.length === 0 ? (
        <div className={styles.progressTrack} aria-hidden="true" />
      ) : null}

      {busyLoading && cards.length === 0 ? (
        <div
          className={styles.grid}
          data-testid="plugins-loading"
          role="status"
          aria-busy="true"
        >
          <VisuallyHidden>{t('pluginsScreen.loading')}</VisuallyHidden>
          {SKELETON_CARDS.map((key) => (
            <div key={key} className={styles.skeletonCard} aria-hidden="true">
              <span className={styles.skeletonMark} />
              <div className={styles.skeletonLines}>
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
          ))}
        </div>
      ) : cards.length > 0 ? (
        <>
          <div className={styles.grid} data-testid="plugins-grid">
            {visibleCards.map((item) => (
              <article className={styles.card} key={item.key} data-plugin-id={item.id}>
                <button
                  type="button"
                  className={styles.cardMain}
                  onClick={() => tryItem(item)}
                >
                  <span className={`${styles.cardMark} ${styles[item.accent]}`} aria-hidden="true">
                    {item.initials}
                  </span>
                  <span className={styles.cardCopy}>
                    <span className={styles.cardTitleLine}>
                      <strong title={item.title}>{item.title}</strong>
                      <small>{badgeLabel(item.badge)}</small>
                    </span>
                    <span>{item.description}</span>
                    {item.category ? <em>{item.category}</em> : null}
                  </span>
                </button>
                <div className={styles.cardActions}>
                  {item.installed ? (
                    <button type="button" onClick={() => tryItem(item)} data-testid={`plugins-try-${item.id}`}>
                      {t('pluginsScreen.tryIt')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.install}
                      disabled={busyId === item.key}
                      onClick={() => void installItem(item)}
                      data-testid={`plugins-install-${item.id}`}
                    >
                      <i
                        className={busyId === item.key ? 'fa-solid fa-rotate' : 'fa-solid fa-download'}
                        aria-hidden="true"
                      />{' '}
                      {busyId === item.key ? t('pluginsScreen.installing') : t('pluginsScreen.install')}
                    </button>
                  )}
                  <span
                    className={styles.moreWrap}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      aria-label={t('pluginsScreen.moreActions', { title: item.title })}
                      aria-expanded={menuId === item.key}
                      onClick={() => setMenuId(menuId === item.key ? '' : item.key)}
                      data-testid={`plugins-more-${item.id}`}
                    >
                      <i className="fa-solid fa-ellipsis" aria-hidden="true" />
                    </button>
                    {menuId === item.key ? (
                      <span className={styles.cardMenu} data-testid={`plugins-menu-${item.id}`}>
                        <button type="button" onClick={() => openDetails(item)}>
                          <i className="fa-solid fa-circle-info" aria-hidden="true" />{' '}
                          {t('pluginsScreen.details')}
                        </button>
                        <button type="button" onClick={() => openProvenance(item)}>
                          <i className="fa-solid fa-check" aria-hidden="true" />{' '}
                          {t('pluginsScreen.provenanceAction')}
                        </button>
                      </span>
                    ) : null}
                  </span>
                </div>
              </article>
            ))}
          </div>
          {visibleCount < cards.length ? (
            <div ref={sentinelRef} aria-hidden="true" data-testid="plugins-load-more" />
          ) : null}
        </>
      ) : (
        <EmptyCatalog
          mode={mode}
          scope={scope}
          filtered={filtered}
          onAdd={() => setAddOpen(true)}
          t={t}
        />
      )}

      <footer className={styles.setupNote}>
        <i className="fa-solid fa-circle-info" aria-hidden="true" /> {t('pluginsScreen.setupNote')}
      </footer>

      {addOpen ? (
        <AddResourceDialog
          initialKind={mode}
          working={importWorking}
          onClose={() => {
            setAddOpen(false);
            addButtonRef.current?.focus();
          }}
          onStartFromPrompt={startFromPrompt}
          onImportLink={importLink}
          onUploadFiles={importFiles}
        />
      ) : null}

      {detailsRecord ? (
        <PluginDetailsModal
          record={detailsRecord}
          onClose={() => setDetailsRecord(null)}
          onUse={(record, action) => {
            setDetailsRecord(null);
            onUsePlugin?.(record, action);
          }}
        />
      ) : null}

      {provenance ? (
        <PluginProvenanceModal
          title={provenance.title}
          description={provenance.description}
          record={provenance.record}
          available={provenance.entry}
          onClose={() => setProvenance(null)}
        />
      ) : null}

      <ProductHubContextDrawer
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        context={inherited}
        hubContext={hubContext}
      />

      {toast ? (
        <Toast
          key={`${toast.tone}-${toast.message}`}
          message={toast.message}
          tone={toast.tone}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          onDismiss={() => setToast(null)}
        />
      ) : null}
    </main>
  );
}

/**
 * The reference's four empty-state branches (`PluginsScreen.jsx:167-186`):
 * filtered-to-nothing, or "nothing here yet" worded per scope, with the Add CTA
 * only on an unfiltered Personal shelf.
 */
function EmptyCatalog({
  mode,
  scope,
  filtered,
  onAdd,
  t,
}: {
  mode: Mode;
  scope: Scope;
  filtered: boolean;
  onAdd: () => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const noun = mode === 'plugins'
    ? t('pluginsScreen.nounExpertSuitesPlural')
    : t('pluginsScreen.nounSkillsPlural');

  const title = filtered
    ? t('pluginsScreen.emptyFilteredTitle')
    : scope === 'personal'
      ? t('pluginsScreen.emptyPersonalTitle', { noun })
      : t('pluginsScreen.emptyOfficialTitle', { noun });

  const body = filtered
    ? t('pluginsScreen.emptyFilteredBody')
    : scope === 'personal'
      ? t('pluginsScreen.emptyPersonalBody')
      : t('pluginsScreen.emptyOfficialBody');

  return (
    <div className={styles.empty} data-testid="plugins-empty">
      <span aria-hidden="true"><i className="fa-solid fa-puzzle-piece" /></span>
      <h3>{title}</h3>
      <p>{body}</p>
      {!filtered && scope === 'personal' ? (
        <button type="button" onClick={onAdd} data-testid="plugins-empty-add">
          <i className="fa-solid fa-plus" aria-hidden="true" /> {t('pluginsScreen.add')}
        </button>
      ) : null}
    </div>
  );
}

export default PluginsScreen;
