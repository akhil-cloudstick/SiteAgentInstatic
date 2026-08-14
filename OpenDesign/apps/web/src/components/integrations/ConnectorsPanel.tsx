/**
 * Connectors panel — the approved MMSBUILD reference panel
 * (`prototype-reference/src/IntegrationsScreen.jsx:218-269`, `ConnectorsPanel`).
 *
 * The reference draws: `.integration-panel-head.connector-head`, then
 * `.connector-provider-note`, then `.connector-grid` of `.connector-card`,
 * then `.production-adapter-warning`.
 *
 * ── What is real and what is not ──────────────────────────────────────────
 * The reference's two cards are fixtures (a Product Hub handoff card and a
 * GitHub card) and its provider note asserts "No API key is stored in this
 * prototype". The build kit requires the native surface instead
 * (`OPEN-DESIGN-DEVELOPER-BUILD-INSTRUCTIONS.md` §3, "Use upstream-native
 * catalogs and connection surfaces"; §5 lists prototype notices among the
 * behaviours that "must not be preserved"). So this panel keeps the
 * reference's chrome and hands the body to the app's real `ConnectorSection` —
 * the Composio credential controls (including the three-stage destructive
 * Clear and its arming delay) and the live connector catalogue, unchanged.
 * `IntegrationsScreen.module.css` re-houses those into the reference's
 * provider-note and card geometry, scoped so Settings is untouched.
 *
 * The reference's GitHub card is additionally out of scope product-wide:
 * `styles/mms-overrides.css` removes every Git/GitHub surface.
 *
 * Its `.production-adapter-warning` band is not reproduced either. It asserts
 * a prototype condition ("Product Hub is not connected"), and since no Hub
 * hand-off exists yet it would be permanently on screen — a banner that never
 * changes is noise, not information. §5 lists the prototype notices among the
 * behaviours that must not be preserved.
 *
 * ── One placement deviation ───────────────────────────────────────────────
 * The reference puts the connector search in the panel head. The app's real
 * search lives inside `ConnectorsBrowser`, wired to its filter state and
 * covered by `connectors-search-input` in the e2e suite. Duplicating it in the
 * head would leave one of the two dead, so the real one stays where it is and
 * is restyled to the reference's `.resource-search` box.
 */
import type { Dispatch, SetStateAction } from 'react';
import type { AppConfig } from '../../types';
import { ConnectorSection } from '../SettingsDialog';
import { useT } from '../../i18n';
import styles from '../IntegrationsScreen.module.css';

export interface ConnectorsPanelProps {
  config: AppConfig;
  setConfig: Dispatch<SetStateAction<AppConfig>>;
  composioConfigLoading?: boolean;
  onPersistComposioKey: (composio: AppConfig['composio']) => Promise<void> | void;
  onConnectorsTabClick: (
    element:
      | 'api_key_input'
      | 'save_key'
      | 'clear'
      | 'get_api_key'
      | 'gate_card'
      | 'provider_chip'
      | 'search_connectors',
  ) => void;
  onConnectorAuthResult: (params: {
    connectorId: string;
    action: 'connect' | 'disconnect' | 'refresh';
    result: 'success' | 'failed' | 'cancelled';
    errorCode?: string;
  }) => void;
}

export function ConnectorsPanel({
  config,
  setConfig,
  composioConfigLoading = false,
  onPersistComposioKey,
  onConnectorsTabClick,
  onConnectorAuthResult,
}: ConnectorsPanelProps) {
  const t = useT();

  const composio = config.composio ?? {};
  const configured = Boolean(
    composio.apiKeyConfigured || (composio.apiKey ?? '').trim() || composio.apiKeyTail,
  );

  return (
    <section
      className={styles.panel}
      aria-labelledby="connectors-panel-title"
      data-testid="integrations-panel-connectors"
    >
      <header className={styles.panelHead}>
        <div>
          <h2 id="connectors-panel-title">{t('entry.tabConnectors')}</h2>
          <p>{t('integrations.connectorsSubtitle')}</p>
        </div>
        <span
          className={`${styles.status}${configured ? ` ${styles.statusPrototype}` : ''}`}
        >
          {configured
            ? t('integrations.connectorConfigured')
            : t('integrations.connectorSetupRequired')}
        </span>
      </header>

      <ConnectorSection
        cfg={config}
        setCfg={setConfig}
        composioConfigLoading={composioConfigLoading}
        onPersistComposioKey={onPersistComposioKey}
        onConnectorsTabClick={onConnectorsTabClick}
        onConnectorAuthResult={onConnectorAuthResult}
      />
    </section>
  );
}
