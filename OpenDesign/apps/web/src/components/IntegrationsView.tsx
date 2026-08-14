/**
 * IntegrationsView — `/integrations`, rebuilt as the approved MMSBUILD
 * reference screen (`prototype-reference/src/IntegrationsScreen.jsx`).
 *
 * The reference lays out three blocks: a page head (kicker, title, lede,
 * Agent-ready badge), a four-up tab strip that is ATTACHED to the panel below
 * it, and a bordered panel frame holding one of four panels. All geometry
 * lives in `IntegrationsScreen.module.css`, transcribed from
 * `resource-screens.css` with source line ranges per block.
 *
 * ── What changed from upstream ────────────────────────────────────────────
 * Every panel body is still the app's own: real MCP servers, the real Composio
 * connector catalogue, the real skills registry and the real agent guide. Only
 * the chrome around them is new. The reference's own panels are prototype
 * fixtures, which `OPEN-DESIGN-DEVELOPER-BUILD-INSTRUCTIONS.md` §5 names among
 * the behaviours a developer "must not preserve"; §3 requires the
 * upstream-native catalogs instead.
 *
 * Icons are Font Awesome Free Solid 6.7.2 — the reference's single icon family
 * (`design-qa.md:48`), already vendored at
 * `packages/mms-shell/src/styles/fontawesome/`. No `components/Icon.tsx` glyph
 * appears on this screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AppConfig } from '../types';
import { useAnalytics } from '../analytics/provider';
import {
  trackIntegrationsConnectorsTabClick,
  trackIntegrationsMcpTabClick,
  trackIntegrationsTabClick,
  trackPageView,
  trackSettingsConnectorAuthResult,
} from '../analytics/events';
import { useT } from '../i18n';
import { ConnectorsPanel } from './integrations/ConnectorsPanel';
import { McpPanel } from './integrations/McpPanel';
import { SkillsPanel } from './integrations/SkillsPanel';
import { UseEverywherePanel } from './integrations/UseEverywherePanel';
import styles from './IntegrationsScreen.module.css';

export type IntegrationTab = 'mcp' | 'connectors' | 'skills' | 'use-everywhere';

interface Props {
  config: AppConfig;
  initialTab?: IntegrationTab;
  composioConfigLoading?: boolean;
  onConfigPersist: (config: AppConfig) => Promise<void> | void;
  onPersistComposioKey: (composio: AppConfig['composio']) => Promise<void> | void;
  onSkillsRefresh?: () => Promise<void> | void;
  onSkillsChanged?: (affectedSkillId?: string) => void;
}

/** IntegrationsScreen.jsx:27-32 — id, label, hint and the tab's FA glyph. */
const INTEGRATION_TABS: ReadonlyArray<{ id: IntegrationTab; icon: string }> = [
  { id: 'mcp', icon: 'fa-server' },
  { id: 'connectors', icon: 'fa-link' },
  { id: 'skills', icon: 'fa-puzzle-piece' },
  { id: 'use-everywhere', icon: 'fa-code' },
];

function integrationTabToTrackingElement(
  id: IntegrationTab,
): 'mcp' | 'connectors' | 'skills' | 'use_everywhere' {
  if (id === 'use-everywhere') return 'use_everywhere';
  return id;
}

