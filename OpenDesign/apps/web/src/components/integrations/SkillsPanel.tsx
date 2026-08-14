/**
 * Skills panel — the approved MMSBUILD reference panel
 * (`prototype-reference/src/IntegrationsScreen.jsx:271-287`, `SkillsPanel`).
 *
 * The reference draws `.integration-panel-head.connector-head` (h2 "Skills
 * integrations" / p "Functional skills the agent can invoke mid-task.") and
 * then a `.resource-empty-state` — its registry is never populated, because
 * the prototype has no daemon.
 *
 * Here the head is the reference's and the body is the app's real
 * `SkillsSection`, per the build kit's §3 ("Use upstream-native catalogs and
 * connection surfaces"). The reference's empty state still appears, through
 * the section's own no-results branch, restyled by
 * `IntegrationsScreen.module.css`.
 *
 * The reference's search sits in the head; the app's real one is inside the
 * section's filter row. Same call as the Connectors panel — one real control
 * beats two, one of which would be dead.
 */
import type { Dispatch, SetStateAction } from 'react';
import type { AppConfig } from '../../types';
import { SkillsSection } from '../SkillsSection';
import { useT } from '../../i18n';
import styles from '../IntegrationsScreen.module.css';

export interface SkillsPanelProps {
  config: AppConfig;
  setConfig: Dispatch<SetStateAction<AppConfig>>;
  onSkillsRefresh?: () => Promise<void> | void;
  onSkillsChanged?: (affectedSkillId?: string) => void;
}

export function SkillsPanel({
  config,
  setConfig,
  onSkillsRefresh,
  onSkillsChanged,
}: SkillsPanelProps) {
  const t = useT();

  return (
    <section
      className={styles.panel}
      aria-labelledby="skills-panel-title"
      data-testid="integrations-panel-skills"
    >
      <header className={styles.panelHead}>
        <div>
          <h2 id="skills-panel-title">{t('integrations.skillsTitle')}</h2>
          <p>{t('settings.skillsHint')}.</p>
        </div>
      </header>

      <SkillsSection
        cfg={config}
        setCfg={setConfig}
        {...(onSkillsRefresh ? { onSkillsRefresh } : {})}
        {...(onSkillsChanged ? { onSkillsChanged } : {})}
      />
    </section>
  );
}
