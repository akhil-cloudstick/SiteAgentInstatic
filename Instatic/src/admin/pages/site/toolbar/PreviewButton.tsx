/**
 * PreviewButton — the header's dedicated "Preview" action.
 *
 * The approved Site screen gives Preview its own secondary button beside
 * Publish *and* keeps a "Preview draft" entry inside the publish menu. Both
 * open the same authenticated draft overlay (`uiSlice.openPreview`), which
 * mounts the lazy `PreviewOverlay` — so this is a second door onto one room,
 * not a second implementation.
 */
import { FaIcon } from '@ui/components/FaIcon'
import { Button } from '@ui/components/Button'
import { useEditorStore } from '@site/store/store'
import styles from './PreviewButton.module.css'

export function PreviewButton() {
  const openPreview = useEditorStore((s) => s.openPreview)

  return (
    <Button
      variant="secondary"
      size="lg"
      className={styles.button}
      onClick={openPreview}
      tooltip="Preview the authenticated draft of this page"
      data-testid="toolbar-preview-btn"
    >
      <FaIcon name="eye" size={16} />
      <span className={styles.label}>Preview</span>
    </Button>
  )
}
