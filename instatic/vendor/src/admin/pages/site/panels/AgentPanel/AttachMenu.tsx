/**
 * AttachMenu — the "attach image" affordance in the AI chat composer.
 *
 * A single trigger button opens a dropdown (built on the shared ContextMenu, so
 * it matches ConversationHistory / ModelPicker) offering every way to attach a
 * reference screenshot:
 *   • Upload image…      → native file picker
 *   • Paste from clipboard → async Clipboard API (only shown when supported)
 *
 * Ctrl/Cmd+V paste and drag-and-drop are handled by the composer directly; this
 * menu is the discoverable, click-only path to the same {@link onFiles} sink.
 */

import { useRef, useState } from 'react'
import { Button } from '@ui/components/Button'
import { ContextMenu, ContextMenuItem } from '@ui/components/ContextMenu'
import { ImageSolidIcon } from 'pixel-art-icons/icons/image-solid'
import { UploadIcon } from 'pixel-art-icons/icons/upload'
import { CopySolidIcon } from 'pixel-art-icons/icons/copy-solid'
import { ALLOWED_IMAGE_MIME } from './attachments'
import styles from './AgentPanel.module.css'

const ACCEPT = Array.from(ALLOWED_IMAGE_MIME).join(',')
// `navigator.clipboard.read` is gated behind a secure context + permission and
// missing in some browsers — only surface the paste item when it exists.
const CLIPBOARD_READ_SUPPORTED =
  typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function'

interface AttachMenuProps {
  onFiles: (files: File[]) => void
  onError: (message: string) => void
  disabled?: boolean
}

export function AttachMenu({ onFiles, onError, disabled = false }: AttachMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    // Reset so picking the same file twice in a row still fires onChange.
    e.target.value = ''
    if (files.length > 0) onFiles(files)
  }

  async function pasteFromClipboard() {
    try {
      const files = await readClipboardImages()
      if (files.length === 0) {
        onError('No image found on the clipboard. Copy an image, then try again.')
        return
      }
      onFiles(files)
    } catch (err) {
      // Permission denied / unsupported — tell the user to use Ctrl+V or upload.
      console.error('[AttachMenu] clipboard read failed:', err)
      onError('Could not read the clipboard. Paste with Ctrl+V, or use Upload instead.')
    }
  }

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        tooltip="Attach image"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Attach image"
        data-testid="agent-attach-button"
      >
        <ImageSolidIcon size={14} />
      </Button>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        aria-hidden="true"
        tabIndex={-1}
        className={styles.hiddenFileInput}
        onChange={handleFileInputChange}
      />

      {open && (
        <ContextMenu
          anchorRef={triggerRef}
          triggerRef={triggerRef}
          align="start"
          side="top"
          offset={6}
          minWidth={200}
          ariaLabel="Attach image"
          onClose={() => setOpen(false)}
        >
          <ContextMenuItem
            onClick={() => {
              fileInputRef.current?.click()
              setOpen(false)
            }}
          >
            <UploadIcon size={12} aria-hidden="true" />
            <span>Upload image…</span>
          </ContextMenuItem>
          {CLIPBOARD_READ_SUPPORTED && (
            <ContextMenuItem
              onClick={() => {
                void pasteFromClipboard()
                setOpen(false)
              }}
            >
              <CopySolidIcon size={12} aria-hidden="true" />
              <span>Paste from clipboard</span>
            </ContextMenuItem>
          )}
        </ContextMenu>
      )}
    </>
  )
}

async function readClipboardImages(): Promise<File[]> {
  const items = await navigator.clipboard.read()
  const files: File[] = []
  for (const item of items) {
    const imageType = item.types.find((t) => t.startsWith('image/'))
    if (!imageType) continue
    const blob = await item.getType(imageType)
    files.push(new File([blob], 'pasted-image', { type: imageType }))
  }
  return files
}
