/**
 * LinkedProjectRow — one project, drawn as the approved reference's
 * `.linked-project-row` (`prototype-reference/src/ProjectsScreen.jsx:26-40`,
 * `project-context.css:595-652`).
 *
 * The reference renders exactly one row from a hardcoded Harbour Suites
 * fixture. The build kit forbids shipping that fixture —
 * "Implement a real Projects route… List only projects authorized by the
 * supplied role/client/project context" (OPEN-DESIGN-DEVELOPER-BUILD-
 * INSTRUCTIONS §3) and "must not preserve: one hard-coded Harbour Suites
 * partial fixture" (§5) — so the row's SHAPE is the reference's and its
 * CONTENT is the real project.
 *
 * The kebab is this file's only addition to the reference's markup: rename,
 * duplicate and delete have to stay reachable from the Projects page, and the
 * reference's own catalogue screens already use exactly this
 * `.catalog-menu-wrap` + `.catalog-popover` idiom for per-row actions
 * (`AutomationsScreen.jsx:340-343`). Dismissal goes through `useDismissable`
 * rather than the prototype's toggle-only handler, which cannot be closed by
 * scrolling away from it.
 */
import { useId, useRef, useState } from 'react';
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from '@open-design/components';
import { useT } from '../i18n';
import type { DesignSystemSummary, Project } from '../types';
import { useDismissable } from './start-desk/useDismissable';
import {
  isDesignSystemProject,
  isPublishedDesignSystemProject,
  resolveProjectDesignSystemId,
} from './design-system-project';
import { isPendingStatus, relativeTime, statusLabel } from './projectStatus';
import styles from './ProjectsScreen.module.css';

type Dict = ReturnType<typeof useT>;

export interface LinkedProjectRowProps {
  project: Project;
  designSystems: DesignSystemSummary[];
  /** True when Product Hub scoped this session to exactly this project. */
  hubLinked: boolean;
  onOpen: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<boolean | void> | boolean | void;
}

export function LinkedProjectRow({
  project,
  designSystems,
  hubLinked,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}: LinkedProjectRowProps) {
  const t = useT();
  const renameTitleId = useId();
  const confirmTitleId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useDismissable({
    open: menuOpen,
    panelRef,
    triggerRef,
    onDismiss: () => setMenuOpen(false),
  });

  const designSystemName = designSystemLabel(project, designSystems, t);
  const status = project.status?.value ?? 'not_started';

  const startRename = () => {
    setMenuOpen(false);
    setRenameInput(project.name);
    setRenaming(true);
  };

  const commitRename = () => {
    const next = renameInput.trim();
    setRenaming(false);
    if (!next || next === project.name) return;
    onRename?.(project.id, next);
  };

  return (
    <article className={styles.row} data-testid="linked-project-row" data-project-id={project.id}>
      <span className={styles.rowIcon} aria-hidden="true">
        <i className={`fa-solid fa-${markGlyph(project)}`} />
      </span>

      <div className={styles.rowMain}>
        <small>{eyebrow(project, hubLinked, t)}</small>
        <h3>{project.name}</h3>
        <p>{description(project, t)}</p>
        {/*
          The reference's four meta chips, in its order and tones:
            1  layer-group   "{design system} · {status}"
            2  circle-check  "Brand and knowledge ready"      (.ready, green)
            3  circle-excl.  "Snapshot 03 excluded"           (.pending, amber)
            4  clock         "Updated today"

          Chips 2 and 3 name Product Hub records that this control plane does
          not carry, so they are filled with the equivalent facts it does have:
          the project's own run state, and whether Product Hub scoped this
          session at all. Same shape, same tones, no invented records.
        */}
        <div className={styles.rowMeta}>
          <span>
            <i className="fa-solid fa-layer-group" aria-hidden="true" />
            {designSystemName}
          </span>
          <span className={isPendingStatus(status) ? styles.metaPending : styles.metaReady}>
            <i
              className={`fa-solid fa-${isPendingStatus(status) ? 'circle-exclamation' : 'circle-check'}`}
              aria-hidden="true"
            />
            {statusLabel(status, t)}
          </span>
          <span className={hubLinked ? styles.metaReady : styles.metaPending}>
            <i
              className={`fa-solid fa-${hubLinked ? 'circle-check' : 'circle-exclamation'}`}
              aria-hidden="true"
            />
            {hubLinked ? t('projects.metaHubInherited') : t('projects.metaHubMissing')}
          </span>
          <span>
            <i className="fa-solid fa-clock" aria-hidden="true" />
            {t('projects.metaUpdated', { time: relativeTime(project.updatedAt, t) })}
          </span>
        </div>
      </div>

      <div className={styles.rowActions}>
        {/* Top-right corner of the row, drawn only on hover/focus — see
            `.rowActions` and `.rowMenuAnchor`. */}
        <span
          className={`${styles.menuWrap} ${styles.rowMenuAnchor}`}
          data-open={menuOpen ? 'true' : 'false'}
        >
        <button
          ref={triggerRef}
          type="button"
          className={styles.iconButton}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t('projects.rowMenuAria', { name: project.name })}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <i className="fa-solid fa-ellipsis-vertical" aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div ref={panelRef} className={styles.popover} role="menu">
            {onRename ? (
              <button type="button" role="menuitem" onClick={startRename}>
                <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
                {t('designs.menuRename')}
              </button>
            ) : null}
            {onDuplicate ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void onDuplicate(project.id);
                }}
              >
                <i className="fa-solid fa-copy" aria-hidden="true" />
                {t('designs.menuDuplicate')}
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className={styles.danger}
              onClick={() => {
                setMenuOpen(false);
                setConfirming(true);
              }}
            >
              <i className="fa-solid fa-trash" aria-hidden="true" />
              {t('designs.menuDelete')}
            </button>
          </div>
        ) : null}
        </span>

        <button
          type="button"
          className={styles.primaryAction}
          data-testid="open-studio"
          aria-label={t('projects.openStudioAria', { name: project.name })}
          onClick={() => onOpen(project.id)}
        >
          {t('projects.openStudio')}
          <i className="fa-solid fa-arrow-right" aria-hidden="true" />
        </button>
      </div>

      {renaming ? (
        <Dialog
          as="form"
          className="modal-rename"
          onClose={() => setRenaming(false)}
          closeOnEscape
          ariaLabelledBy={renameTitleId}
          onSubmit={(event) => {
            event.preventDefault();
            commitRename();
          }}
        >
          <DialogTitle id={renameTitleId}>{t('designs.renameTitle')}</DialogTitle>
          <label>
            {t('designs.renamePrompt', { name: project.name })}
            <input
              type="text"
              value={renameInput}
              autoFocus
              onChange={(event) => setRenameInput(event.target.value)}
            />
          </label>
          <DialogFooter className="row">
            <button type="button" onClick={() => setRenaming(false)}>
              {t('designs.renameCancel')}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!renameInput.trim() || renameInput.trim() === project.name}
            >
              {t('designs.renameSave')}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}

      {confirming ? (
        <Dialog
          className="modal-confirm"
          role="alertdialog"
          onClose={() => setConfirming(false)}
          ariaLabelledBy={confirmTitleId}
        >
          <DialogTitle id={confirmTitleId}>{t('designs.deleteTitle')}</DialogTitle>
          <DialogDescription className="modal-confirm-message">
            {t('designs.deleteConfirm', { name: project.name })}
          </DialogDescription>
          <DialogFooter className="row">
            <button type="button" onClick={() => setConfirming(false)}>
              {t('designs.renameCancel')}
            </button>
            <button
              type="button"
              className="primary danger"
              autoFocus
              onClick={() => {
                setConfirming(false);
                void onDelete(project.id);
              }}
            >
              {t('designs.menuDelete')}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </article>
  );
}

