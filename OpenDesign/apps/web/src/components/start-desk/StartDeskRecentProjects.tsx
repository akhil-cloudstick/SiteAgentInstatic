/**
 * Recent projects, in the approved Start Desk's shape.
 *
 * The reference draws these as a four-column grid of bordered cards, each with
 * a tall site preview above a title row and a `type · updated` line — a
 * gallery, not the horizontal rail the upstream home used. The rail still
 * exists (`RecentProjectsStrip`) and other surfaces still use it; this is the
 * Start Desk's own presentation of the same data.
 *
 * Everything below the surface is the rail's: the same project list, the same
 * cover resolution, the same open / rename / duplicate / delete handlers, the
 * same analytics. Only the card changed.
 *
 * Empty state: the reference never shows one because its fixture always had a
 * project. A real workspace starts empty, and an empty bordered box that says
 * nothing is worse than either a card or no section — so the frame stays (the
 * heading and "View all" are still true) and the grid is replaced by one line
 * that says what to do next.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from '@open-design/components';
import { useT } from '../../i18n';
import { fetchProjectFiles } from '../../providers/registry';
import type { DesignSystemSummary, Project } from '../../types';
import {
  HtmlProjectCoverFrame,
  selectProjectFileCover,
  type ProjectCoverOverride,
} from '../project-cover';
import {
  projectCover,
  projectCategory,
  relativeTime,
  type ProjectCategory,
} from '../RecentProjectsStrip';
import { isDesignSystemProject, isPublishedDesignSystemProject } from '../design-system-project';
import { useDismissable } from './useDismissable';

/** The approved grid is four across; more than eight cards is a Projects view. */
const RECENT_LIMIT = 8;

const CATEGORY_LABEL_KEYS: Record<ProjectCategory, string> = {
  prototype: 'designs.tagPrototype',
  'live-artifact': 'designs.tagLiveArtifact',
  slide: 'designs.tagSlide',
  media: 'designs.tagMedia',
  brand: 'designs.tagBrand',
};

export interface StartDeskRecentProjectsProps {
  projects: Project[];
  designSystems?: DesignSystemSummary[];
  loading?: boolean;
  onOpen: (id: string) => void;
  onDelete?: (id: string) => Promise<boolean | void> | boolean | void;
  onDuplicate?: (id: string) => Promise<void> | void;
  onRename?: (id: string, name: string) => void;
  /** Shown in the empty state, so the section still leads somewhere. */
  onStartFirstProject?: () => void;
}

