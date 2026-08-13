/**
 * ProjectsScreen — `/projects`, rebuilt as the approved MMSBUILD reference
 * screen (`prototype-reference/src/ProjectsScreen.jsx`).
 *
 * The reference lays out three blocks and nothing else: a page head (kicker,
 * title, subtitle), the Product Hub handoff band, and a single panel listing
 * the linked project. This replaces the upstream `DesignsTab` card grid +
 * kanban board, which shared nothing with it.
 *
 * ── What is deliberately absent ──────────────────────────────────────────
 * Search, the Recent/Your-designs sort tabs, the Grid/Board toggle, select
 * mode with bulk delete, and live-artifact cards. None exist on the reference
 * screen. Rename / Duplicate / Delete survive on each row's kebab because the
 * page would otherwise strand them; everything else was signed off as removed.
 *
 * ── Why real projects and not the fixture ────────────────────────────────
 * The reference renders one hardcoded Harbour Suites row. The build kit
 * requires "a real Projects route… List only projects authorized by the
 * supplied role/client/project context" (§3) and names the hardcoded fixture
 * among the behaviours a developer "must not preserve" (§5). So the shape is
 * the reference's and the rows are the app's.
 *
 * `+ New project` is not here either: on the reference it belongs to the
 * specialist row above (`ui.jsx:211` renders it only on Home), and in this app
 * `MmsSpecialistRow` already carries it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { VisuallyHidden } from '@open-design/components';
import { useAnalytics } from '../analytics/provider';
import { trackPageView } from '../analytics/events';
import { useT } from '../i18n';
import { useHubContext } from '../state/hubContext';
import type { DesignSystemSummary, Project } from '../types';
import { ContextHandoffBand } from './start-desk/ContextSurfaces';
import { ProductHubContextDrawer } from './start-desk/ProductHubContextDrawer';
import { deriveInheritedContext } from './start-desk/inherited-context';
import { resolveProjectDesignSystemId } from './design-system-project';
import { LinkedProjectRow } from './LinkedProjectRow';
import styles from './ProjectsScreen.module.css';

/** Enough placeholder rows to fill the panel on a laptop without overflowing it. */
const SKELETON_ROWS = ['a', 'b', 'c', 'd'] as const;

export interface ProjectsScreenProps {
  projects: Project[];
  designSystems: DesignSystemSummary[];
  onOpen: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<boolean | void> | boolean | void;
  /** False while the view is parked off-screen, so the page view fires once. */
  isActive?: boolean;
  /**
   * Rows are still loading. The page head, handoff band and panel frame paint
   * immediately regardless — only the list body waits. A whole-page spinner
   * here meant the route showed nothing at all until every catalogue had
   * landed, which read as a broken page on a cold load.
   */
  loading?: boolean;
}

export function ProjectsScreen({
  projects,
  designSystems,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  isActive = true,
  loading = false,
}: ProjectsScreenProps) {
  const t = useT();
  const analytics = useAnalytics();
  const hubContext = useHubContext();
  const [contextOpen, setContextOpen] = useState(false);

  // P0 `page_view page_name=projects`, once per mount. ref-keyed so parent
  // state changes that re-render without remounting do not re-fire it.
  const pageViewFired = useRef(false);
  useEffect(() => {
    if (pageViewFired.current || !isActive) return;
    pageViewFired.current = true;
    trackPageView(analytics.track, { page_name: 'projects' });
  }, [analytics.track, isActive]);

  // Newest first. The reference has one row and therefore no stated order;
  // most-recently-touched is what the old grid defaulted to.
  const ordered = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt - a.updatedAt),
    [projects],
  );

  // The design system the session is bound to, for the handoff band's
  // project-owned fact. Taken from the Hub-scoped project when there is one,
  // else the most recent project's — the same thing the band showed on Home.
  const boundDesignSystemName = useMemo(() => {
    const scoped = hubContext?.project
      ? ordered.find((project) => project.name === hubContext.project)
      : undefined;
    const source = scoped ?? ordered[0];
    if (!source) return null;
    const id = resolveProjectDesignSystemId(source);
    return designSystems.find((system) => system.id === id)?.title ?? null;
  }, [designSystems, hubContext?.project, ordered]);

  const inherited = useMemo(
    () => deriveInheritedContext(hubContext, boundDesignSystemName),
    [boundDesignSystemName, hubContext],
  );

  const count = ordered.length;

  return (
    <main className={styles.screen} data-testid="projects-screen">
      <header className={styles.pageHead}>
        <div>
          <p className={styles.kicker}>{t('projects.kicker')}</p>
          <h1>{t('entry.navProjects')}</h1>
          <p className={styles.pageHeadSub}>{t('projects.subtitle')}</p>
        </div>
      </header>

      <ContextHandoffBand
        context={inherited}
        className={styles.handoffCompact}
        onOpenContext={() => setContextOpen(true)}
      />

      <section className={styles.list} aria-labelledby="linked-projects-title">
        <header className={styles.listHead}>
          <div>
            <h2 id="linked-projects-title">{t('projects.listTitle')}</h2>
            <p>{t('projects.listSubtitle')}</p>
          </div>
          <span className={styles.listCount}>
            {loading
              ? ''
              : count === 1
                ? t('projects.countOne')
                : t('projects.countOther', { n: count })}
          </span>
        </header>

        {/* Sits between the panel header and the scroller so it stays put
            while the skeleton rows scroll under it. */}
        {loading ? <div className={styles.progressTrack} aria-hidden="true" /> : null}

        <div className={styles.listBody}>
          {loading ? (
            <div data-testid="projects-loading" role="status" aria-busy="true">
              <VisuallyHidden>{t('projects.loadingList')}</VisuallyHidden>
              {SKELETON_ROWS.map((key) => (
                <div key={key} className={styles.skeletonRow} aria-hidden="true">
                  <span className={styles.skeletonMark} />
                  <div className={styles.skeletonLines}>
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className={styles.skeletonAction} />
                </div>
              ))}
            </div>
          ) : count === 0 ? (
            <div className={styles.empty} data-testid="projects-empty">
              <i className="fa-solid fa-folder-open" aria-hidden="true" />
              <strong>{t('designs.emptyNoProjects')}</strong>
              <span>{t('projects.emptyBody')}</span>
            </div>
          ) : (
            ordered.map((project) => (
              <LinkedProjectRow
                key={project.id}
                project={project}
                designSystems={designSystems}
                hubLinked={Boolean(hubContext?.project && hubContext.project === project.name)}
                onOpen={onOpen}
                onRename={onRename}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      </section>

      <ProductHubContextDrawer
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        context={inherited}
        hubContext={hubContext}
      />
    </main>
  );
}
