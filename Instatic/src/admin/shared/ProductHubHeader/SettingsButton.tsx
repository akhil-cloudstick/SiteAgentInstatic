/**
 * SettingsButton — the fourth utility in the Product Hub header row.
 *
 * Settings had a toolbar gear before the MMSBUILD header re-skin, then moved
 * into the account menu because the approved single-row header had no room for
 * it. The shared-header contract restores it as a first-class row-1 utility
 * (Help → Notifications → Theme → Settings → Account), and requires each
 * utility to appear exactly once — so the account menu's duplicate entry is
 * gone.
 *
 * Same action as before: `adminUi.openSettings`, which the editor store mirrors
 * through its registered bridge, so the modal opens identically whether or not
 * the editor is loaded.
 */
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { useAdminUi } from '@admin/state/adminUi'

export function SettingsButton() {
  const openSettings = useAdminUi((s) => s.openSettings)

  return (
    // Round 44px header button — the shared trailer spec, see ThemeToggleButton.
    <Button
      variant="ghost"
      size="lg"
      shape="pill"
      iconOnly
      aria-label="Settings"
      tooltip="Settings"
      data-testid="hub-header-settings"
      onClick={() => openSettings('general')}
    >
      <FaIcon name="gear" size={17} />
    </Button>
  )
}
