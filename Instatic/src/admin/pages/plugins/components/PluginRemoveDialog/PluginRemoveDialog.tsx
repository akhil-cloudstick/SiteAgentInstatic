/**
 * `PluginRemoveDialog` — confirmation prompt for plugin uninstall.
 *
 * Built on the shared `<Dialog>` primitive, wearing the Plugins screen's modal
 * shell. Doesn't go through the `useConfirmDelete` hook because that hook is
 * gated on the `confirmBeforeDelete` editor preference (default off, for the
 * power-user layer-delete flow). Plugin uninstall is a different class of
 * destructive action — drops DB rows, kills routes / hooks / canvas modules,
 * removes plugin records and on-disk assets — so it always confirms.
 *
 * `force` switches to the variant offered only after a normal uninstall failed
 * on a lifecycle-hook error: the server skips the plugin's own cleanup hooks,
 * so the copy is explicit that external resources it set up may be left behind.
 */
import { Button } from '@ui/components/Button'
import { Dialog } from '@ui/components/Dialog'
import { FaIcon } from '@ui/components/FaIcon'
import type { InstalledPlugin } from '@core/plugin-sdk'
import { pluginDialogScopeRef } from '../pluginDialogScope'
import dialogStyles from '../pluginDialog.module.css'
import styles from './PluginRemoveDialog.module.css'

interface PluginRemoveDialogProps {
  plugin: InstalledPlugin
  force: boolean
  busy: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
}

export function PluginRemoveDialog({
  plugin,
  force,
  busy,
  onClose,
  onConfirm,
}: PluginRemoveDialogProps) {
  return (
    <Dialog
      open
      ref={pluginDialogScopeRef}
      onClose={busy ? () => {} : onClose}
      tone="danger"
      eyebrow="Plugin lifecycle"
      title={force ? 'Normal removal failed' : `Remove ${plugin.name}?`}
      className={dialogStyles.dialog}
      bodyClassName={dialogStyles.body}
      footerClassName={dialogStyles.footer}
      footer={
        <>
          <Button variant="secondary" size="lg" type="button" onClick={onClose} disabled={busy}>
            <span>{force ? 'Keep plugin' : 'Cancel'}</span>
          </Button>
          <Button
            variant="destructive"
            size="lg"
            type="button"
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            <span>{busy ? 'Removing…' : force ? 'Remove anyway' : 'Run normal removal'}</span>
          </Button>
        </>
      }
    >
      <div className={dialogStyles.stack}>
        <div className={dialogStyles.warning}>
          <FaIcon name="triangle-exclamation" size={20} />
          <div>
            <strong>
              {force
                ? 'The plugin cleanup hook did not finish.'
                : 'Deactivate and uninstall hooks run first.'}
            </strong>
            <p>
              {force
                ? 'Remove anyway skips plugin cleanup code. External webhooks or registrations may remain.'
                : 'If the hook fails, the plugin stays installed and Remove anyway becomes available.'}
            </p>
          </div>
        </div>

        <ul className={styles.checklist}>
          {force ? (
            <>
              <li>Skips its <code>deactivate</code> and <code>uninstall</code> lifecycle hooks.</li>
              <li>Drops its routes, hooks, settings, schedules, and canvas modules.</li>
              <li>Deletes every record stored under the plugin&rsquo;s declared resources.</li>
              <li>Removes all files under <code>uploads/plugins/{plugin.id}/</code>.</li>
            </>
          ) : (
            <>
              <li>Runs its <code>deactivate</code> and <code>uninstall</code> lifecycle hooks.</li>
              <li>Drops its routes, hooks, settings, and canvas modules from the runtime.</li>
              <li>Deletes every record stored under the plugin&rsquo;s declared resources.</li>
              <li>
                Removes the plugin&rsquo;s files from{' '}
                <code>{plugin.manifest.assetBasePath ?? 'uploads/plugins/…'}</code>.
              </li>
            </>
          )}
        </ul>

        <p className={dialogStyles.note}>
          Pack-imported Visual Components, pages, and CSS classes stay on your site.
        </p>
      </div>
    </Dialog>
  )
}
