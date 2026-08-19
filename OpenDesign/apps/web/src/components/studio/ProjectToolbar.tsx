/**
 * ProjectToolbar — the approved MMSBUILD Studio's project row
 * (`prototype-reference/src/ui.jsx:238-270`, styles
 * `prototype-reference/src/styles.css:1066-1167`).
 *
 * The shared-header contract puts these four controls here and nowhere else:
 * "Project-specific controls such as project type, design system, Local CLI
 * state and Share to CMS remain in the workspace toolbar below row 2. They do
 * not belong in the shared header." (SHARED-HEADER-INSTRUCTIONS.md:132)
 *
 * Every control is live. The prototype's versions raised a toast; these are
 * wired to the handlers MMS Design already had:
 *   - title            → project rename
 *   - project type     → a read-only fact sheet plus Duplicate / Delete, the
 *                        two project actions the Projects row already offers.
 *                        The reference control is a disclosure; leaving it
 *                        inert would ship a dead control.
 *   - design system    → the existing DesignSystemPicker
 *   - Local CLI        → the existing agent/model menu, with a live daemon dot
 *                        in place of the prototype's static "Fixture" chip
 *                        (a fixture the build kit forbids preserving)
 *   - Share to CMS     → the real Instatic push + compliance gate
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FaIcon } from '@mms/shell';
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from '@open-design/components';
import { useT } from '../../i18n';
import { SelectButton } from './SelectButton';

export interface ProjectToolbarProps {
  projectName: string;
  /** "Prototype", "Website clone", "Deck"… — already localized. */
  projectType: string;
  /** Fact rows for the type popover: `[label, value]`. */
  projectFacts: Array<[string, string]>;
  onRename: (name: string) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  /** The DesignSystemPicker in its `toolbar` variant. */
  designSystemSlot: ReactNode;
  /**
   * Optional runtime control. Empty in MMSBUILD: the operator owns the model,
   * so the toolbar has no runtime to switch.
   */
  runtimeSlot?: ReactNode;
  onShareToCms: () => void;
  /** True until the project has a page the CMS could import. */
  shareDisabled: boolean;
  /**
   * Extra rows for the project popover. The approved toolbar and file-tab row
   * carry a fixed set of controls, so anything project-scoped without a place
   * in them (Handoff / Continue in CLI) is disclosed here rather than added to
   * a row the reference fixes.
   */
  menuSlot?: ReactNode;
}

