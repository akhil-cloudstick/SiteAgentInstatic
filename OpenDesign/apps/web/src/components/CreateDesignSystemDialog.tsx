/**
 * CreateDesignSystemDialog — the approved MMSBUILD reference modal
 * (`prototype-reference/src/DesignSystemsScreen.jsx:95-252`), wired to the real
 * creation pipeline.
 *
 * ── Reference fidelity ───────────────────────────────────────────────────
 * Markup, copy, field order, the three-step rail, the two-phase submit
 * (form -> confirmation -> run) and every dismissal path are the reference's.
 * The stylesheet is a straight transcription (`.module.css`).
 *
 * ── Where it deliberately differs, and why ───────────────────────────────
 * The reference's submit fabricates a design system in local state and its
 * "Start from a brand" / local-code-folder controls are `onNotice(...)` stubs.
 * The developer build instructions require the opposite on both counts:
 *   §3 "Follow the current upstream OpenDesign Design Systems list/detail/
 *      create flow and permission gates."
 *   §5 names "links and actions [that] are local prototype notices rather than
 *      production routes or handlers" among the behaviours not to preserve.
 * So this dialog collects exactly the reference's inputs and then hands them to
 * the real pipeline: it stands in for `DesignSystemFlow`'s `setup` + `confirm`
 * steps, seeds that flow, and navigates to `/design-systems/create`, which
 * creates the backing project and conversation, stages the sources and runs
 * extraction. The local code folder uses the real `openFolderDialog()` picker
 * instead of the reference's free-text input, for the same reason.
 *
 * Rendered through a portal to <body>: the page's shell is `overflow: clip` and
 * its detail head sets `backdrop-filter`, either of which can make a
 * `position: fixed` child resolve against an ancestor instead of the viewport.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { DesignSystemsCreateClickProps } from '@open-design/contracts/analytics';
import { useAnalytics } from '../analytics/provider';
import {
  trackDesignSystemsCreateClick,
  trackDesignSystemsPresetBrandPickerClick,
} from '../analytics/events';
import { setPendingDesignSystemCreateEntry } from '../analytics/ds-create-entry';
import { useT } from '../i18n';
import { openFolderDialog } from '../providers/registry';
import { navigate } from '../router';
import { setDesignSystemSetupSeed, type DesignSystemSetupSeed } from '../state/libraryHandoff';
import { BrandPickerModal } from './BrandPickerModal';
import styles from './CreateDesignSystemDialog.module.css';

interface Props {
  onClose: () => void;
  /** Surfaces a transient message on the page's toast. */
  onNotice: (message: string) => void;
}

/** Accepts a Figma file/design/board URL, tolerating a missing protocol. */
const FIGMA_FILE_URL_RE = /^https:\/\/(?:www\.)?figma\.com\/(?:file|design|board)\/[A-Za-z0-9]+/i;

function normalizeFigmaUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return FIGMA_FILE_URL_RE.test(withProtocol) ? withProtocol : '';
}

