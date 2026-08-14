/**
 * Add MCP server — the approved MMSBUILD reference dialog
 * (`prototype-reference/src/IntegrationsScreen.jsx:98-171`, `AddMcpDialog`).
 *
 * Reference behaviour reproduced exactly: `.resource-modal-backdrop` closes on
 * a mousedown that starts on the backdrop itself, Escape closes, the first
 * control is focused on open, a Template/Custom segmented control switches the
 * body, and the Custom transport select flips the third field between
 * `Command` (stdio) and `Server URL` (HTTP).
 *
 * ── Where this deviates, and why ──────────────────────────────────────────
 * The reference offers four hardcoded templates in one flat grid. This app has
 * a real catalogue of 30+ templates across the eight `CATEGORY_ORDER` groups,
 * and the build kit requires the native one
 * (`OPEN-DESIGN-DEVELOPER-BUILD-INSTRUCTIONS.md` §3, "Use upstream-native
 * catalogs and connection surfaces"). So the reference's modal shell, segmented
 * control, card geometry, footer and dismissal behaviour are reproduced
 * verbatim, and the grid is fed by the real catalogue, grouped, with a filter
 * field above it. Each card keeps the reference's exact
 * `.mcp-template-grid button` box.
 *
 * The reference footer reads "No server will be contacted from this
 * prototype." That is one of the prototype notices §5 lists among behaviours
 * a developer "must not preserve", so the real wording is used instead.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { VisuallyHidden } from '@open-design/components';
import type { McpTemplate } from '../../state/mcp';
import { CATEGORY_ORDER, templateMatchesQuery } from '../McpClientSection';
import { useT } from '../../i18n';
import styles from '../IntegrationsScreen.module.css';

type Mode = 'template' | 'custom';

export interface AddMcpServerDialogProps {
  templates: McpTemplate[];
  onClose: () => void;
  onPickTemplate: (tpl: McpTemplate) => void;
  onPickBlank: () => void;
}

/** Reference glyphs for the four templates it ships, generalised to the real
 *  catalogue by transport/category. `IntegrationsScreen.jsx:148` maps
 *  Filesystem -> folder-open, GitHub -> code-branch, everything hosted ->
 *  cloud-arrow-down. */
function templateIcon(tpl: McpTemplate): string {
  const id = tpl.id.toLowerCase();
  if (id.includes('filesystem') || id.includes('file')) return 'fa-folder-open';
  if (id.includes('github') || id.includes('git')) return 'fa-code-branch';
  if (tpl.transport === 'stdio') return 'fa-terminal';
  return 'fa-cloud-arrow-down';
}

export function AddMcpServerDialog({
  templates,
  onClose,
  onPickTemplate,
  onPickBlank,
}: AddMcpServerDialogProps) {
  const t = useT();
  const [mode, setMode] = useState<Mode>('template');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const firstField = useRef<HTMLButtonElement | null>(null);

  // IntegrationsScreen.jsx:106-111 — focus the first control, close on Escape.
  useEffect(() => {
    firstField.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const trimmed = query.trim();

  const groups = useMemo(() => {
    const buckets = new Map<string, McpTemplate[]>();
    for (const tpl of templates) {
      const key = tpl.category ?? 'utilities';
      const list = buckets.get(key) ?? [];
      list.push(tpl);
      buckets.set(key, list);
    }
    return CATEGORY_ORDER.map((cat) => ({
      ...cat,
      items: (buckets.get(cat.id) ?? []).filter((tpl) =>
        templateMatchesQuery(tpl, trimmed),
      ),
    })).filter((group) => group.items.length > 0);
  }, [templates, trimmed]);

  const selected = useMemo(
    () => templates.find((tpl) => tpl.id === selectedId) ?? null,
    [selectedId, templates],
  );

  const canSubmit = mode === 'template' ? Boolean(selected) : true;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'template') {
      if (!selected) return;
      onPickTemplate(selected);
      return;
    }
    onPickBlank();
  };

  return (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-mcp-title"
        onSubmit={submit}
        data-testid="integrations-add-mcp-dialog"
      >
        <header className={styles.modalHead}>
          <div>
            <h2 id="add-mcp-title">{t('integrations.addServerTitle')}</h2>
            <p>{t('integrations.addServerSubtitle')}</p>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label={t('integrations.addServerClose')}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div className={styles.segmented} aria-label={t('integrations.addServerSource')}>
          <button
            ref={firstField}
            type="button"
            aria-pressed={mode === 'template'}
            onClick={() => setMode('template')}
          >
            {t('integrations.addServerTemplate')}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'custom'}
            onClick={() => setMode('custom')}
          >
            {t('integrations.addServerCustom')}
          </button>
        </div>

        <div className={styles.formBody}>
          {mode === 'template' ? (
            <fieldset>
              <legend>{t('integrations.addServerChooseTemplate')}</legend>
              <label className={`${styles.search} ${styles.templateSearch}`}>
                <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                <VisuallyHidden>{t('integrations.addServerFilter')}</VisuallyHidden>
                <input
                  type="search"
                  value={query}
                  spellCheck={false}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('integrations.addServerFilter')}
                />
              </label>

              {groups.length === 0 ? (
                <p className={styles.snippetLabel}>
                  {t('integrations.addServerNoMatch')}
                </p>
              ) : (
                groups.map((group) => (
                  <div key={group.id} className={styles.templateGroup}>
                    <p className={styles.snippetLabel}>{group.label}</p>
                    <div className={styles.templateGrid}>
                      {group.items.map((tpl) => {
                        const active = tpl.id === selectedId;
                        return (
                          <button
                            key={tpl.id}
                            type="button"
                            className={styles.templateCard}
                            aria-pressed={active}
                            title={tpl.description}
                            onClick={() => setSelectedId(tpl.id)}
                          >
                            <i
                              className={`fa-solid ${templateIcon(tpl)}`}
                              aria-hidden="true"
                            />
                            <span className={styles.templateCardCopy}>
                              <strong>{tpl.label}</strong>
                              <small>{tpl.transport}</small>
                            </span>
                            {active ? (
                              <i className="fa-solid fa-check" aria-hidden="true" />
                            ) : (
                              <span aria-hidden="true" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </fieldset>
          ) : (
            <div className={styles.fieldStack}>
              <label>
                {t('integrations.addServerName')}
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('integrations.addServerNamePlaceholder')}
                />
              </label>
              <label>
                {t('integrations.addServerTransport')}
                <select
                  value={transport}
                  onChange={(event) =>
                    setTransport(event.target.value === 'http' ? 'http' : 'stdio')
                  }
                >
                  <option value="stdio">stdio</option>
                  <option value="http">HTTP</option>
                </select>
              </label>
              <label>
                {transport === 'stdio'
                  ? t('integrations.addServerCommand')
                  : t('integrations.addServerUrl')}
                <input
                  placeholder={transport === 'stdio' ? 'command --arg' : 'https://…'}
                  readOnly
                  disabled
                />
              </label>
              <p className={styles.snippetLabel}>
                {t('integrations.addServerCustomHint')}
              </p>
            </div>
          )}
        </div>

        <footer className={styles.modalFooter}>
          <span className={styles.modalFooterNote}>
            <i className="fa-solid fa-shield-halved" aria-hidden="true" />
            {t('integrations.addServerFooterNote')}
          </span>
          <div className={styles.modalFooterActions}>
            <button type="button" className={styles.modalCancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={!canSubmit}
              data-testid="integrations-add-mcp-submit"
            >
              <i className="fa-solid fa-plus" aria-hidden="true" />
              {t('mcpClient.addServer')}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
