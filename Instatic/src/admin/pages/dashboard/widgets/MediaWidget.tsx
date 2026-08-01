/**
 * Media widget — total file count + a 16-cell thumbnail mosaic. When
 * the host has uploaded media, the mosaic renders the 16 most-recent
 * image thumbnails via the shared `<Image>` primitive (srcset-aware
 * from the variant ladder). When no media is uploaded yet, falls back
 * to the decorative coloured tiles the original design shipped with.
 *
 * Clicking a thumbnail opens the standard `MediaViewerWindow` — the
 * same draggable asset viewer the Media page and the Content page's
 * featured-media field use, so authors can jump straight from the
 * dashboard preview into editing alt text / caption / tags / replace
 * the file. The widget lazy-loads the full asset list on first click
 * (the dashboard stats payload only carries thumbnail-shaped data, not
 * the full `CmsMediaAsset` the viewer needs) and reuses it for every
 * subsequent click.
 */
import { useEffect, useState } from 'react'
import { ImageSolidIcon } from 'pixel-art-icons/icons/image-solid'
import { FaIcon } from '@ui/components/FaIcon'
import { StatValue } from '@ui/components/charts'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '@ui/components/Widget'
import { Image } from '@ui/components/Image'
import { Button } from '@ui/components/Button'
import { listCmsMediaAssets, type CmsMediaAsset } from '@core/persistence/cmsMedia'
import { MediaViewerWindow } from '@admin/pages/media/components/MediaViewerWindow/MediaViewerWindow'
import { useStandaloneMediaEditor } from '@admin/pages/media/hooks/useStandaloneMediaEditor'
import { useMediaStats } from '../hooks/useDashboardStats'
import { WidgetPlaceholder } from './WidgetPlaceholder'
import styles from './widgets.module.css'

// Indexes that get the accent tint vs. the muted surface in the
// decorative empty state. Matches the original static design.

function formatSize(bytes: number): string {
  // Human-readable size — drops decimals for KB/MB but keeps one
  // significant decimal for GB/TB so "1.4 GB" reads naturally.
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function MediaWidget({ span, editing }: DashboardWidgetRendererProps) {
  const { data: stats, loading } = useMediaStats()
  const isLoading = loading
  const count = stats?.count
  const totalBytes = stats?.totalBytes
  const thumbs = stats?.latestThumbs ?? []

  // Full asset list — lazy-loaded on first thumbnail click so we can
  // hand the MediaViewerWindow a real `CmsMediaAsset` (the dashboard
  // stats endpoint only ships thumbnail-shaped data). Kept in widget
  // state so successive clicks reuse the same list.
  const [assets, setAssets] = useState<CmsMediaAsset[]>([])
  const [assetsLoaded, setAssetsLoaded] = useState(false)
  const [viewerAssetId, setViewerAssetId] = useState<string | null>(null)

  // Resolve the asset for the current viewer selection from our local
  // cache. While the cache is loading the viewer waits to mount —
  // `viewerOpen` is gated on a resolved asset so we don't flash an
  // empty window during the fetch.
  const viewerAsset = viewerAssetId ? assets.find((a) => a.id === viewerAssetId) ?? null : null

  const viewerEditor = useStandaloneMediaEditor({
    asset: viewerAsset,
    assets,
    onAssetChanged: (asset) =>
      setAssets((current) => current.map((item) => (item.id === asset.id ? asset : item))),
    onAssetRemoved: (id) => {
      setAssets((current) => current.filter((item) => item.id !== id))
      if (viewerAssetId === id) setViewerAssetId(null)
    },
  })

  // Load the full media list whenever a thumbnail click is pending.
  // We don't pre-fetch on widget mount — the dashboard tries to stay
  // light, and the user may never click a thumb.
  useEffect(() => {
    if (viewerAssetId === null || assetsLoaded) return
    let cancelled = false
    void (async () => {
      try {
        const list = await listCmsMediaAssets()
        if (!cancelled) {
          setAssets(list)
          setAssetsLoaded(true)
        }
      } catch (err) {
        console.error('[MediaWidget] failed to load media list:', err)
        if (!cancelled) {
          // Reset the requested id so the user can retry — leaving it
          // would mean the viewer never opens because `viewerAsset`
          // would stay null and the load wouldn't be retried.
          setViewerAssetId(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [viewerAssetId, assetsLoaded])

  const openViewer = (assetId: string) => {
    setViewerAssetId(assetId)
  }

  const closeViewer = () => {
    setViewerAssetId(null)
  }

  return (
    <>
      <Widget
        widgetId="media"
        title="Media"
        icon={ImageSolidIcon}
        tint="peach"
        span={span}
        editing={editing}
        loading={isLoading}
      >
        {!isLoading && (<>
        <StatValue
          value={(count ?? 0).toLocaleString()}
          sub={<span>files · {formatSize(totalBytes ?? 0)}</span>}
        />
        {thumbs.length > 0 ? (
          // `.media-samples` in the approved screen: a short row of
          // overlapping 38px rounded squares, not a 16-cell mosaic. Real
          // thumbnails fill them — same design, real data.
          <div className={styles.mediaSamples} aria-label={`${count ?? 0} media files`}>
            {thumbs.slice(0, 7).map((thumb) => (
              <Button
                key={thumb.id}
                variant="ghost"
                size="sm"
                onClick={() => openViewer(thumb.id)}
                aria-label={`Open ${thumb.altText || 'media asset'} in viewer`}
                tooltip="Open in viewer"
              >
                <Image
                  src={thumb.publicPath}
                  variants={thumb.variants}
                  alt={thumb.altText}
                  sizes="38px"
                  width={thumb.width ?? undefined}
                  height={thumb.height ?? undefined}
                  className={styles.mediaSampleImg}
                />
              </Button>
            ))}
          </div>
        ) : (
          <div className={styles.mediaSamples} aria-hidden="true">
            {['building', 'image', 'camera', 'mountain-sun', 'city', 'file-image', 'panorama'].map(
              (icon) => (
                <span key={icon}>
                  <FaIcon name={icon} size={15} />
                </span>
              ),
            )}
          </div>
        )}
        </>)}
        {!loading && !stats && (
        <WidgetPlaceholder
          reason="unavailable"
          icon="images"
          title="No media yet"
          detail="Images and files you upload show up here."
        />
      )}
    </Widget>

      <MediaViewerWindow
        editor={viewerEditor}
        open={viewerAsset !== null}
        onClose={closeViewer}
      />
    </>
  )
}