/**
 * The reference's eyebrow reads `WEBSITE · PRODUCT HUB LINKED`. The first half
 * is what kind of project this is; the second is appended only when Product Hub
 * actually scoped the session to it — claiming a Hub link that does not exist
 * is precisely the fixture behaviour the kit rejects.
 */
function eyebrow(project: Project, hubLinked: boolean, t: Dict): string {
  const kind = t(kindKey(project));
  return hubLinked ? `${kind} · ${t('projects.rowLinked')}` : kind;
}

type DictKey = Parameters<Dict>[0];

function kindKey(project: Project): DictKey {
  const metadata = project.metadata;
  if (isDesignSystemProject(project)) return 'projects.kindDesignSystem';
  if (metadata?.kind === 'brand') return 'projects.kindBrand';
  if (metadata?.intent === 'live-artifact') return 'projects.kindLiveArtifact';
  if (metadata?.intent === 'web-clone') return 'projects.kindWebsite';
  if (metadata?.kind === 'deck') return 'projects.kindDeck';
  if (metadata?.kind === 'image' || metadata?.kind === 'video' || metadata?.kind === 'audio') {
    return 'projects.kindMedia';
  }
  if (metadata?.kind === 'prototype') return 'projects.kindPrototype';
  return 'projects.kindProject';
}

/**
 * The reference's 46x46 mark is a globe because its one fixture project is a
 * website. Keeping a globe on a deck or an audio project would be the wrong
 * glyph, not fidelity, so each kind gets its own Font Awesome Solid glyph in
 * the same mark.
 */
function markGlyph(project: Project): string {
  const metadata = project.metadata;
  if (isDesignSystemProject(project)) return 'border-all';
  if (metadata?.kind === 'brand') return 'palette';
  if (metadata?.kind === 'deck') return 'display';
  if (metadata?.kind === 'image') return 'image';
  if (metadata?.kind === 'video') return 'film';
  if (metadata?.kind === 'audio') return 'waveform-lines';
  return 'globe';
}

/**
 * `Project` has no description field, so the reference's sentence is composed
 * from what is true: its kind, and the fact that MMS Design owns the editable
 * copy. Website-shaped projects keep the reference's exact phrasing.
 */
function description(project: Project, t: Dict): string {
  const metadata = project.metadata;
  const websiteShaped =
    metadata?.intent === 'web-clone' ||
    metadata?.kind === 'prototype' ||
    metadata?.kind === 'template' ||
    metadata?.kind === undefined;
  return websiteShaped
    ? t('projects.rowDescriptionWebsite', { name: project.name })
    : t('projects.rowDescription', { name: project.name });
}

/**
 * Reference meta chip: `Harbour Suites DS · Published` — the bound system and
 * its publish state, always both halves. Falls back to the existing `freeform`
 * label when nothing is bound.
 */
function designSystemLabel(
  project: Project,
  designSystems: DesignSystemSummary[],
  t: Dict,
): string {
  const id = resolveProjectDesignSystemId(project);
  const system = id ? designSystems.find((candidate) => candidate.id === id) : undefined;
  if (!system) return t('designs.cardFreeform');
  const published =
    system.status === 'published' || isPublishedDesignSystemProject(project, designSystems);
  return `${system.title} · ${published ? t('designs.status.published') : t('projects.dsDraft')}`;
}