export function StartDeskRecentProjects({
  projects,
  designSystems,
  loading,
  onOpen,
  onDelete,
  onDuplicate,
  onRename,
  onStartFirstProject,
}: StartDeskRecentProjectsProps) {
  const t = useT();
  const [coverByProject, setCoverByProject] = useState<
    Record<string, ProjectCoverOverride | null>
  >({});
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; original: string } | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<Project | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const renameTitleId = useId();
  const confirmTitleId = useId();

  const recent = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_LIMIT),
    [projects],
  );

  useDismissable({
    open: menuOpenId !== null,
    panelRef: menuRef,
    triggerRef: menuTriggerRef,
    onDismiss: () => setMenuOpenId(null),
  });

  useEffect(() => {
    let cancelled = false;
    if (recent.length === 0) {
      setCoverByProject({});
      return;
    }
    void Promise.all(
      recent.map(async (project) => {
        // A project that names its own entry file needs no lookup — the rail
        // makes the same call, and doing it twice would double the requests a
        // first paint issues.
        if (project.metadata?.entryFile && !isDesignSystemProject(project)) {
          return [project.id, null] as const;
        }
        try {
          return [project.id, selectProjectFileCover(await fetchProjectFiles(project.id))] as const;
        } catch {
          return [project.id, null] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setCoverByProject(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [recent]);

  if (loading) {
    return (
      <p className="sd-recents__empty" role="status">
        {t('common.loading')}
      </p>
    );
  }

  if (recent.length === 0) {
    return (
      <div className="sd-recents__empty">
        <p>{t('startDesk.recentsEmpty')}</p>
        {onStartFirstProject && (
          <button type="button" onClick={onStartFirstProject}>
            {t('startDesk.recentsEmptyAction')}
            <i className="fa-solid fa-arrow-right" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="sd-recents__grid">
      {recent.map((project) => {
        const cover = projectCover(project, coverByProject[project.id] ?? null);
        const category = projectCategory(project);
        const typeLabel = isDesignSystemProject(project)
          ? t('startDesk.typeDesignSystem')
          : t(CATEGORY_LABEL_KEYS[category] as Parameters<typeof t>[0]);
        const published = isPublishedDesignSystemProject(project, designSystems ?? []);
        const actionsAvailable = Boolean(onDelete || onDuplicate || onRename);

        return (
          <div className="sd-project-card" key={project.id} data-project-id={project.id}>
            <button
              type="button"
              className="sd-project-card__main"
              onClick={() => onOpen(project.id)}
              title={project.name}
            >
              <span className="sd-project-card__cover" style={cover.style} aria-hidden="true">
                {(cover.kind === 'image' || cover.kind === 'logo') && cover.src ? (
                  <img src={cover.src} alt="" loading="lazy" />
                ) : cover.kind === 'video' && cover.src ? (
                  <video src={cover.src} muted preload="metadata" playsInline />
                ) : cover.kind === 'html' ? (
                  <HtmlProjectCoverFrame
                    src={cover.src}
                    initial={cover.initial}
                    iframeClassName="sd-project-card__frame"
                    glyphClassName="sd-project-card__glyph"
                    diagnostic={`${project.id}:${cover.name ?? 'unknown'}`}
                  />
                ) : (
                  <span className="sd-project-card__glyph">{cover.initial}</span>
                )}
              </span>
              <span className="sd-project-card__copy">
                <span className="sd-project-card__title">
                  <strong>{project.name}</strong>
                </span>
                <small>
                  {published ? t('designs.status.published') : typeLabel}
                  <b aria-hidden="true">•</b>
                  {relativeTime(project.updatedAt, t)}
                </small>
              </span>
            </button>

            {actionsAvailable && (
              <div className="sd-project-card__menu-anchor">
                <button
                  type="button"
                  ref={menuOpenId === project.id ? menuTriggerRef : undefined}
                  className="sd-project-card__more"
                  aria-label={t('designs.menuMore')}
                  aria-haspopup="menu"
                  aria-expanded={menuOpenId === project.id}
                  onClick={() =>
                    setMenuOpenId((current) => (current === project.id ? null : project.id))
                  }
                >
                  <i className="fa-solid fa-ellipsis-vertical" aria-hidden="true" />
                </button>
                {menuOpenId === project.id && (
                  <div className="sd-project-card__menu" role="menu" ref={menuRef}>
                    <button type="button" role="menuitem" onClick={() => onOpen(project.id)}>
                      {t('designs.menuOpen')}
                    </button>
                    {onRename && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpenId(null);
                          setRenameTarget({ id: project.id, original: project.name });
                          setRenameInput(project.name);
                        }}
                      >
                        {t('designs.menuRename')}
                      </button>
                    )}
                    {onDuplicate && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpenId(null);
                          void Promise.resolve(onDuplicate(project.id)).catch((err) => {
                            console.warn('[StartDeskRecentProjects] duplicate failed:', err);
                          });
                        }}
                      >
                        {t('designs.menuDuplicate')}
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        role="menuitem"
                        className="is-danger"
                        onClick={() => {
                          setMenuOpenId(null);
                          // Destructive and not undoable, so it confirms before
                          // it runs — the same bar the rail's dialog sets.
                          setConfirmTarget(project);
                        }}
                      >
                        {t('designs.menuDelete')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {renameTarget && (
        <Dialog
          as="form"
          className="modal-rename"
          onClose={closeRename}
          closeOnEscape
          ariaLabelledBy={renameTitleId}
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = renameInput.trim();
            if (onRename && trimmed && trimmed !== renameTarget.original) {
              onRename(renameTarget.id, trimmed);
            }
            closeRename();
          }}
        >
          <DialogTitle id={renameTitleId}>{t('designs.renameTitle')}</DialogTitle>
          <label>
            {t('designs.renamePrompt', { name: renameTarget.original })}
            <input
              type="text"
              value={renameInput}
              autoFocus
              onChange={(event) => setRenameInput(event.target.value)}
            />
          </label>
          <DialogFooter className="row">
            <button type="button" onClick={closeRename}>
              {t('designs.renameCancel')}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!renameInput.trim() || renameInput.trim() === renameTarget.original}
            >
              {t('designs.renameSave')}
            </button>
          </DialogFooter>
        </Dialog>
      )}

      {confirmTarget && (
        <Dialog
          className="modal-confirm"
          role="alertdialog"
          onClose={() => setConfirmTarget(null)}
          ariaLabelledBy={confirmTitleId}
        >
          <DialogTitle id={confirmTitleId}>{t('designs.deleteTitle')}</DialogTitle>
          <DialogDescription>
            {t('designs.deleteConfirm', { name: confirmTarget.name })}
          </DialogDescription>
          <DialogFooter className="row">
            <button type="button" onClick={() => setConfirmTarget(null)}>
              {t('designs.renameCancel')}
            </button>
            <button
              type="button"
              className="primary danger"
              onClick={() => {
                const target = confirmTarget;
                setConfirmTarget(null);
                if (!onDelete) return;
                void Promise.resolve(onDelete(target.id)).catch((err) => {
                  console.warn('[StartDeskRecentProjects] delete failed:', err);
                });
              }}
            >
              {t('designs.menuDelete')}
            </button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );

  function closeRename(): void {
    setRenameTarget(null);
    setRenameInput('');
  }
}