export function ProjectToolbar({
  projectName,
  projectType,
  projectFacts,
  onRename,
  onDuplicate,
  onDelete,
  designSystemSlot,
  runtimeSlot,
  onShareToCms,
  shareDisabled,
  menuSlot,
}: ProjectToolbarProps) {
  const t = useT();
  const confirmTitleId = useId();
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const typeTriggerRef = useRef<HTMLButtonElement>(null);
  const typePanelRef = useRef<HTMLDivElement>(null);

  // Deliberately NOT `useDismissable`: that hook closes on any scroll outside
  // the panel, and the control lives inside an `overflow-x: auto` strip — so
  // the browser scrolling the pressed trigger into view fired a scroll event
  // and shut the menu in the same frame it opened. That is why clicking it
  // produced a scrollbar and nothing else. This menu is `position: fixed` and
  // re-places itself on scroll instead of closing.
  useEffect(() => {
    if (!typeMenuOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (typePanelRef.current?.contains(target) || typeTriggerRef.current?.contains(target)) return;
      setTypeMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [typeMenuOpen]);

  // The controls strip is an `overflow-x: auto` scroller (that is what keeps a
  // toolbar wider than its row from pushing the whole app sideways), and an
  // `overflow` ancestor CLIPS absolutely-positioned descendants — the menu was
  // being cut down to the strip's height, which is why opening it produced a
  // scrollbar and nothing else. So it renders `position: fixed` into
  // `document.body`, exactly as the design-system picker and the agent menu
  // already do, with coordinates measured from the trigger.
  const [typeMenuStyle, setTypeMenuStyle] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!typeMenuOpen) {
      setTypeMenuStyle(null);
      return undefined;
    }
    const place = () => {
      const trigger = typeTriggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = 295;
      setTypeMenuStyle({
        position: 'fixed',
        top: Math.round(rect.bottom + 8),
        // Keep the panel on screen when the trigger sits near the right edge.
        left: Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))),
        width,
        maxHeight: Math.max(160, Math.round(window.innerHeight - rect.bottom - 24)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [typeMenuOpen]);

  useEffect(() => {
    if (!typeMenuOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setTypeMenuOpen(false);
      window.requestAnimationFrame(() => typeTriggerRef.current?.focus());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [typeMenuOpen]);

  const commitRename = (next: string) => {
    const trimmed = next.trim();
    if (!trimmed || trimmed === projectName) return;
    onRename(trimmed);
  };

  const onTitleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.textContent = projectName;
      event.currentTarget.blur();
    }
  };

  return (
    <div className="project-toolbar">
      <div className="project-title">
        <span className="project-mark" aria-hidden="true">
          <FaIcon name="folder-open" size={17} />
        </span>
        <strong
          data-testid="project-title"
          title={projectName}
          role="textbox"
          tabIndex={0}
          contentEditable
          suppressContentEditableWarning
          onBlur={(event) => commitRename(event.currentTarget.textContent ?? '')}
          onKeyDown={onTitleKeyDown}
        >
          {projectName}
        </strong>
      </div>

      <div className="project-toolbar-controls">
        <span className="studio-type-select">
          <SelectButton
            icon="code"
            buttonRef={typeTriggerRef}
            aria-haspopup="menu"
            aria-expanded={typeMenuOpen}
            title={projectType}
            onClick={() => setTypeMenuOpen((open) => !open)}
          >
            {projectType}
          </SelectButton>
          {typeMenuOpen && typeMenuStyle && typeof document !== 'undefined'
            ? createPortal(
            <div ref={typePanelRef} className="studio-type-menu" role="menu" style={typeMenuStyle}>
              <strong>{t('studio.projectFactsTitle')}</strong>
              <dl>
                {projectFacts.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd title={value}>{value}</dd>
                  </div>
                ))}
              </dl>
              {menuSlot ? (
                <>
                  <div className="studio-type-menu__divider" />
                  <div className="studio-type-menu__slot">{menuSlot}</div>
                </>
              ) : null}
              {onDuplicate || onDelete ? <div className="studio-type-menu__divider" /> : null}
              {onDuplicate ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setTypeMenuOpen(false);
                    onDuplicate();
                  }}
                >
                  <FaIcon name="copy" size={13} />
                  {t('designs.menuDuplicate')}
                </button>
              ) : null}
              {onDelete ? (
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setTypeMenuOpen(false);
                    setConfirmingDelete(true);
                  }}
                >
                  <FaIcon name="trash" size={13} />
                  {t('designs.menuDelete')}
                </button>
              ) : null}
            </div>,
                document.body,
              )
            : null}
        </span>

        {designSystemSlot}
        {runtimeSlot}

        <button
          type="button"
          className="share-cms-button"
          data-testid="studio-share-to-cms"
          onClick={onShareToCms}
          disabled={shareDisabled}
          title={shareDisabled ? t('studio.shareDisabledHint') : t('studio.shareToCms')}
        >
          <FaIcon name="share-from-square" size={14} />
          {t('studio.shareToCms')}
        </button>
      </div>

      {confirmingDelete ? (
        <Dialog
          className="modal-confirm"
          role="alertdialog"
          onClose={() => setConfirmingDelete(false)}
          ariaLabelledBy={confirmTitleId}
        >
          <DialogTitle id={confirmTitleId}>{t('designs.deleteTitle')}</DialogTitle>
          <DialogDescription className="modal-confirm-message">
            {t('designs.deleteConfirm', { name: projectName })}
          </DialogDescription>
          <DialogFooter className="row">
            <button type="button" onClick={() => setConfirmingDelete(false)}>
              {t('designs.renameCancel')}
            </button>
            <button
              type="button"
              className="primary danger"
              autoFocus
              onClick={() => {
                setConfirmingDelete(false);
                onDelete?.();
              }}
            >
              {t('designs.menuDelete')}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </div>
  );
}
