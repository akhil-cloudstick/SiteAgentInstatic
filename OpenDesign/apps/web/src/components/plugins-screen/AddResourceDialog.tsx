/**
 * "Add" modal — a reproduction of the approved MMSBUILD reference dialog
 * (`prototype-reference/src/PluginsScreen.jsx:80-165`,
 * `resource-screens.css:506-711`).
 *
 * Structure is the reference's, verbatim: a segmented Expert suite / Skill
 * control that drives the noun throughout, then three choices — describe it and
 * let the agent build it, import from a link, upload a local folder.
 *
 * The reference's three actions only raise prototype notices. The build kit
 * (§5) names that among the behaviours a port must not preserve, so each one
 * calls the real daemon path here:
 *   describe -> the plugin-authoring prompt handoff to the Home composer
 *   link     -> POST /api/plugins/install
 *   folder   -> POST /api/plugins/upload-folder (or -zip when a .zip is picked)
 *
 * Skills have no URL/archive install endpoint, so on the Skill branch the two
 * import paths state where skill import actually lives instead of pretending.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n';
import styles from '../PluginsScreen.module.css';

export type AddResourceKind = 'plugins' | 'skills';

export interface AddResourceDialogProps {
  initialKind: AddResourceKind;
  onClose: () => void;
  /** Hand the Home composer an authoring prompt for the chosen kind. */
  onStartFromPrompt: (kind: AddResourceKind) => void;
  /** Install from a public source string. Resolves true when the modal may close. */
  onImportLink: (url: string) => Promise<boolean>;
  /** Upload a picked folder or archive. Resolves true when the modal may close. */
  onUploadFiles: (files: File[]) => Promise<boolean>;
  /** True while an install/upload started by this dialog is in flight. */
  working: boolean;
}

export function AddResourceDialog({
  initialKind,
  onClose,
  onStartFromPrompt,
  onImportLink,
  onUploadFiles,
  working,
}: AddResourceDialogProps) {
  const t = useT();
  const [kind, setKind] = useState<AddResourceKind>(initialKind);
  const [url, setUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [selectedLabel, setSelectedLabel] = useState('');
  const firstAction = useRef<HTMLButtonElement>(null);

  const noun = kind === 'plugins'
    ? t('pluginsScreen.nounExpertSuite')
    : t('pluginsScreen.nounSkill');
  const nounLower = noun.toLocaleLowerCase();
  const importable = kind === 'plugins';

  useEffect(() => {
    firstAction.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Switching branch drops a half-filled import — the two branches do not share
  // an install path, so carrying a plugin URL onto the Skill tab would offer an
  // action that cannot run.
  function changeKind(next: AddResourceKind) {
    setKind(next);
    setUrl('');
    setFiles([]);
    setSelectedLabel('');
  }

  async function importLink() {
    if (!url.trim() || working) return;
    if (await onImportLink(url.trim())) onClose();
  }

  async function uploadFiles() {
    if (files.length === 0 || working) return;
    if (await onUploadFiles(files)) onClose();
  }

  const dialog = (
    <div
      // `resource-modal-backdrop` is a deliberate global: the desktop shell's
      // window-drag strip matches modal backdrops by class name
      // (`hooks/useModalWindowDragGuard.ts`), which a hashed module class
      // cannot satisfy.
      className={`${styles.backdrop} resource-modal-backdrop`}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-resource-title"
        data-testid="plugins-add-dialog"
      >
        <header>
          <div>
            <h2 id="add-resource-title">{t('pluginsScreen.addTitle', { noun })}</h2>
            <p>{t('pluginsScreen.addLede')}</p>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label={t('pluginsScreen.addClose')}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className={styles.segmented} aria-label={t('pluginsScreen.addKindAria')}>
          <button
            ref={firstAction}
            type="button"
            className={kind === 'plugins' ? styles.active : ''}
            onClick={() => changeKind('plugins')}
            data-testid="plugins-add-kind-plugins"
          >
            {t('pluginsScreen.nounExpertSuite')}
          </button>
          <button
            type="button"
            className={kind === 'skills' ? styles.active : ''}
            onClick={() => changeKind('skills')}
            data-testid="plugins-add-kind-skills"
          >
            {t('pluginsScreen.nounSkill')}
          </button>
        </div>

        <div className={styles.modalSections}>
          <section className={`${styles.addChoice} ${styles.addChoicePrimary}`}>
            <span aria-hidden="true"><i className="fa-solid fa-wand-magic-sparkles" /></span>
            <div>
              <h3>{t('pluginsScreen.addPromptTitle')}</h3>
              <p>{t('pluginsScreen.addPromptBody')}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onStartFromPrompt(kind);
              }}
              data-testid="plugins-add-from-prompt"
            >
              {t('pluginsScreen.addPromptAction')}{' '}
              <i className="fa-solid fa-arrow-right" aria-hidden="true" />
            </button>
          </section>

          <section className={styles.addChoice}>
            <span aria-hidden="true"><i className="fa-solid fa-link" /></span>
            <div>
              <h3>{t('pluginsScreen.addLinkTitle')}</h3>
              <p>
                {importable
                  ? t('pluginsScreen.addLinkBody')
                  : t('pluginsScreen.addSkillImportUnavailable')}
              </p>
              {importable ? (
                <label className={styles.inlineInput}>
                  <span className="visually-hidden">
                    {t('pluginsScreen.addLinkInputAria', { noun: nounLower })}
                  </span>
                  <input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://github.com/…"
                    inputMode="url"
                    disabled={working}
                    data-testid="plugins-add-link-input"
                  />
                  <button
                    type="button"
                    disabled={!url.trim() || working}
                    onClick={() => void importLink()}
                    data-testid="plugins-add-link-submit"
                  >
                    {working ? t('pluginsScreen.addWorking') : t('pluginsScreen.addLinkAction')}
                  </button>
                </label>
              ) : null}
            </div>
          </section>

          <section className={styles.addChoice}>
            <span aria-hidden="true"><i className="fa-solid fa-folder-open" /></span>
            <div>
              <h3>{t('pluginsScreen.addFolderTitle')}</h3>
              <p>
                {importable
                  ? t('pluginsScreen.addFolderBody')
                  : t('pluginsScreen.addSkillImportUnavailable')}
              </p>
              {importable ? (
                <div className={styles.fileRow}>
                  <label>
                    <input
                      type="file"
                      multiple
                      disabled={working}
                      data-testid="plugins-add-folder-input"
                      onChange={(event) => {
                        const picked = Array.from(event.currentTarget.files ?? []);
                        setFiles(picked);
                        setSelectedLabel(picked[0]?.name ?? '');
                      }}
                    />
                    <i className="fa-solid fa-folder-open" aria-hidden="true" />{' '}
                    {selectedLabel || t('pluginsScreen.addFolderChoose')}
                  </label>
                  <button
                    type="button"
                    disabled={files.length === 0 || working}
                    onClick={() => void uploadFiles()}
                    data-testid="plugins-add-folder-submit"
                  >
                    {working
                      ? t('pluginsScreen.addWorking')
                      : t('pluginsScreen.addFolderAction', { noun: nounLower })}
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </section>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
