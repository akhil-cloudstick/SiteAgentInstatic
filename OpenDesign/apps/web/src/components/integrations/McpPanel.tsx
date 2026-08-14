/**
 * MCP panel — the approved MMSBUILD reference panel
 * (`prototype-reference/src/IntegrationsScreen.jsx:173-203`, `McpPanel`).
 *
 * The reference draws: `.integration-panel-head` (h2 "External MCP servers" /
 * p "Third-party tools for your coding agent." / `.resource-primary-button`
 * "Add server"), then `.integration-empty-wide`, then a
 * `.integration-subhead` + `.integration-list` when there are entries.
 *
 * The rows themselves come from the app's real `McpClientSection` — the
 * reference's list is a local prototype draft store, which the build kit's §5
 * names among the behaviours that "must not be preserved". The section renders
 * with `hideChrome` so it does not draw a second head, picker or empty card.
 */
import { useCallback, useRef, useState } from 'react';
import { McpClientSection, type McpClientSectionHandle } from '../McpClientSection';
import type { McpTemplate } from '../../state/mcp';
import { useT } from '../../i18n';
import { AddMcpServerDialog } from './AddMcpServerDialog';
import styles from '../IntegrationsScreen.module.css';

export interface McpPanelProps {
  /** Fires on the reference's `Add server` control, for the MCP-tab funnel. */
  onAddServerClick?: () => void;
}

export function McpPanel({ onAddServerClick }: McpPanelProps) {
  const t = useT();
  const sectionRef = useRef<McpClientSectionHandle | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [templates, setTemplates] = useState<McpTemplate[]>([]);
  const [rowCount, setRowCount] = useState(0);

  const openDialog = () => {
    onAddServerClick?.();
    setTemplates(sectionRef.current?.getTemplates() ?? []);
    setDialogOpen(true);
  };

  // Stable identity: the section calls this from an effect keyed on the count,
  // so an inline arrow would re-fire it on every render of this panel.
  const handleRowCount = useCallback((count: number) => setRowCount(count), []);

  return (
    <section
      className={styles.panel}
      aria-labelledby="mcp-panel-title"
      data-testid="integrations-panel-mcp"
    >
      <header className={styles.panelHead}>
        <div>
          <h2 id="mcp-panel-title">{t('mcpClient.title')}</h2>
          <p>{t('mcpClient.subtitle')}</p>
        </div>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={openDialog}
          data-testid="integrations-mcp-add-server"
        >
          <i className="fa-solid fa-plus" aria-hidden="true" />
          {t('mcpClient.addServer')}
        </button>
      </header>

      {rowCount === 0 ? (
        <div className={styles.emptyWide} data-testid="integrations-mcp-empty">
          <span>
            <i className="fa-solid fa-server" aria-hidden="true" />
          </span>
          <div>
            <h3>{t('mcpClient.emptyTitle')}</h3>
            <p>{t('integrations.mcpEmptyBody')}</p>
          </div>
        </div>
      ) : (
        <div className={styles.subhead}>
          <div>
            <h3>{t('integrations.mcpConfiguredTitle')}</h3>
            <p>{t('integrations.mcpConfiguredBody')}</p>
          </div>
          <span className={styles.subheadCount}>{rowCount}</span>
        </div>
      )}

      <McpClientSection
        ref={sectionRef}
        hideChrome
        onRowCountChange={handleRowCount}
      />

      {dialogOpen ? (
        <AddMcpServerDialog
          templates={templates}
          onClose={() => setDialogOpen(false)}
          onPickTemplate={(tpl) => {
            sectionRef.current?.addFromTemplate(tpl);
            setDialogOpen(false);
          }}
          onPickBlank={() => {
            sectionRef.current?.addBlank();
            setDialogOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
