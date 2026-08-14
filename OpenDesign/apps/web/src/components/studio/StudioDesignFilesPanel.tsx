/**
 * StudioDesignFilesPanel — the Studio's fifth column, drawn as the approved
 * prototype's `DesignFilesPanel` (`prototype-reference/src/Workspace.jsx:63-132`,
 * styles `prototype-reference/src/styles.css:2412-2567`).
 *
 * The prototype rendered a hard-coded eleven-row `public/images/hero.jpg…`
 * fixture with a dead search box; the build kit lists that fixture among the
 * behaviours a developer "must not preserve". So the SHAPE is the reference's
 * — collapse rail, search, indented tree, three actions — and the CONTENT is
 * the project's real files, with a search that actually filters.
 *
 * Folders come from the file names themselves (`images/hero.jpg` implies an
 * `images` folder) plus the daemon's own empty-folder list, so the tree is the
 * real directory structure rather than a flat list dressed up as one.
 *
 * This is a NAVIGATOR, not a file manager: the full Design Files tab keeps
 * rename, delete, bulk selection and folder management. Nothing was removed.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ProjectFile, ProjectFolder } from '@open-design/contracts';
import { FaIcon } from '@mms/shell';
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from '@open-design/components';
import { useT } from '../../i18n';

/** `iconForFile` in `Workspace.jsx:56-61`, extended to the app's real kinds. */
function iconForFile(kind: ProjectFile['kind'] | 'folder'): string {
  if (kind === 'folder') return 'folder';
  if (kind === 'image') return 'image';
  if (kind === 'video') return 'film';
  if (kind === 'audio') return 'file-audio';
  if (kind === 'text' || kind === 'document') return 'file-lines';
  if (kind === 'html') return 'file-code';
  return 'code';
}

interface TreeRow {
  key: string;
  name: string;
  /** Full path, used as the id passed back to `onOpenFile`. */
  path: string;
  level: number;
  isFolder: boolean;
  kind: ProjectFile['kind'] | 'folder';
}

/**
 * Flatten the project's files into the reference's indented row list. Folders
 * sort before files at every level and both sort alphabetically, which is the
 * order the prototype's fixture was written in.
 */
