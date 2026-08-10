/**
 * ReplaceFileDialog — confirm + upload UI for swapping an asset's binary.
 *
 * Transcribed from the MMSBUILD Media reference (`screens/media/src/App.jsx`
 * → `ReplaceModal`) with the approved replacement master's treatment: an
 * AMBER warning callout at the top carrying the four truthful lines, a
 * stacked Current file / New file comparison with thumbnails, and a GREEN
 * confirm button.
 *
 * The warning text is deliberately literal about what replacement does — the
 * public path survives, every reference switches immediately, the old binary
 * is deleted, and there is no rollback. It does NOT enumerate affected pages:
 * the `media_usage_refs` table is dormant, so any such list would be invented.
 */
import { useState, type ChangeEvent } from 'react'
import { Button } from '@ui/components/Button'
import { Dialog } from '@ui/components/Dialog'
import { FaIcon } from '@ui/components/FaIcon'
import { FileUpload } from '@ui/components/FileUpload'
import type { CmsMediaAsset } from '@core/persistence/cmsMedia'
import { bucketForMime } from '../../utils/filters'
import { pickVariantUrl } from '../../utils/variants'
import { formatBytes } from '../../utils/formatBytes'
import { getErrorMessage } from '@core/utils/errorMessage'
import styles from './ReplaceFileDialog.module.css'

interface ReplaceFileDialogProps {
  asset: CmsMediaAsset
  open: boolean
  onClose: () => void
  onReplace: (file: File) => Promise<unknown>
}

// Module-level helper — extracted so the React Compiler can compile the
// component body (try/finally inside an async function prevents compilation).
async function confirmReplace(
  picked: File,
  onReplace: (file: File) => Promise<unknown>,
  setPicked: (file: File | null) => void,
  onClose: () => void,
  setError: (msg: string | null) => void,
  setBusy: (v: boolean) => void,
): Promise<void> {
  setBusy(true)
  setError(null)
  try {
    await onReplace(picked)
    setPicked(null)
    onClose()
  } catch (err) {
    setError(getErrorMessage(err, 'Replace failed'))
  } finally {
    setBusy(false)
  }
}

function formatUploaded(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function ReplaceFileDialog({ asset, open, onClose, onReplace }: ReplaceFileDialogProps) {
  const [picked, setPicked] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One object URL per picked file, revoked when the pick changes.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(
      file && file.type.startsWith('image/') && file.type !== 'image/svg+xml'
        ? URL.createObjectURL(file)
        : null,
    )
    setPicked(file)
    setError(null)
  }

  async function handleConfirm() {
    if (!picked) return
    await confirmReplace(picked, onReplace, setPicked, onClose, setError, setBusy)
  }

  function handleClose() {
    if (busy) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPicked(null)
    setError(null)
    onClose()
  }

  const currentThumb = bucketForMime(asset.mimeType) === 'image'
    ? pickVariantUrl(asset, 160)
    : null

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Replace file"
      size="lg"
      footer={(
        <>
          <Button variant="secondary" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleConfirm()}
            disabled={!picked || busy}
          >
            <FaIcon name="rotate" size={12} />
            <span>{busy ? 'Replacing…' : 'Replace file'}</span>
          </Button>
        </>
      )}
    >
      <div className={styles.warning} role="alert">
        <span className={styles.warningIcon} aria-hidden="true">
          <FaIcon name="triangle-exclamation" size={18} />
        </span>
        <div className={styles.warningBody}>
          <span>Replacing this file keeps the same public URL.</span>
          <span>Every existing reference will switch immediately.</span>
          <span>The previous file will be permanently deleted.</span>
          <span>
            This action <strong>cannot be undone</strong> in the current UI.
          </span>
        </div>
      </div>

      <div className={styles.compare}>
        <div className={styles.compareGroup}>
          <span className={styles.compareLabel}>Current file</span>
          <div className={styles.compareRow}>
            <span className={styles.compareThumb} aria-hidden="true">
              {currentThumb ? (
                <img src={currentThumb} alt="" />
              ) : (
                <FaIcon name="file-lines" size={18} />
              )}
            </span>
            <span className={styles.compareText}>
              <span className={styles.compareName} title={asset.filename}>
                {asset.filename}
              </span>
              <span className={styles.compareMeta}>
                {formatBytes(asset.sizeBytes)} • {asset.mimeType}
              </span>
              <span className={styles.compareMeta}>
                Uploaded on {formatUploaded(asset.createdAt)}
              </span>
            </span>
          </div>
        </div>

        <div className={styles.compareGroup}>
          <span className={styles.compareLabel}>New file</span>
          {picked ? (
            <div className={styles.compareRow}>
              <span className={styles.compareThumb} aria-hidden="true">
                {previewUrl ? (
                  <img src={previewUrl} alt="" />
                ) : (
                  <FaIcon name="file-lines" size={18} />
                )}
              </span>
              <span className={styles.compareText}>
                <span className={styles.compareName} title={picked.name}>
                  {picked.name}
                </span>
                <span className={styles.compareMeta}>
                  {formatBytes(picked.size)} • {picked.type || 'unknown type'}
                </span>
                <FileUpload
                  onChange={handlePick}
                  buttonProps={{
                    variant: 'ghost',
                    size: 'xs',
                    'aria-label': 'Choose a different replacement file',
                  }}
                >
                  <span>Choose a different file</span>
                </FileUpload>
              </span>
            </div>
          ) : (
            <div className={styles.picker}>
              <FileUpload
                onChange={handlePick}
                buttonProps={{
                  variant: 'secondary',
                  size: 'lg',
                  'aria-label': 'Choose replacement file',
                }}
              >
                <FaIcon name="arrow-up-from-bracket" size={13} />
                <span>Choose replacement</span>
              </FileUpload>
            </div>
          )}
        </div>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}
    </Dialog>
  )
}
