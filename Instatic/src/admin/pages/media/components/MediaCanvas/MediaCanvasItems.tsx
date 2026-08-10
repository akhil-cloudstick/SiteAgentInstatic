/**
 * Grid / list items for the Media canvas.
 *
 * Transcribed from the MMSBUILD Media reference (`screens/media/src/App.jsx`
 * → `.asset-card`, `.checkmark`, `.asset-select`, `.asset-visual`,
 * `.type-badge`, `.asset-copy`, `.folder-tiles`), with the approved masters'
 * colours — notably the amber folder glyph, which the runnable reference
 * draws in green.
 *
 * `AssetTile` and `AssetRow` are also rendered by the Data workspace's
 * `MediaRepeaterGallery`, so their prop contract is deliberately stable.
 */
import type {
  CSSProperties,
  DragEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from 'react'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { cn } from '@ui/cn'
import type { CmsMediaAsset, CmsMediaFolder } from '@core/persistence/cmsMedia'
import type { FolderSelection } from '../../hooks/useMediaWorkspace'
import { assetTypeLabel, bucketForMime } from '../../utils/filters'
import { blurHashToDataUrl, pickVariantUrl } from '../../utils/variants'
import { formatBytes } from '../../utils/formatBytes'
import styles from './MediaCanvas.module.css'

export interface ParentFolderEntry {
  label: string
  targetFolderId: string | null
  selection: FolderSelection
}

interface AssetItemProps {
  asset: CmsMediaAsset
  selected: boolean
  canDrag: boolean
  disabled?: boolean
  ariaLabel?: string
  actions?: ReactNode
  /** Renders the reference's hover/selection checkmark. Off in picker mode. */
  showCheckmark?: boolean
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void
  onToggleSelect?: (event: MouseEvent<HTMLButtonElement>) => void
  onDragStart?: (asset: CmsMediaAsset, event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: () => void
  onContextMenu?: (asset: CmsMediaAsset, event: MouseEvent<HTMLButtonElement>) => void
  onKeyboardMenu?: (asset: CmsMediaAsset, event: KeyboardEvent<HTMLButtonElement>) => void
}

// Target widths (CSS px) for the two view modes. Picked so a 1x display
// fetches the next-bigger variant. DPR-aware picking happens inside
// pickVariantUrl.
const TILE_CSS_WIDTH = 200
const ROW_CSS_WIDTH = 92

/**
 * The reference's third caption line is `size · date`, e.g. `1.8 MB · 30 Jul
 * 2026` — the upload date, not the file type.
 */
function formatUpdated(asset: CmsMediaAsset): string {
  try {
    return new Date(asset.createdAt).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return assetTypeLabel(asset.mimeType)
  }
}

/** Glyph that stands in for an asset with no renderable thumbnail. */
function glyphForAsset(asset: CmsMediaAsset): string {
  const bucket = bucketForMime(asset.mimeType)
  if (bucket === 'video') return 'video'
  if (bucket === 'image') return 'image'
  if (asset.mimeType.startsWith('font/')) return 'font'
  return 'file-lines'
}

function previewStyleFor(asset: CmsMediaAsset): CSSProperties | undefined {
  const blurUrl = bucketForMime(asset.mimeType) === 'image'
    ? blurHashToDataUrl(asset.blurHash)
    : null
  return blurUrl
    ? ({ backgroundImage: `url(${blurUrl})`, backgroundSize: 'cover' } as CSSProperties)
    : undefined
}

export function AssetTile({
  asset,
  selected,
  canDrag,
  disabled = false,
  ariaLabel,
  actions,
  showCheckmark = false,
  onSelect,
  onToggleSelect,
  onDragStart,
  onDragEnd,
  onContextMenu,
  onKeyboardMenu,
}: AssetItemProps) {
  const bucket = bucketForMime(asset.mimeType)
  const thumbUrl = bucket === 'image' ? pickVariantUrl(asset, TILE_CSS_WIDTH) : null
  return (
    <li className={styles.tileItem} data-has-actions={actions ? 'true' : undefined}>
      <Button
        variant="ghost"
        size="sm"
        pressed={selected}
        draggable={canDrag}
        disabled={disabled}
        aria-label={ariaLabel ?? `Open ${asset.filename}`}
        className={cn(styles.tile, selected && styles.tileSelected)}
        onClick={(event) => onSelect(event)}
        onDragStart={onDragStart ? (event) => onDragStart(asset, event) : undefined}
        onDragEnd={onDragEnd}
        onContextMenu={onContextMenu ? (event) => onContextMenu(asset, event) : undefined}
        onKeyDown={onKeyboardMenu ? (event) => onKeyboardMenu(asset, event) : undefined}
      >
        <span className={styles.tilePreview} aria-hidden="true" style={previewStyleFor(asset)}>
          {bucket === 'image' && thumbUrl ? (
            <img
              src={thumbUrl}
              alt=""
              className={styles.tileImage}
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          ) : bucket === 'video' ? (
            <video
              src={asset.publicPath}
              preload="metadata"
              muted
              className={styles.tileVideo}
              draggable={false}
            />
          ) : (
            <FaIcon name={glyphForAsset(asset)} size={26} />
          )}
          {bucket === 'video' && (
            <span className={styles.typeBadge}>
              <FaIcon name="play" size={9} />
              <span>Video</span>
            </span>
          )}
        </span>
        {/* The reference's three lines: display title, filename, then
            `size · date`. Title falls back to "Untitled" rather than
            repeating the filename on the line above. */}
        <span className={styles.tileBody}>
          <span className={styles.tileTitle}>{asset.title || 'Untitled'}</span>
          <span className={styles.tileLabel}>{asset.filename}</span>
          <span className={styles.tileMeta}>
            {formatBytes(asset.sizeBytes)} · {formatUpdated(asset)}
          </span>
        </span>
      </Button>
      {showCheckmark && onToggleSelect && (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          pressed={selected}
          aria-label={`${selected ? 'Remove' : 'Add'} ${asset.filename} ${selected ? 'from' : 'to'} selection`}
          className={styles.checkmark}
          onClick={(event) => onToggleSelect(event)}
        >
          <FaIcon name={selected ? 'check' : 'plus'} size={12} />
        </Button>
      )}
      {actions && <span className={styles.itemActions}>{actions}</span>}
    </li>
  )
}

export function AssetRow({
  asset,
  selected,
  canDrag,
  disabled = false,
  ariaLabel,
  actions,
  showCheckmark = false,
  onSelect,
  onToggleSelect,
  onDragStart,
  onDragEnd,
  onContextMenu,
  onKeyboardMenu,
}: AssetItemProps) {
  const bucket = bucketForMime(asset.mimeType)
  const thumbUrl = bucket === 'image' ? pickVariantUrl(asset, ROW_CSS_WIDTH) : null
  return (
    <li className={styles.rowItem} data-has-actions={actions ? 'true' : undefined}>
      <Button
        variant="ghost"
        size="sm"
        pressed={selected}
        draggable={canDrag}
        disabled={disabled}
        aria-label={ariaLabel ?? `Open ${asset.filename}`}
        className={cn(styles.row, selected && styles.rowSelected)}
        onClick={(event) => onSelect(event)}
        onDragStart={onDragStart ? (event) => onDragStart(asset, event) : undefined}
        onDragEnd={onDragEnd}
        onContextMenu={onContextMenu ? (event) => onContextMenu(asset, event) : undefined}
        onKeyDown={onKeyboardMenu ? (event) => onKeyboardMenu(asset, event) : undefined}
      >
        <span className={styles.rowPreview} aria-hidden="true" style={previewStyleFor(asset)}>
          {bucket === 'image' && thumbUrl ? (
            <img
              src={thumbUrl}
              alt=""
              className={styles.rowImage}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <FaIcon name={glyphForAsset(asset)} size={18} />
          )}
        </span>
        {/* Same three lines as the tile — title, filename, `size · date` —
            each on its own row. */}
        <span className={styles.rowBody}>
          <span className={styles.rowLabel}>{asset.title || 'Untitled'}</span>
          <span className={styles.rowMeta}>{asset.filename}</span>
          <span className={styles.rowSubMeta}>
            {formatBytes(asset.sizeBytes)} · {formatUpdated(asset)}
          </span>
        </span>
      </Button>
      {showCheckmark && onToggleSelect && (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          pressed={selected}
          aria-label={`${selected ? 'Remove' : 'Add'} ${asset.filename} ${selected ? 'from' : 'to'} selection`}
          className={styles.checkmark}
          onClick={(event) => onToggleSelect(event)}
        >
          <FaIcon name={selected ? 'check' : 'plus'} size={12} />
        </Button>
      )}
      {actions && <span className={styles.itemActions}>{actions}</span>}
    </li>
  )
}

interface FolderTileProps {
  /** `null` renders the parent-folder ("go up") entry. */
  folder: CmsMediaFolder | null
  label: string
  meta: string
  dropActive: boolean
  canDrag: boolean
  onOpen: () => void
  onDragStart?: (folder: CmsMediaFolder, event: DragEvent<HTMLButtonElement>) => void
  onDragOver: (event: DragEvent<HTMLButtonElement>, targetFolderId: string | null) => void
  onDragLeave: (event: DragEvent<HTMLButtonElement>) => void
  onDrop: (event: DragEvent<HTMLButtonElement>) => void
  /** Drop target id — the folder's own id, or the parent's for a "go up" tile. */
  dropTargetId: string | null
}

/**
 * One folder card in the row above the asset grid. The approved masters draw
 * a bare amber folder glyph with no chip behind it, a bold name, an item
 * count and a trailing chevron.
 */
export function FolderTile({
  folder,
  label,
  meta,
  dropActive,
  canDrag,
  onOpen,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  dropTargetId,
}: FolderTileProps) {
  const isParent = folder === null
  return (
    <li className={styles.folderTileItem}>
      <Button
        variant="ghost"
        size="sm"
        draggable={canDrag && !isParent}
        aria-label={isParent ? `Back to ${label}` : `Open folder ${label}`}
        className={cn(styles.folderTile, dropActive && styles.folderTileDropActive)}
        onClick={onOpen}
        onDragStart={
          folder && onDragStart ? (event) => onDragStart(folder, event) : undefined
        }
        onDragEnd={onDragLeave}
        onDragOver={(event) => onDragOver(event, dropTargetId)}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <span className={styles.folderTileIcon} aria-hidden="true">
          <FaIcon name={isParent ? "folder-open" : "folder"} size={18} />
        </span>
        <span className={styles.folderTileBody}>
          <span className={styles.folderTileName}>{label}</span>
          <span className={styles.folderTileMeta}>{meta}</span>
        </span>
        <span className={styles.folderTileChevron} aria-hidden="true">
          <FaIcon name={isParent ? 'arrow-up' : 'chevron-right'} size={11} />
        </span>
      </Button>
    </li>
  )
}
