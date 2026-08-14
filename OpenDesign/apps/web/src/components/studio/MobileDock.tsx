/**
 * MobileDock — the approved prototype's four-item panel dock
 * (`prototype-reference/src/Workspace.jsx:712-721`, styles
 * `prototype-reference/src/styles.css:4469-4495`).
 *
 * Hidden above 1100px; below it the workbench stacks to a single canvas and
 * this is how Chat and Design Files are reached. "Edit" toggles the viewer's
 * manual-edit mode — the prototype navigated to a separate Focus screen, which
 * MMS Design does not have; edit-in-place IS the upstream equivalent, and the
 * build kit says so ("Manual editing is an Edit mode inside the active file
 * viewer in upstream OpenDesign").
 */
import { FaIcon } from '@mms/shell';
import { useT } from '../../i18n';

export type StudioMobilePanel = 'chat' | 'canvas' | 'files';

export interface MobileDockProps {
  active: StudioMobilePanel;
  onChange: (panel: StudioMobilePanel) => void;
  onEdit: () => void;
  /** Highlights Edit while manual-edit mode is on. */
  editActive?: boolean;
}

export function MobileDock({ active, onChange, onEdit, editActive = false }: MobileDockProps) {
  const t = useT();
  return (
    <nav className="mobile-dock" aria-label={t('studio.mobileDockAria')}>
      <button
        type="button"
        className={active === 'chat' ? 'active' : ''}
        aria-current={active === 'chat' ? 'true' : undefined}
        onClick={() => onChange('chat')}
      >
        <FaIcon name="comments" size={16} />
        <span>{t('studio.dockChat')}</span>
      </button>
      <button
        type="button"
        className={active === 'canvas' ? 'active' : ''}
        aria-current={active === 'canvas' ? 'true' : undefined}
        onClick={() => onChange('canvas')}
      >
        <FaIcon name="globe" size={16} />
        <span>{t('studio.dockCanvas')}</span>
      </button>
      <button
        type="button"
        className={active === 'files' ? 'active' : ''}
        aria-current={active === 'files' ? 'true' : undefined}
        onClick={() => onChange('files')}
      >
        <FaIcon name="folder" size={16} />
        <span>{t('studio.dockFiles')}</span>
      </button>
      <button
        type="button"
        className={editActive ? 'active' : ''}
        aria-pressed={editActive}
        onClick={onEdit}
      >
        <FaIcon name="pen-to-square" size={16} />
        <span>{t('studio.dockEdit')}</span>
      </button>
    </nav>
  );
}