export function CreateDesignSystemDialog({ onClose, onNotice }: Props) {
  const t = useT();
  const analytics = useAnalytics();

  // The setup form moved here from `DesignSystemFlow`, so its `ui_click` rows
  // move with it — otherwise the create funnel would lose every step between
  // "opened the dialog" and `design_system_create_result`.
  const emitCreateFormClick = (element: DesignSystemsCreateClickProps['element']) => {
    trackDesignSystemsCreateClick(analytics.track, {
      page_name: 'design_systems',
      area: 'design_system_create',
      element,
    });
  };

  const [sourceDraft, setSourceDraft] = useState('');
  const [sourceUrls, setSourceUrls] = useState<string[]>([]);
  const [company, setCompany] = useState('');
  const [designMd, setDesignMd] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [assetFiles, setAssetFiles] = useState<File[]>([]);
  const [codeFolder, setCodeFolder] = useState('');
  const [figFile, setFigFile] = useState<File | null>(null);
  const [figmaUrl, setFigmaUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);

  const firstField = useRef<HTMLInputElement | null>(null);
  const figInputRef = useRef<HTMLInputElement | null>(null);

  // Reference `:108-117` — any one source is enough to continue.
  const hasSource = Boolean(
    sourceUrls.length ||
      designMd.trim() ||
      company.trim() ||
      assetFiles.length ||
      codeFolder.trim() ||
      figFile ||
      figmaUrl.trim() ||
      notes.trim(),
  );

  // Reference `:119-124` — focus the first field, close on Escape.
  useEffect(() => {
    firstField.current?.focus();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const addSource = () => {
    const value = sourceDraft.trim();
    if (!value) return;
    emitCreateFormClick('source_url_add');
    setSourceUrls((current) => (current.includes(value) ? current : [...current, value]));
    setSourceDraft('');
  };

  const onSourceKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addSource();
  };

  /**
   * "Start from a brand" is an `onNotice(...)` stub on the reference. It is a
   * real capability here — the same verified reference-brand picker the create
   * route used — so it opens that picker and adds the brand's site as a style
   * reference, exactly as `DesignSystemFlow.handlePickBrandReference` did.
   */
  const addBrandSource = (domain: string) => {
    const value = `https://${domain}`;
    setError(null);
    setBrandPickerOpen(false);
    emitCreateFormClick('source_url_add');
    setSourceUrls((current) => (current.includes(value) ? current : [...current, value]));
  };

  async function pickCodeFolder() {
    emitCreateFormClick('browse_folder');
    try {
      const picked = await openFolderDialog();
      if (picked) setCodeFolder(picked);
    } catch {
      setError(t('ds.actionFailed'));
    }
  }

  /**
   * Build the seed the real flow consumes. Field-for-field the reference's own
   * inputs; the shapes are `SetupState`'s, so the flow hydrates without
   * translation. GitHub links need no separate field — the flow splits repo
   * URLs out of `sourceUrls` itself, which is exactly what the reference's
   * combined "Website or GitHub repository" input implies.
   */
  function buildSeed(): DesignSystemSetupSeed {
    const normalizedFigma = normalizeFigmaUrl(figmaUrl);
    return {
      company: company.trim(),
      designMd,
      sourceUrls,
      figmaUrls: normalizedFigma ? [normalizedFigma] : [],
      codeFolders: codeFolder.trim() ? [codeFolder.trim()] : [],
      figFiles: figFile ? [figFile.name] : [],
      figFileObjects: figFile ? [figFile] : [],
      assetFiles: assetFiles.map((file) => file.name),
      assetFileObjects: assetFiles,
      notes: notes.trim(),
    };
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!hasSource) return;
    // Reference `:136-139` — the first press advances to the confirmation.
    if (!confirming) {
      emitCreateFormClick('continue_to_generation');
      setError(null);
      setConfirming(true);
      return;
    }
    if (figmaUrl.trim() && !normalizeFigmaUrl(figmaUrl)) {
      setError(t('dsCreate.figmaInvalid'));
      setConfirming(false);
      return;
    }
    setDesignSystemSetupSeed(buildSeed());
    // The create route carries no params, so the entry source is handed over
    // out-of-band the same way every other `design-system-create` navigation
    // does it. Without this the flow falls back to its onboarding/unknown
    // heuristic and the funnel loses which surface started the run.
    setPendingDesignSystemCreateEntry('design_systems_page');
    onNotice(t('ds.creatingProjectTitle'));
    onClose();
    navigate({ kind: 'design-system-create' });
  }

  const factChips = useMemo(
    () => [
      t('dsCreate.confirmLinks', { n: sourceUrls.length }),
      t('dsCreate.confirmFiles', { n: assetFiles.length }),
      designMd.trim() ? t('dsCreate.confirmDesignMdAdded') : t('dsCreate.confirmNoDesignMd'),
    ],
    [sourceUrls.length, assetFiles.length, designMd, t],
  );

  const steps = [
    { n: 1, title: t('dsCreate.step1Title'), desc: t('dsCreate.step1Desc') },
    { n: 2, title: t('dsCreate.step2Title'), desc: t('dsCreate.step2Desc') },
    { n: 3, title: t('dsCreate.step3Title'), desc: t('dsCreate.step3Desc') },
  ];

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      data-testid="design-system-create-dialog"
      onMouseDown={(event) => {
        // Reference `:160` — only a press that starts on the backdrop itself
        // closes, so a drag that ends outside the dialog does not dismiss it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-create-title"
        onSubmit={submit}
      >
        <header className={styles.head}>
          <div>
            <span className={styles.kicker}>
              <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
              {t('dsCreate.designMdPreviewKicker')}
            </span>
            <h2 id="ds-create-title">{t('dsCreate.dialogTitle')}</h2>
            <p className={styles.headSub}>{t('dsCreate.dialogSubtitle')}</p>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        {confirming ? (
          <div className={styles.confirmation}>
            <span className={styles.confirmationMark} aria-hidden>
              <i className="fa-solid fa-wand-magic-sparkles" />
            </span>
            <p className={styles.kicker}>{t('dsCreate.confirmKicker')}</p>
            <h3>{t('dsCreate.confirmTitle')}</h3>
            <p className={styles.confirmationBody}>{t('dsCreate.confirmBody')}</p>
            <div className={styles.confirmationFacts}>
              {factChips.map((chip) => (
                <span key={chip}>{chip}</span>
              ))}
            </div>
            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <div className={styles.layout}>
            <ol className={styles.steps} aria-label={t('dsCreate.stepsAria')}>
              {steps.map((step) => (
                <li
                  key={step.n}
                  className={`${styles.step} ${step.n === 1 ? styles.stepActive : ''}`}
                >
                  <span className={styles.stepNumber}>{step.n}</span>
                  <div className={styles.stepCopy}>
                    <strong>{step.title}</strong>
                    <small>{step.desc}</small>
                  </div>
                </li>
              ))}
            </ol>

            <div className={styles.form}>
              <section className={styles.section}>
                <div className={styles.fieldHeading}>
                  <strong>{t('dsCreate.githubWebsiteLabel')}</strong>
                  <span>{t('dsCreate.sourceRequiredHint')}</span>
                </div>
                <div className={styles.inlineField}>
                  <i className="fa-solid fa-link" aria-hidden="true" />
                  <input
                    ref={firstField}
                    value={sourceDraft}
                    onChange={(event) => setSourceDraft(event.target.value)}
                    onKeyDown={onSourceKeyDown}
                    placeholder="https://example.com or https://github.com/org/repo"
                    aria-label={t('dsCreate.githubWebsiteLabel')}
                    data-testid="ds-create-source-input"
                  />
                  <button type="button" onClick={addSource} disabled={!sourceDraft.trim()}>
                    {t('dsCreate.add')}
                  </button>
                </div>
                <button
                  type="button"
                  className={styles.textAction}
                  onClick={() => {
                    emitCreateFormClick('start_from_brand');
                    setBrandPickerOpen(true);
                  }}
                >
                  <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
                  {t('dsCreate.startFromBrand')}
                </button>
                {sourceUrls.length ? (
                  <div className={styles.chipRow} aria-label={t('dsCreate.addedSourceLinks')}>
                    {sourceUrls.map((url) => (
                      <span key={url} className={styles.chip}>
                        <i className="fa-solid fa-globe" aria-hidden="true" />
                        <span className={styles.chipLabel}>{url}</span>
                        <button
                          type="button"
                          aria-label={t('dsCreate.removeSourceLabel', { label: url })}
                          onClick={() =>
                            setSourceUrls((items) => items.filter((item) => item !== url))
                          }
                        >
                          <i className="fa-solid fa-xmark" aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className={styles.section}>
                <div className={styles.fieldHeading}>
                  <strong>{t('dsCreate.addFiles')}</strong>
                  <span>{t('dsCreate.addFilesHint')}</span>
                </div>
                <label className={styles.uploadZone}>
                  <i className="fa-solid fa-upload" aria-hidden="true" />
                  <span>
                    <strong>{t('dsCreate.chooseFiles')}</strong>
                    <small>{t('dsCreate.dropHint')}</small>
                  </span>
                  <input
                    type="file"
                    multiple
                    onChange={(event) => {
                      const picked = Array.from(event.target.files ?? []);
                      if (picked.length) emitCreateFormClick('add_assets');
                      setAssetFiles(picked);
                    }}
                  />
                </label>
                {assetFiles.length ? (
                  <p className={styles.fieldNote}>
                    {t(
                      assetFiles.length === 1
                        ? 'dsCreate.filesStagedOne'
                        : 'dsCreate.filesStagedOther',
                      {
                        n: assetFiles.length,
                        names: assetFiles
                          .slice(0, 2)
                          .map((file) => file.name)
                          .join(', '),
                      },
                    )}
                  </p>
                ) : null}
              </section>

              <label className={styles.field}>
                <span>
                  {t('dsCreate.describeBrand')} <em>{t('dsCreate.optional')}</em>
                </span>
                <textarea
                  rows={3}
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                  placeholder={t('dsCreate.describeBrandPlaceholder')}
                />
              </label>

              <label className={styles.field}>
                <span>
                  {t('dsCreate.pasteDesignMd')} <em>{t('dsCreate.optional')}</em>
                </span>
                <textarea
                  rows={4}
                  value={designMd}
                  onChange={(event) => setDesignMd(event.target.value)}
                  placeholder={'---\nname: Heritage\ncolors:\n  primary: "#1A1C1E"\n---\n\n## Overview'}
                />
              </label>

              <button
                type="button"
                className={styles.advancedToggle}
                aria-expanded={advanced}
                onClick={() => setAdvanced((open) => !open)}
              >
                <i className="fa-solid fa-chevron-down" aria-hidden="true" />
                {t('dsCreate.advancedSources')}
              </button>

              {advanced ? (
                <div className={styles.advancedFields}>
                  <div className={styles.field}>
                    <span>{t('dsCreate.localCodeLabel')}</span>
                    <div className={styles.folderRow}>
                      <button type="button" className={styles.folderButton} onClick={pickCodeFolder}>
                        {t('dsCreate.chooseFolder')}
                      </button>
                      <span className={styles.folderValue} title={codeFolder}>
                        {codeFolder || t('dsCreate.localCodePrompt')}
                      </span>
                    </div>
                  </div>

                  <div className={styles.field}>
                    <span>{t('dsCreate.uploadFigLabel')}</span>
                    <div className={styles.fileRow}>
                      <button
                        type="button"
                        className={styles.fileButton}
                        onClick={() => figInputRef.current?.click()}
                      >
                        {t('dsCreate.chooseFiles')}
                      </button>
                      <span className={styles.folderValue} title={figFile?.name}>
                        {figFile?.name || t('dsCreate.uploadFigPrompt')}
                      </span>
                      <input
                        ref={figInputRef}
                        type="file"
                        accept=".fig"
                        onChange={(event) => {
                          const picked = event.target.files?.[0] ?? null;
                          if (picked) emitCreateFormClick('upload_fig');
                          setFigFile(picked);
                        }}
                      />
                    </div>
                  </div>

                  <label className={styles.field}>
                    <span>{t('dsCreate.figmaUrl')}</span>
                    <input
                      value={figmaUrl}
                      onChange={(event) => setFigmaUrl(event.target.value)}
                      placeholder={t('dsCreate.figmaPlaceholder')}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>{t('dsCreate.notes')}</span>
                    <textarea
                      rows={3}
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder={t('dsCreate.notesPlaceholder')}
                    />
                  </label>
                </div>
              ) : null}

              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        )}

        <footer className={styles.foot}>
          <span className={styles.footNote}>
            <i className="fa-solid fa-file-code" aria-hidden="true" />
            {t('dsCreate.outputs')}
          </span>
          <div className={styles.footActions}>
            <button
              type="button"
              onClick={() => {
                if (!confirming) {
                  onClose();
                  return;
                }
                emitCreateFormClick('back');
                setConfirming(false);
              }}
            >
              {confirming ? t('dsCreate.back') : t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={!hasSource}
              data-testid="ds-create-submit"
            >
              {confirming ? t('dsCreate.extract') : t('dsCreate.continueToGeneration')}
            </button>
          </div>
        </footer>
      </form>

      <BrandPickerModal
        open={brandPickerOpen}
        onClose={() => setBrandPickerOpen(false)}
        onPick={(brand) => {
          trackDesignSystemsPresetBrandPickerClick(analytics.track, {
            page_name: 'design_systems',
            area: 'preset_brand_picker',
            element: 'brand_pick',
            preset_brand_category: brand.category,
          });
          addBrandSource(brand.domain);
        }}
        title={t('dsCreate.startFromBrand')}
        subtitle={t('dsCreate.brandPickerSubtitle')}
        actionLabel={t('dsCreate.add')}
        quickPicksLabel={t('dsCreate.brandPickerQuickPicks')}
      />
    </div>,
    document.body,
  );
}
