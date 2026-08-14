/**
 * Use-everywhere panel — the approved MMSBUILD reference panel
 * (`prototype-reference/src/IntegrationsScreen.jsx:289-327`,
 * `UseEverywherePanel`).
 *
 * The reference layout is `.everywhere-layout`: a 190px left `<nav>` of
 * surfaces and an article carrying an icon tile, heading, intro, bullet list,
 * a `.code-snippet-row` with a Copy button that flips to a check for 1200ms,
 * and a footer. This replaces the horizontal tab strip the upstream panel used.
 *
 * The CONTENT is the app's, not the prototype's: real `GUIDE_SECTIONS`, real
 * `/api/mcp/install-info` substitution, real multi-snippet sections and the
 * real "Copy guide for an agent" payload. The reference ships one hardcoded
 * snippet per surface, which the build kit's §5 names among the prototype
 * behaviours that "must not be preserved".
 *
 * Product naming: the reference's copy says "OpenDesign". The i18n strings
 * used here say "MMS Design", which is the approved product name in this
 * build — the only place the reference's text is deliberately overridden.
 *
 * Test contract kept intact: `use-everywhere-tab-<id>`,
 * `use-everywhere-section-<id>`, `use-everywhere-copy-guide` and
 * `use-everywhere-open-settings` (`e2e/ui/entry-chrome-flows.test.ts:776-830`).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAnalytics } from '../../analytics/provider';
import { trackIntegrationsUseEverywhereTabClick } from '../../analytics/events';
import { useT } from '../../i18n';
import type { Dict } from '../../i18n/types';
import {
  agentGuideSnippetUsesMcpInstallInfo,
  buildAgentGuideMarkdown,
  renderAgentGuideSnippetBody,
  type AgentGuideMcpInstallInfo,
  type AgentGuideOptions,
} from '../use-everywhere/agent-guide';
import {
  GUIDE_SECTIONS,
  type CodeSnippet,
  type GuideSection,
} from '../use-everywhere/sections';
import styles from '../IntegrationsScreen.module.css';

type CopyState = 'idle' | 'copied' | 'failed';

/** IntegrationsScreen.jsx:298 — the reference resets the copied state after
 *  1200ms. Upstream used 1600ms; the reference wins. */
const COPY_RESET_MS = 1200;

/** IntegrationsScreen.jsx:317 — the per-surface article glyph. */
const SECTION_ICON: Record<GuideSection['id'], string> = {
  overview: 'fa-link',
  cli: 'fa-terminal',
  mcp: 'fa-server',
  http: 'fa-database',
  skills: 'fa-puzzle-piece',
};

function sectionToElement(
  id: GuideSection['id'],
): 'overview' | 'cli_od' | 'mcp_server' | 'http_api' | 'skills_headless' {
  switch (id) {
    case 'overview': return 'overview';
    case 'cli': return 'cli_od';
    case 'mcp': return 'mcp_server';
    case 'http': return 'http_api';
    case 'skills': return 'skills_headless';
  }
}

export interface UseEverywherePanelProps {
  /** Deep-link back to the MCP tab, from the footer's Configure action. */
  onOpenMcp?: () => void;
  /** Live daemon URL when known (e.g. http://127.0.0.1:7456). */
  daemonUrl?: string;
  /** Optional MMS Design version string surfaced in the agent guide header. */
  versionHint?: string;
}

