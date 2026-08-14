/**
 * ShareToCmsDialog — the compliance-gate dialog, drawn as the approved
 * prototype's `ShareDialog` (`prototype-reference/src/App.jsx:18-34`, styles at
 * `prototype-reference/src/styles.css:3805-3869, 4158-4178`).
 *
 * It replaces the inline-styled dark dialog that used to live in
 * `FileViewer.tsx`: same reason string, same Cancel / Fix it contract, the
 * reference's chrome. The reference wrote generic prototype copy in the body;
 * this shows the REAL block reason the daemon returned underneath it, because
 * the prototype had no gate to report.
 */
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FaIcon } from '@mms/shell';
import { useT } from '../../i18n';

export interface ShareToCmsDialogProps {
  /** The daemon's block reason. `null` hides the dialog. */
  reason: string | null;
  onClose: () => void;
  /** Drops the repair prompt into the conversation and starts a run. */
  onFix?: () => void;
}

export function ShareToCmsDialog({ reason, onClose, onFix }: ShareToCmsDialogProps) {
  const t = useT();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes and the close button takes focus, matching every other
  // dialog on this screen. The prototype relied on the backdrop alone.
  useEffect(() => {
    if (reason === null) return undefined;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, reason]);

  if (reason === null) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="studio-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="studio-share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button
          ref={closeRef}
          type="button"
          className="dialog-close"
          onClick={onClose}
          aria-label={t('designs.renameCancel')}
        >
          <FaIcon name="xmark" size={15} />
        </button>
        <span className="dialog-icon" aria-hidden="true">
          <FaIcon name="wand-magic-sparkles" size={22} />
        </span>
        <p className="dialog-eyebrow">{t('studio.shareDialogEyebrow')}</p>
        <h2 id={titleId}>{t('studio.shareDialogTitle')}</h2>
        <p>{t('studio.shareDialogBody')}</p>
        {/* The prototype had no gate, so it had nothing to report here. */}
        {reason.trim() ? <p className="studio-share-dialog__reason">{reason}</p> : null}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t('designs.renameCancel')}
          </button>
          {onFix ? (
            <button type="button" className="primary-button" onClick={onFix}>
              {t('studio.fixIt')}
            </button>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}
