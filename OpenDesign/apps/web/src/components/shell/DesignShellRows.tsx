/**
 * DesignShellRows — MMS Design's adapter for the shared MMSBUILD shell.
 *
 * Both rows live in `@mms/shell` and are rendered identically by MMS-CMS.
 * Everything here is the MMS-Design-side wiring: which store owns the theme,
 * where Help goes, what the account control is, and which destinations exist.
 * Nothing here decides how the rows LOOK — a visual change belongs in
 * `shared/mms-shell/src/shell/` so both products get it at once.
 *
 * This replaces the left icon rail. The destinations are the same six views the
 * rail routed to, so no routing behaviour changes: `selectView` is still the
 * only thing that moves the app between them.
 */
import type { ReactNode } from 'react';
import { MmsShellHeader, MmsSpecialistRow, type ShellDestination } from '@mms/shell';
import { useT } from '../../i18n';
import { useHubContext } from '../../state/hubContext';
import type { EntryHomeView } from '../../router';

/**
 * The six MMS Design destinations, in the order the shared-header contract
 * fixes them. `tasks` is the Automations view — the id is historical, the label
 * is what users see (`entry.navTasks`).
 */
const DESTINATIONS: Array<{ view: EntryHomeView; icon: string; labelKey: string; path: string }> = [
  { view: 'home', icon: 'house', labelKey: 'entry.navHome', path: '/' },
  { view: 'projects', icon: 'folder', labelKey: 'entry.navProjects', path: '/projects' },
  {
    view: 'design-systems',
    icon: 'border-all',
    labelKey: 'entry.navDesignSystems',
    path: '/design-systems',
  },
  { view: 'tasks', icon: 'bolt', labelKey: 'entry.navTasks', path: '/tasks' },
  { view: 'plugins', icon: 'puzzle-piece', labelKey: 'entry.navPlugins', path: '/plugins' },
  { view: 'integrations', icon: 'link', labelKey: 'entry.navIntegrations', path: '/integrations' },
];

/**
 * Behind the gateway this app is served under a fixed `/design` base path.
 * Routes are authored base-less, so an `href` has to add the prefix back or
 * middle-click and "copy link address" would land outside the app. Mirrors
 * `withBase()` in `router.ts`, which is not exported.
 */
function withBasePath(path: string): string {
  if (typeof window === 'undefined') return path;
  const match = window.location.pathname.match(/^\/design(?=\/|$)/);
  return match ? `${match[0]}${path === '/' ? '' : path}` || '/' : path;
}

export interface DesignShellRowsProps {
  view: EntryHomeView;
  onSelectView: (view: EntryHomeView) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenHelp: () => void;
  onOpenSettings: () => void;
  onOpenNotifications: () => void;
  notificationCount: number;
  onNewProject: () => void;
  newProjectDisabled?: boolean;
  /** MMS Design's own account control, rendered into row 1's account slot. */
  accountSlot?: ReactNode;
  /** The project name shown beside the product identity, when one is open. */
  projectName?: string | null;
}

export function DesignShellRows({
  view,
  onSelectView,
  theme,
  onToggleTheme,
  onOpenHelp,
  onOpenSettings,
  onOpenNotifications,
  notificationCount,
  onNewProject,
  newProjectDisabled,
  accountSlot,
  projectName,
}: DesignShellRowsProps) {
  const t = useT();
  const hubContext = useHubContext();

  const destinations: ShellDestination[] = DESTINATIONS.map((item) => ({
    id: item.view,
    label: t(item.labelKey as Parameters<typeof t>[0]),
    icon: item.icon,
    href: withBasePath(item.path),
    active: view === item.view,
    onSelect: () => onSelectView(item.view),
  }));

  return (
    <>
      <MmsShellHeader
        productLabel="MMS Design"
        hubContext={hubContext}
        // The approved reference shows the Operator Hub links, so they render
        // even before Operator carries hub context into /design. They are inert
        // until it does — see pending.md §3.8.
        showHubNavWithoutContext
        theme={theme}
        onToggleTheme={onToggleTheme}
        help={{ onOpen: onOpenHelp }}
        settings={{ onOpen: onOpenSettings }}
        notifications={{ unreadCount: notificationCount, onOpen: onOpenNotifications }}
        accountSlot={accountSlot}
        brandTarget={{ href: withBasePath('/'), onSelect: () => onSelectView('home') }}
      />
      <MmsSpecialistRow
        productName="MMS Design"
        // Broadest to narrowest, as the contract orders it. Omitted rather than
        // guessed when the Hub hand-off did not supply them.
        scope={[hubContext?.client, hubContext?.project ?? projectName, hubContext?.site]}
        identityHref={withBasePath('/')}
        onSelectIdentity={() => onSelectView('home')}
        destinations={destinations}
        navLabel="MMS Design navigation"
        rowLabel="MMS Design specialist workspace"
        // Leftmost in MMS Design per DECISIONS 2026-08-10 (the CMS keeps it
        // right). Rendered without a destination until the Hub hand-off exists,
        // so the row matches the approved chrome.
        backToHub={{ position: 'left', href: hubContext?.returnUrl ?? '' }}
        rightSlot={
          <button
            type="button"
            className="mms-new-project"
            onClick={onNewProject}
            disabled={newProjectDisabled}
          >
            <i className="fa-solid fa-plus" aria-hidden="true" />
            <span>{t('entry.navNewProject')}</span>
          </button>
        }
      />
    </>
  );
}