function buildTree(files: ProjectFile[], folders: ProjectFolder[]): TreeRow[] {
  const folderPaths = new Set<string>();
  for (const folder of folders) {
    const normalized = folder.path.replace(/^\/+|\/+$/g, '');
    if (normalized) folderPaths.add(normalized);
  }
  for (const file of files) {
    const segments = file.name.split('/').filter(Boolean);
    for (let i = 0; i < segments.length - 1; i += 1) {
      folderPaths.add(segments.slice(0, i + 1).join('/'));
    }
  }

  const rows: TreeRow[] = [];
  for (const path of folderPaths) {
    const segments = path.split('/');
    rows.push({
      key: `dir:${path}`,
      name: segments[segments.length - 1] ?? path,
      path,
      level: segments.length - 1,
      isFolder: true,
      kind: 'folder',
    });
  }
  for (const file of files) {
    const segments = file.name.split('/').filter(Boolean);
    rows.push({
      key: `file:${file.name}`,
      name: segments[segments.length - 1] ?? file.name,
      path: file.name,
      level: Math.max(0, segments.length - 1),
      isFolder: false,
      kind: file.kind,
    });
  }

  return rows.sort((a, b) => {
    const aParent = a.path.slice(0, a.path.lastIndexOf('/') + 1);
    const bParent = b.path.slice(0, b.path.lastIndexOf('/') + 1);
    if (aParent !== bParent) return aParent < bParent ? -1 : 1;
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export interface StudioDesignFilesPanelProps {
  files: ProjectFile[];
  folders: ProjectFolder[];
  /** Currently open workspace tab, so the row can read as selected. */
  selectedFile: string | null;
  collapsed: boolean;
  onToggleCollapse: (() => void) | undefined;
  onSelectFile: (name: string) => void;
  onUploadFiles: () => void;
  onNewDocument: () => void;
  onNewSketch: () => void;
  /** Opens the full Design Files tab — bulk selection and folders live there. */
  onOpenAllFiles: () => void;
  /** Rename a file in place. The reference's row kebab was decorative; this is not. */
  onRenameFile: (name: string, nextName: string) => void;
  onDeleteFile: (name: string) => void;
  /** Full-screen overlay state below 1100px. */
  mobileOpen?: boolean;
}

export function StudioDesignFilesPanel({
  files,
  folders,
  selectedFile,
  collapsed,
  onToggleCollapse,
  onSelectFile,
  onUploadFiles,
  onNewDocument,
  onNewSketch,
  onOpenAllFiles,
  onRenameFile,
  onDeleteFile,
  mobileOpen = false,
}: StudioDesignFilesPanelProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  // Which row's kebab is open, and the two dialogs it can raise.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const renameTitleId = useId();
  const confirmTitleId = useId();
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Bound on the frame AFTER the opening click, so the click that opens the
  // menu is not the one that closes it.
  useEffect(() => {
    if (!menuFor) return undefined;
    const close = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setMenuFor(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuFor(null);
    };
    const id = window.setTimeout(() => {
      document.addEventListener('pointerdown', close, true);
      document.addEventListener('scroll', close, true);
    }, 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuFor]);

  const baseName = (path: string) => path.split('/').pop() ?? path;

  const rows = useMemo(() => buildTree(files, folders), [files, folders]);

  // Filtering flattens the tree to matching FILES only: showing an indented
  // orphan under a folder that was filtered out reads as a broken hierarchy.
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows
      .filter((row) => !row.isFolder && row.path.toLowerCase().includes(needle))
      .map((row) => ({ ...row, level: 0 }));
  }, [query, rows]);

  const className = [
    'design-files-panel',
    mobileOpen ? 'mobile-open' : '',
    collapsed ? 'collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <aside className={className} id="studio-design-files-panel">
      <div className="panel-title">
        <strong>{t('studio.designFiles')}</strong>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? t('studio.expandDesignFiles') : t('studio.collapseDesignFiles')}
          title={collapsed ? t('studio.expandDesignFiles') : t('studio.collapseDesignFiles')}
          aria-expanded={!collapsed}
          aria-controls="studio-design-files-content"
        >
          {/* `collapseSide="right"`: collapsed points back INTO the panel. */}
          <FaIcon name={collapsed ? 'chevron-left' : 'chevron-right'} size={13} />
        </button>
      </div>
      {!collapsed ? (
        <div className="panel-content design-files-content" id="studio-design-files-content">
          <label className="file-search">
            <FaIcon name="magnifying-glass" size={13} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('studio.searchFiles')}
              aria-label={t('studio.searchFilesAria')}
            />
          </label>
          <div className="file-tree">
            {visibleRows.length === 0 ? (
              <p className="file-tree-empty">
                {query.trim() ? t('studio.noFilesMatch') : t('studio.noFilesYet')}
              </p>
            ) : (
              visibleRows.map((row) => (
                // The kebab is a SIBLING of the row button, not a child of it:
                // a button inside a button is invalid, and the menu it opens was
                // being clipped by the tree's own `overflow-y` scroller. The
                // menu itself is portalled (see below).
                <div
                  key={row.key}
                  className="file-tree-row"
                  style={{ '--file-level': row.level } as React.CSSProperties}
                >
                  <button
                    type="button"
                    className={!row.isFolder && selectedFile === row.path ? 'selected' : ''}
                    title={row.path}
                    onClick={() => {
                      // A folder row is a label in this navigator: the reference
                      // renders the whole tree expanded and never collapses it,
                      // so clicking one opens the full file manager instead of
                      // pretending to toggle something.
                      if (row.isFolder) onOpenAllFiles();
                      else onSelectFile(row.path);
                    }}
                  >
                    {row.isFolder ? (
                      <FaIcon name="chevron-down" size={7} className="tree-chevron" />
                    ) : (
                      <span className="tree-chevron" />
                    )}
                    <FaIcon name={iconForFile(row.kind)} size={13} />
                    <span>{row.name}</span>
                  </button>
                  {/* The reference draws this kebab and wires nothing to it.
                      Here it is a real row menu over the file the row names. */}
                  {row.isFolder ? null : (
                    <button
                      type="button"
                      className="file-menu-icon"
                      aria-haspopup="menu"
                      aria-expanded={menuFor === row.path}
                      aria-label={t('studio.fileMenuAria', { name: row.name })}
                      title={t('studio.fileMenuAria', { name: row.name })}
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setMenuAnchor({
                          top: Math.round(rect.bottom + 4),
                          right: Math.round(Math.max(8, window.innerWidth - rect.right)),
                        });
                        setMenuFor((current) => (current === row.path ? null : row.path));
                      }}
                    >
                      <FaIcon name="ellipsis-vertical" size={12} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="file-actions">
            <button type="button" onClick={onUploadFiles}>
              <FaIcon name="upload" size={14} />
              {t('studio.uploadFiles')}
            </button>
            <button type="button" onClick={onNewDocument}>
              <FaIcon name="file-lines" size={14} />
              {t('studio.newDocument')}
            </button>
            <button type="button" onClick={onNewSketch}>
              <FaIcon name="pen" size={14} />
              {t('studio.newSketch')}
            </button>
          </div>
        </div>
      ) : null}

      {/* Portalled for the same reason the project menu is: the tree scrolls,
          and an `overflow` ancestor clips an absolutely-positioned child. */}
      {menuFor && menuAnchor && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              className="studio-file-row-menu"
              role="menu"
              style={{ top: menuAnchor.top, right: menuAnchor.right }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const target = menuFor;
                  setMenuFor(null);
                  onSelectFile(target);
                }}
              >
                <FaIcon name="file-code" size={12} />
                {t('studio.fileMenuOpen')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const target = menuFor;
                  setMenuFor(null);
                  setRenameInput(baseName(target));
                  setRenaming(target);
                }}
              >
                <FaIcon name="pen" size={12} />
                {t('designs.menuRename')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  const target = menuFor;
                  setMenuFor(null);
                  setConfirmingDelete(target);
                }}
              >
                <FaIcon name="trash" size={12} />
                {t('designs.menuDelete')}
              </button>
            </div>,
            document.body,
          )
        : null}

      {renaming ? (
        <Dialog
          as="form"
          className="modal-rename"
          onClose={() => setRenaming(null)}
          closeOnEscape
          ariaLabelledBy={renameTitleId}
          onSubmit={(event) => {
            event.preventDefault();
            const next = renameInput.trim();
            const target = renaming;
            setRenaming(null);
            if (!target || !next || next === baseName(target)) return;
            onRenameFile(target, next);
          }}
        >
          <DialogTitle id={renameTitleId}>{t('designs.renameTitle')}</DialogTitle>
          <label>
            {t('designs.renamePrompt', { name: baseName(renaming) })}
            <input
              type="text"
              value={renameInput}
              autoFocus
              onChange={(event) => setRenameInput(event.target.value)}
            />
          </label>
          <DialogFooter className="row">
            <button type="button" onClick={() => setRenaming(null)}>
              {t('designs.renameCancel')}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!renameInput.trim() || renameInput.trim() === baseName(renaming)}
            >
              {t('designs.renameSave')}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}

      {confirmingDelete ? (
        <Dialog
          className="modal-confirm"
          role="alertdialog"
          onClose={() => setConfirmingDelete(null)}
          ariaLabelledBy={confirmTitleId}
        >
          <DialogTitle id={confirmTitleId}>{t('designs.deleteTitle')}</DialogTitle>
          <DialogDescription className="modal-confirm-message">
            {t('designs.deleteConfirm', { name: baseName(confirmingDelete) })}
          </DialogDescription>
          <DialogFooter className="row">
            <button type="button" onClick={() => setConfirmingDelete(null)}>
              {t('designs.renameCancel')}
            </button>
            <button
              type="button"
              className="primary danger"
              autoFocus
              onClick={() => {
                const target = confirmingDelete;
                setConfirmingDelete(null);
                if (target) onDeleteFile(target);
              }}
            >
              {t('designs.menuDelete')}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </aside>
  );
}