export function UseEverywherePanel({
  onOpenMcp,
  daemonUrl,
  versionHint,
}: UseEverywherePanelProps) {
  const t = useT();
  const analytics = useAnalytics();
  const [activeId, setActiveId] = useState<GuideSection['id']>('overview');
  const [guideCopy, setGuideCopy] = useState<CopyState>('idle');
  const [snippetCopy, setSnippetCopy] = useState<{ key: string; state: CopyState } | null>(null);
  const [mcpInstallInfo, setMcpInstallInfo] = useState<AgentGuideMcpInstallInfo | null>(null);
  const mcpInstallInfoRequestRef = useRef<Promise<AgentGuideMcpInstallInfo | null> | null>(null);
  const guideSections = useMemo(() => localizeGuideSections(t), [t]);

  function loadMcpInstallInfo(): Promise<AgentGuideMcpInstallInfo | null> {
    if (!mcpInstallInfoRequestRef.current) {
      mcpInstallInfoRequestRef.current = fetch('/api/mcp/install-info')
        .then(async (res) => {
          if (!res.ok) throw new Error(`daemon ${res.status}`);
          const data = (await res.json()) as unknown;
          if (isAgentGuideMcpInstallInfo(data)) return data;
          return null;
        })
        .catch(() => null);
    }
    return mcpInstallInfoRequestRef.current;
  }

  useEffect(() => {
    let cancelled = false;
    loadMcpInstallInfo().then((data) => {
      if (cancelled) return;
      setMcpInstallInfo(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const guideOptions: AgentGuideOptions = useMemo(() => {
    const opts: AgentGuideOptions = {};
    if (daemonUrl) opts.daemonUrl = daemonUrl;
    if (versionHint) opts.versionHint = versionHint;
    if (mcpInstallInfo) opts.mcpInstallInfo = mcpInstallInfo;
    return opts;
  }, [daemonUrl, mcpInstallInfo, versionHint]);

  const fullGuide = useMemo(() => buildAgentGuideMarkdown(guideOptions), [guideOptions]);

  const activeSection = useMemo<GuideSection>(() => {
    const found = guideSections.find((s) => s.id === activeId);
    if (found) return found;
    const first = guideSections[0];
    if (!first) throw new Error('GUIDE_SECTIONS must define at least one section');
    return first;
  }, [activeId, guideSections]);

  async function onCopyGuide() {
    const installInfo = mcpInstallInfo ?? (await loadMcpInstallInfo());
    if (installInfo && installInfo !== mcpInstallInfo) setMcpInstallInfo(installInfo);
    const guide = installInfo
      ? buildAgentGuideMarkdown({ ...guideOptions, mcpInstallInfo: installInfo })
      : fullGuide;
    const state = await copyText(guide);
    setGuideCopy(state);
    if (state !== 'idle') {
      window.setTimeout(() => setGuideCopy('idle'), COPY_RESET_MS);
    }
  }

  async function onCopySnippet(key: string, snippet: CodeSnippet) {
    trackIntegrationsUseEverywhereTabClick(analytics.track, {
      page_name: 'integrations',
      area: 'use_everywhere_tab',
      element: 'copy',
    });
    let installInfo = mcpInstallInfo;
    if (agentGuideSnippetUsesMcpInstallInfo(snippet) && !installInfo) {
      installInfo = await loadMcpInstallInfo();
      if (installInfo && installInfo !== mcpInstallInfo) setMcpInstallInfo(installInfo);
    }
    const text = renderAgentGuideSnippetBody(snippet, { daemonUrl, mcpInstallInfo: installInfo });
    const state = await copyText(text);
    setSnippetCopy({ key, state });
    if (state !== 'idle') {
      window.setTimeout(() => setSnippetCopy(null), COPY_RESET_MS);
    }
  }

  return (
    <section
      className={styles.panel}
      aria-labelledby="everywhere-panel-title"
      data-testid="integrations-panel-use-everywhere"
    >
      <header className={styles.panelHead}>
        <div>
          <h2 id="everywhere-panel-title">{t('useEverywhere.modalTitle')}</h2>
          <p>{t('integrations.everywhereSubtitle')}</p>
        </div>
        <span className={`${styles.status} ${styles.statusWarning}`}>
          {t('integrations.daemonRequired')}
        </span>
      </header>

      <div className={styles.everywhere}>
        <nav
          className={styles.everywhereNav}
          role="tablist"
          aria-label={t('useEverywhere.tabsAria')}
        >
          {guideSections.map((section) => {
            const active = section.id === activeId;
            return (
              <button
                key={section.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  trackIntegrationsUseEverywhereTabClick(analytics.track, {
                    page_name: 'integrations',
                    area: 'use_everywhere_tab',
                    element: sectionToElement(section.id),
                  });
                  setActiveId(section.id);
                }}
                data-testid={`use-everywhere-tab-${section.id}`}
              >
                {section.tabLabel}
                <i className="fa-solid fa-chevron-right" aria-hidden="true" />
              </button>
            );
          })}
        </nav>

        <article
          className={styles.everywhereArticle}
          role="tabpanel"
          data-testid={`use-everywhere-section-${activeSection.id}`}
        >
          <span className={styles.everywhereIcon}>
            <i className={`fa-solid ${SECTION_ICON[activeSection.id]}`} aria-hidden="true" />
          </span>
          <h3>{applyDaemonUrl(activeSection.heading, daemonUrl)}</h3>
          <p>{applyDaemonUrl(activeSection.intro, daemonUrl)}</p>

          {activeSection.bullets.length > 0 ? (
            <ul>
              {activeSection.bullets.map((bullet) => (
                <li key={bullet}>{applyDaemonUrl(bullet, daemonUrl)}</li>
              ))}
            </ul>
          ) : null}

          <div className={styles.snippets}>
            {activeSection.snippets.map((snippet, idx) => {
              const key = `${activeSection.id}-${idx}`;
              const isThis = snippetCopy?.key === key;
              const state: CopyState = isThis ? snippetCopy.state : 'idle';
              return (
                <div key={key}>
                  <p className={styles.snippetLabel}>{snippet.label}</p>
                  <div className={styles.snippetRow}>
                    <code>
                      {renderAgentGuideSnippetBody(snippet, { daemonUrl, mcpInstallInfo })}
                    </code>
                    <button
                      type="button"
                      className={styles.snippetCopy}
                      onClick={() => onCopySnippet(key, snippet)}
                      aria-label={t('useEverywhere.copySnippetAria', { label: snippet.label })}
                    >
                      <i
                        className={`fa-solid ${state === 'copied' ? 'fa-check' : 'fa-copy'}`}
                        aria-hidden="true"
                      />
                      {copyLabel(state, t('useEverywhere.copy'), t)}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {activeSection.footer ? (
            <p className={styles.everywhereFooter}>
              {applyDaemonUrl(activeSection.footer, daemonUrl)}
            </p>
          ) : null}

          <p className={styles.everywhereFooter}>
            <strong>{t('useEverywhere.footStrong')}</strong> {t('useEverywhere.footBody')}
          </p>

          <div className={styles.everywhereActions}>
            {onOpenMcp ? (
              <button
                type="button"
                className={styles.snippetCopy}
                onClick={() => {
                  trackIntegrationsUseEverywhereTabClick(analytics.track, {
                    page_name: 'integrations',
                    area: 'use_everywhere_tab',
                    element: 'configure_mcp_server',
                  });
                  onOpenMcp();
                }}
                data-testid="use-everywhere-open-settings"
              >
                <i className="fa-solid fa-server" aria-hidden="true" />
                {t('useEverywhere.configureMcp')}
              </button>
            ) : null}
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                trackIntegrationsUseEverywhereTabClick(analytics.track, {
                  page_name: 'integrations',
                  area: 'use_everywhere_tab',
                  element: 'copy_guide_for_agent',
                });
                void onCopyGuide();
              }}
              data-testid="use-everywhere-copy-guide"
            >
              <i
                className={`fa-solid ${guideCopy === 'copied' ? 'fa-check' : 'fa-copy'}`}
                aria-hidden="true"
              />
              {copyLabel(guideCopy, t('useEverywhere.copyGuide'), t)}
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}

function isAgentGuideMcpInstallInfo(data: unknown): data is AgentGuideMcpInstallInfo {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as Partial<AgentGuideMcpInstallInfo>;
  return (
    typeof candidate.command === 'string' &&
    Array.isArray(candidate.args) &&
    candidate.args.every((arg) => typeof arg === 'string')
  );
}

async function copyText(text: string): Promise<CopyState> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return 'failed';
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

function copyLabel(state: CopyState, idle: string, t: (key: keyof Dict) => string): string {
  if (state === 'copied') return t('useEverywhere.copied');
  if (state === 'failed') return t('useEverywhere.copyFailed');
  return idle;
}

function localizeGuideSections(t: (key: keyof Dict) => string): GuideSection[] {
  return GUIDE_SECTIONS.map((section) => ({
    ...section,
    tabLabel: t(`useEverywhere.section.${section.id}.tab` as keyof Dict),
    heading: t(`useEverywhere.section.${section.id}.heading` as keyof Dict),
    intro: t(`useEverywhere.section.${section.id}.intro` as keyof Dict),
    bullets: section.bullets.map((_, idx) =>
      t(`useEverywhere.section.${section.id}.bullet${idx + 1}` as keyof Dict),
    ),
    snippets: section.snippets.map((snippet, idx) => ({
      ...snippet,
      label: t(`useEverywhere.section.${section.id}.snippet${idx + 1}` as keyof Dict),
    })),
    footer: section.footer
      ? t(`useEverywhere.section.${section.id}.footer` as keyof Dict)
      : undefined,
  }));
}

function applyDaemonUrl(body: string, daemonUrl: string | undefined): string {
  if (!daemonUrl) return body;
  const cleaned = daemonUrl.replace(/\/$/, '');
  return body.replace(/http:\/\/127\.0\.0\.1:7456/g, cleaned);
}
