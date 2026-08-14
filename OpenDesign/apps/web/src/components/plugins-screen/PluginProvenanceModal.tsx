/**
 * Provenance sheet behind the card kebab's "Details" / "Provenance" items.
 *
 * The reference's kebab (`PluginsScreen.jsx:289-294`) answers both items with a
 * local prototype notice ("details are supplied by the official catalog when
 * the daemon is running"). The build kit lists exactly that — "some links and
 * actions are local prototype notices rather than production routes or
 * handlers" — among the behaviours a port must not preserve (§5), so the item
 * shows the real record instead.
 *
 * Chrome is the reference's shared resource modal (`resource-screens.css:506-550`),
 * so it reads as the same family as the Add dialog; only the body is new, and it
 * is built from the reference's own add-choice geometry.
 *
 * Every row is a field that actually exists on the record or the catalogue
 * entry. Nothing is inferred, and absent fields render nothing rather than
 * "unknown" — a plugin with no pinned ref genuinely has no pinned ref.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { InstalledPluginRecord } from '@open-design/contracts';
import { useT } from '../../i18n';
import type { AvailableMarketplacePlugin } from './catalogItem';
import styles from '../PluginsScreen.module.css';

export interface PluginProvenanceModalProps {
  title: string;
  description: string;
  record?: InstalledPluginRecord | undefined;
  available?: AvailableMarketplacePlugin | undefined;
  onClose: () => void;
}

interface Row {
  label: string;
  value: string;
}

export function PluginProvenanceModal({
  title,
  description,
  record,
  available,
  onClose,
}: PluginProvenanceModalProps) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const rows: Row[] = [];
  const push = (label: string, value: string | number | undefined | null) => {
    if (value === undefined || value === null) return;
    const text = String(value).trim();
    if (!text) return;
    rows.push({ label, value: text });
  };

  if (record) {
    push(t('pluginsScreen.provenance.id'), record.id);
    push(t('pluginsScreen.provenance.version'), record.version);
    push(t('pluginsScreen.provenance.trust'), record.trust);
    push(t('pluginsScreen.provenance.sourceKind'), record.sourceKind);
    push(t('pluginsScreen.provenance.source'), record.resolvedSource ?? record.source);
    push(t('pluginsScreen.provenance.ref'), record.resolvedRef ?? record.pinnedRef);
    push(t('pluginsScreen.provenance.catalog'), record.sourceMarketplaceId);
    push(
      t('pluginsScreen.provenance.catalogEntry'),
      record.sourceMarketplaceEntryName
        ? `${record.sourceMarketplaceEntryName}${
          record.sourceMarketplaceEntryVersion ? `@${record.sourceMarketplaceEntryVersion}` : ''
        }`
        : undefined,
    );
    push(t('pluginsScreen.provenance.manifestDigest'), record.manifestDigest ?? record.sourceDigest);
    push(t('pluginsScreen.provenance.integrity'), record.archiveIntegrity);
    push(
      t('pluginsScreen.provenance.capabilities'),
      record.capabilitiesGranted.length > 0
        ? record.capabilitiesGranted.join(', ')
        : t('pluginsScreen.provenance.capabilitiesNone'),
    );
  } else if (available) {
    const { entry, marketplace } = available;
    push(t('pluginsScreen.provenance.id'), entry.name);
    push(t('pluginsScreen.provenance.version'), entry.version);
    push(t('pluginsScreen.provenance.trust'), marketplace.trust);
    push(t('pluginsScreen.provenance.catalog'), marketplace.manifest.name ?? marketplace.url);
    push(t('pluginsScreen.provenance.catalogUrl'), marketplace.url);
    push(t('pluginsScreen.provenance.source'), entry.source);
    push(t('pluginsScreen.provenance.ref'), entry.ref);
    push(t('pluginsScreen.provenance.manifestDigest'), entry.manifestDigest ?? entry.dist?.manifestDigest);
    push(t('pluginsScreen.provenance.integrity'), entry.integrity ?? entry.dist?.integrity);
    push(t('pluginsScreen.provenance.license'), entry.license);
    push(t('pluginsScreen.provenance.homepage'), entry.homepage);
    push(t('pluginsScreen.provenance.installCommand'), `od plugin install ${entry.name}`);
  }

  const dialog = (
    <div
      // See the note in AddResourceDialog: the global class is what the desktop
      // window-drag strip matches on.
      className={`${styles.backdrop} resource-modal-backdrop`}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-provenance-title"
        data-testid="plugins-provenance-modal"
      >
        <header>
          <div>
            <h2 id="plugin-provenance-title">{title}</h2>
            <p>{description || t('pluginsScreen.provenanceLede')}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label={t('pluginsScreen.addClose')}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <dl className={styles.provenanceList}>
          {rows.map((row) => (
            <div key={row.label} className={styles.provenanceRow}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
