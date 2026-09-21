/**
 * ShareToCmsDialog — the compliance-gate dialog.
 *
 * Raised automatically when `pushProjectToCms` reports a block: the tenant
 * never has to go looking for it. "Fix it" is offered only for a compliance
 * rejection, which is the one failure the agent can actually repair; a lite
 * workspace with no CMS attached, or an unreachable CMS, gets the explanation
 * without a button that would decide nothing.
 *
 * Restored after the 0.20.0 upgrade deleted `components/studio/`. Its i18n keys
 * (`studio.shareDialog*`, `studio.fixIt`) survived the merge unused, so the
 * copy below is the original approved wording in all 19 locales.
 */
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FaIcon } from '@mms/shell';
import { useT } from '../../i18n';
import type { ShareBlock } from './share-to-cms';

export interface ShareToCmsDialogProps {
  /** The daemon's block. `null` hides the dialog. */
  block: ShareBlock | null;
  onClose: () => void;
  /** Drops the repair prompt into the conversation and starts a run. */
  onFix?: () => void;
}

export function ShareToCmsDialog({ block, onClose, onFix }: ShareToCmsDialogProps) {
  const t = useT();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes and the close button takes focus, matching every other
  // dialog on this screen.
  useEffect(() => {
    if (block === null) return undefined;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, block]);

  if (block === null) return null;
  if (typeof document === 'undefined') return null;

  // Only a compliance rejection is something the agent can repair in place.
  const fixable = block.kind === 'compliance' && Boolean(onFix);
  // A refusal to overwrite an existing website is not an error and not a
  // limitation of this design — it is the platform protecting a live site, so
  // it is titled as such rather than borrowing "add some files first".
  const siteExists = block.kind === 'site-exists';

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
        data-block-kind={block.kind}
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
          <FaIcon name={fixable ? 'wand-magic-sparkles' : siteExists ? 'shield-halved' : 'circle-info'} size={22} />
        </span>
        <p className="dialog-eyebrow">{t('studio.shareDialogEyebrow')}</p>
        <h2 id={titleId}>
          {fixable
            ? t('studio.shareDialogTitle')
            : siteExists
              ? t('studio.shareSiteExistsTitle')
              : t('studio.shareDisabledHint')}
        </h2>
        {fixable ? <p>{t('studio.shareDialogBody')}</p> : null}
        {block.reason.trim() ? (
          <p className="studio-share-dialog__reason">{block.reason}</p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t('designs.renameCancel')}
          </button>
          {fixable ? (
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
