/**
 * ThemeToggleButton — quick light/dark switch in the shared toolbar trailer.
 *
 * Drives the SAME `theme` editor preference as Settings › Preferences › Theme
 * (one source of truth). Selecting a value sets `html[data-editor-theme]`, which
 * `globals.css` maps to the MMS cream (`light`, the default `:root`) or MMS navy
 * (`dark`) token set — re-theming the whole admin. Uses the standalone
 * editor-preference store (already consumed by AdminPageLayout), so it stays out
 * of the editor-store bundle.
 */
import { FaIcon } from '@ui/components/FaIcon'
import { Button } from '@ui/components/Button'
import {
  useEditorSelectPreference,
  setEditorSelectPreference,
} from '@admin/pages/site/preferences/editorPreferences'

export function ThemeToggleButton() {
  const theme = useEditorSelectPreference('theme')
  const isDark = theme === 'dark'
  const nextLabel = isDark ? 'Light' : 'Dark'

  return (
    // size="lg" + shape="pill" is the reference header's round 44px icon
    // button (`.icon-button`), shared by the whole toolbar trailer.
    <Button
      variant="ghost"
      size="lg"
      shape="pill"
      iconOnly
      aria-label={`Theme: ${isDark ? 'Dark' : 'Light'}. Switch to ${nextLabel}.`}
      tooltip={`Theme: ${isDark ? 'Dark' : 'Light'}`}
      onClick={() => setEditorSelectPreference('theme', isDark ? 'light' : 'dark')}
      data-testid="toolbar-theme-toggle"
    >
      {/*
        * The glyph shows the theme this button switches TO, not the one that
        * is active — a sun while dark, a moon while light. That is the
        * approved screen's convention, and it is what makes the control
        * readable as an action rather than a status readout.
        */}
      <FaIcon name={isDark ? 'sun' : 'moon'} size={17} />
    </Button>
  )
}
