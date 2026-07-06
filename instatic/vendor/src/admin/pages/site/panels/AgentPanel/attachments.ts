/**
 * Image attachments for the AI chat composer.
 *
 * Tenants attach reference screenshots to a chat message three ways — the
 * attach dropdown (file picker), Ctrl/Cmd+V paste, and drag-and-drop. All three
 * funnel through {@link fileToAttachment}, which validates the type, downscales
 * oversized images, and hands back raw base64 (no `data:` prefix) ready to drop
 * into a `{ kind:'image' }` content block.
 *
 * We downscale + re-encode client-side rather than shipping raw multi-MB
 * screenshots: vision models bill images by rendered pixel area, so a capped
 * long edge keeps both the request payload and the token cost bounded. Small
 * images pass through untouched to preserve crisp text in screenshots.
 */

import { nanoid } from 'nanoid'
import type { AgentImageAttachment } from '@site/agent'

/** Image types every supported vision provider accepts (Anthropic + OpenAI). */
export const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

/** Max images per message. Keeps the request payload + token cost sane. */
export const MAX_ATTACHMENTS = 8

/** Longest edge, in px, kept after downscaling. ~1568 is the point past which
 *  Anthropic/OpenAI resize server-side anyway, so sending larger just wastes
 *  bytes. */
const MAX_IMAGE_DIMENSION = 1568

/** Below this original size an image is used as-is (no re-encode) so small,
 *  text-heavy screenshots stay pixel-perfect. */
const REENCODE_ABOVE_BYTES = 1_000_000

/**
 * A picked/pasted/dropped image held in the composer before send. `data` is raw
 * base64; the preview `<img>` rebuilds the data URL from `mimeType` + `data`.
 */
export interface PendingAttachment extends AgentImageAttachment {
  id: string
}

/** Thrown when a file can't become an attachment (wrong type, decode failure).
 *  The composer catches it and shows `.message` inline. */
export class AttachmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AttachmentError'
  }
}

/** `data:image/png;base64,AAA…` for a preview or thread `<img>`. */
export function attachmentSrc(att: AgentImageAttachment): string {
  return `data:${att.mimeType};base64,${att.data}`
}

/**
 * Pull image files out of a clipboard or drag payload, ignoring any non-image
 * entries (pasted text, dragged links). Both `ClipboardEvent.clipboardData` and
 * `DragEvent.dataTransfer` are `DataTransfer`, so one helper serves paste and
 * drop. Returns `[]` when there are none so the caller can tell "user pasted an
 * image" from "user pasted text".
 */
export function imageFilesFrom(source: DataTransfer): File[] {
  const out: File[] = []
  // `files` covers drops and most image pastes; `items` catches clients that
  // only expose a pasted image through the items list.
  for (const file of Array.from(source.files)) {
    if (file.type.startsWith('image/')) out.push(file)
  }
  if (out.length === 0) {
    for (const item of Array.from(source.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) out.push(file)
      }
    }
  }
  return out
}

/**
 * Validate + normalise a single image file into a {@link PendingAttachment}.
 * Throws {@link AttachmentError} on an unsupported type or a decode failure.
 */
export async function fileToAttachment(file: File): Promise<PendingAttachment> {
  if (!ALLOWED_IMAGE_MIME.has(file.type)) {
    throw new AttachmentError(
      `"${file.name || 'image'}" is not a supported image. Use PNG, JPEG, WebP, or GIF.`,
    )
  }

  const dataUrl = await readAsDataUrl(file)
  const img = await loadImage(dataUrl)
  const longestEdge = Math.max(img.naturalWidth, img.naturalHeight)

  // Small enough to send verbatim — no re-encode, no quality loss.
  if (longestEdge <= MAX_IMAGE_DIMENSION && file.size <= REENCODE_ABOVE_BYTES) {
    return { id: nanoid(), mimeType: file.type, data: stripDataUrlPrefix(dataUrl) }
  }

  // Downscale the long edge to the cap and re-encode as WebP (small, and
  // universally accepted by the vision providers we target).
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / longestEdge)
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new AttachmentError('This browser could not process the image.')
  ctx.drawImage(img, 0, 0, width, height)
  const webpUrl = canvas.toDataURL('image/webp', 0.9)
  return { id: nanoid(), mimeType: 'image/webp', data: stripDataUrlPrefix(webpUrl) }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new AttachmentError(`Could not read "${file.name || 'image'}".`))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new AttachmentError('That image looks corrupted and could not be loaded.'))
    img.src = src
  })
}

function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
}