export function IntegrationsView({
  config,
  initialTab = 'mcp',
  composioConfigLoading = false,
  onConfigPersist,
  onPersistComposioKey,
  onSkillsRefresh,
  onSkillsChanged,
}: Props) {
  const t = useT();
  const analytics = useAnalytics();
  const integrationsPageViewFiredRef = useRef(false);
  useEffect(() => {
    if (integrationsPageViewFiredRef.current) return;
    integrationsPageViewFiredRef.current = true;
    trackPageView(analytics.track, { page_name: 'integrations' });
  }, [analytics.track]);

  const [activeTab, setActiveTab] = useState<IntegrationTab>(initialTab);
  const [localConfig, setLocalConfig] = useState<AppConfig>(config);
  const localConfigRef = useRef(localConfig);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    localConfigRef.current = config;
    setLocalConfig(config);
  }, [config]);

  const updateLocalConfig = useCallback<Dispatch<SetStateAction<AppConfig>>>(
    (nextConfig) => {
      const base = localConfigRef.current;
      const resolved =
        typeof nextConfig === 'function'
          ? (nextConfig as (current: AppConfig) => AppConfig)(base)
          : nextConfig;
      localConfigRef.current = resolved;
      setLocalConfig(resolved);
      void onConfigPersist(resolved);
    },
    [onConfigPersist],
  );

  const liveDaemonUrl = typeof window !== 'undefined' ? window.location.origin : undefined;

  return (
    <main
      className={styles.screen}
      aria-labelledby="integrations-screen-title"
      data-testid="integrations-screen"
    >
      <header className={styles.pageHead}>
        <div className={styles.pageHeadCopy}>
          <p className={styles.kicker}>{t('integrations.kicker')}</p>
          <h1 id="integrations-screen-title">{t('entry.navIntegrations')}</h1>
          <p className={styles.lede}>{t('integrations.lede')}</p>
        </div>
        <span className={styles.agentBadge}>
          <i className="fa-solid fa-link" aria-hidden="true" />
          {t('integrations.agentReady')}
        </span>
      </header>

      <nav className={styles.tabs} role="tablist" aria-label={t('integrations.areasAria')}>
        {INTEGRATION_TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={styles.tab}
              onClick={() => {
                trackIntegrationsTabClick(analytics.track, {
                  page_name: 'integrations',
                  area: 'integrations_tab',
                  element: integrationTabToTrackingElement(tab.id),
                });
                setActiveTab(tab.id);
              }}
              data-testid={`integrations-tab-${tab.id}`}
            >
              <i className={`fa-solid ${tab.icon}`} aria-hidden="true" />
              <span className={styles.tabCopy}>
                <strong>{integrationTabLabel(tab.id, t)}</strong>
                <small>{integrationTabHint(tab.id, t)}</small>
              </span>
            </button>
          );
        })}
      </nav>

      <div className={styles.frame} role="tabpanel">
        {activeTab === 'mcp' ? (
          <McpPanel
            onAddServerClick={() =>
              trackIntegrationsMcpTabClick(analytics.track, {
                page_name: 'integrations',
                area: 'mcp_tab',
                element: 'add_server',
              })
            }
          />
        ) : null}

        {activeTab === 'connectors' ? (
          <ConnectorsPanel
            config={localConfig}
            setConfig={setLocalConfig}
            composioConfigLoading={composioConfigLoading}
            onPersistComposioKey={onPersistComposioKey}
            onConnectorsTabClick={(element) =>
              trackIntegrationsConnectorsTabClick(analytics.track, {
                page_name: 'integrations',
                area: 'connectors_tab',
                element,
              })
            }
            onConnectorAuthResult={({ connectorId, action, result, errorCode }) =>
              trackSettingsConnectorAuthResult(analytics.track, {
                page_name: 'settings',
                area: 'connectors',
                connector_id: connectorId,
                action,
                result,
                ...(errorCode ? { error_code: errorCode } : {}),
              })
            }
          />
        ) : null}

        {activeTab === 'skills' ? (
          <SkillsPanel
            config={localConfig}
            setConfig={updateLocalConfig}
            {...(onSkillsRefresh ? { onSkillsRefresh } : {})}
            {...(onSkillsChanged ? { onSkillsChanged } : {})}
          />
        ) : null}

        {activeTab === 'use-everywhere' ? (
          <UseEverywherePanel
            onOpenMcp={() => setActiveTab('mcp')}
            {...(liveDaemonUrl ? { daemonUrl: liveDaemonUrl } : {})}
          />
        ) : null}
      </div>
    </main>
  );
}

function integrationTabLabel(id: IntegrationTab, t: ReturnType<typeof useT>): string {
  switch (id) {
    case 'mcp': return t('integrations.tabLabel.mcp');
    case 'connectors': return t('entry.tabConnectors');
    case 'skills': return t('integrations.tabLabel.skills');
    case 'use-everywhere': return t('entry.useEverywhereTitle');
  }
}

function integrationTabHint(id: IntegrationTab, t: ReturnType<typeof useT>): string {
  switch (id) {
    case 'mcp': return t('integrations.tabHint.mcp');
    case 'connectors': return t('integrations.tabHint.connectors');
    case 'skills': return t('settings.skillsHint');
    case 'use-everywhere': return t('integrations.tabHint.useEverywhere');
  }
}
