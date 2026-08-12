/**
 * ProductHubHeader — this product's adapter for row 1 of the shared MMS shell.
 *
 * The row itself lives in `@mms/shell` and is rendered identically by MMS
 * Design; everything below is the CMS-side wiring it needs — where Help goes,
 * which store owns the theme, what the account control is. Nothing here decides
 * how the row LOOKS. If a visual change is wanted, it belongs in
 * `shared/mms-shell/src/shell/MmsShellHeader.*` so both products get it.
 *
 * Placed in `shared/` (not under `pages/site/`) so all three admin layouts can
 * mount it without one layout's module graph reaching into another's. It must
 * never import `@site/store` — `AdminPageLayout`'s bundle contract keeps the
 * ~165 KB editor store off Plugins / Users / Account, and this row renders
 * there too.
 */
import { useContext, useSyncExternalStore } from 'react'
import { BRAND_NAME } from '@core/brand'
import { MmsShellHeader } from '@mms/shell'
import { AccountMenuButton } from '@admin/shared/AccountMenuButton'
import {
  useEditorSelectPreference,
  setEditorSelectPreference,
} from '@site/preferences/editorPreferences'
import { useAdminUi } from '@admin/state/adminUi'
import { useHubContext } from '@admin/state/hubContext'
import {
  getAdminNotifications,
  markAdminNotificationsRead,
  subscribeAdminNotifications,
} from '@admin/state/adminNotifications'
import { SpotlightContext } from '@admin/spotlight/spotlightContext'
import { useAdminNavigate } from '@admin/lib/useAdminNavigate'

const HELP_SCOPE_ID = 'help'

/** Where the brand lockup goes when this install runs with no Product Hub. */
const NO_HUB_BRAND_HREF = '/cms/dashboard'

export function ProductHubHeader() {
  const hubContext = useHubContext()
  const theme = useEditorSelectPreference('theme')
  const openSettings = useAdminUi((s) => s.openSettings)
  const spotlight = useContext(SpotlightContext)
  const navigate = useAdminNavigate()
  const { items, unreadCount } = useSyncExternalStore(
    subscribeAdminNotifications,
    getAdminNotifications,
    getAdminNotifications,
  )

  return (
    <MmsShellHeader
      // The secondary label is this product's own brand constant rather than a
      // literal: `@core/brand` is the white-label surface every user-facing
      // product mention flows through, so changing that one constant re-labels
      // the whole admin, including this row.
      productLabel={BRAND_NAME}
      hubContext={hubContext}
      theme={theme === 'dark' ? 'dark' : 'light'}
      onToggleTheme={() =>
        setEditorSelectPreference('theme', theme === 'dark' ? 'light' : 'dark')
      }
      help={{
        // Help opens the command palette on its Help scope rather than
        // introducing a second help surface: the palette already owns the
        // keyboard-shortcut reference and the help commands, and a separate
        // menu would give the same content two homes that drift apart. Outside
        // a `<SpotlightRoot>` — which only happens in isolated tests — the
        // control stays inert rather than throwing.
        disabled: spotlight === null,
        onOpen: () => {
          spotlight?.open()
          spotlight?.pushScope(HELP_SCOPE_ID)
        },
      }}
      settings={{ onOpen: () => openSettings('general') }}
      notifications={{
        unreadCount,
        items,
        onRead: markAdminNotificationsRead,
        // The shell owns opening the panel; there is no separate side effect
        // for this product beyond marking the listed entries read.
        onOpen: () => {},
      }}
      accountSlot={<AccountMenuButton />}
      brandTarget={{
        href: NO_HUB_BRAND_HREF,
        onSelect: () => navigate(NO_HUB_BRAND_HREF),
      }}
    />
  )
}
