/**
 * HelpButton — the first utility in the Product Hub header row.
 *
 * The shared-header contract requires exactly one Help entry, living in row 1
 * and never duplicated into a specialist row. It opens the command palette on
 * its Help scope rather than introducing a second help surface: the palette
 * already owns the keyboard-shortcut reference and the help commands, and a
 * separate menu would give the same content two homes that drift apart.
 *
 * The palette is provided by `<SpotlightRoot>`, which wraps every admin layout.
 * When the context is absent — the header rendered outside that provider, which
 * only happens in isolated tests — the button stays inert rather than throwing.
 */
import { useContext } from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { SpotlightContext } from '@admin/spotlight/spotlightContext'
import styles from './ProductHubHeader.module.css'

const HELP_SCOPE_ID = 'help'

export function HelpButton() {
  const spotlight = useContext(SpotlightContext)

  return (
    // The approved header draws Help as a labelled pill, not a bare glyph — it
    // is the only utility in the row that carries its name, because it is the
    // one users hunt for rather than recognise.
    <Button
      variant="ghost"
      size="lg"
      className={styles.helpButton}
      aria-label="Help"
      data-testid="hub-header-help"
      disabled={spotlight === null}
      onClick={() => {
        spotlight?.open()
        spotlight?.pushScope(HELP_SCOPE_ID)
      }}
    >
      <FaIcon name="circle-question" size={17} />
      <span>Help</span>
    </Button>
  )
}
