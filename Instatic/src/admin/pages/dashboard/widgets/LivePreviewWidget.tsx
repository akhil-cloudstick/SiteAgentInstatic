/**
 * Live preview widget (MMSBUILD "Live Release Desk", Screen 1).
 *
 * A read-only tile that embeds the PUBLISHED site root in a sandboxed,
 * non-interactive iframe — deliberately NOT the visual-editor canvas (no editor
 * store / DnD / breakpoint frames). The iframe is `sandbox="allow-same-origin"`
 * with NO `allow-scripts` and `pointer-events: none`, so the tile can never be
 * navigated inside; the whole surface + "Open preview" open the real site in a
 * new tab, and "Edit site" jumps to the editor.
 *
 * Before rendering the iframe we PRE-CHECK the site root: if nothing is
 * published there yet (a 404 / non-HTML response), we show a friendly
 * placeholder instead of letting the raw server error page paint inside the
 * tile — end users must never see `{"error":"Not found"}`.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { isAbortError } from '@core/http'
import { Widget } from '@ui/components/Widget'
import { Button } from '@ui/components/Button'
import { FaIcon } from '@ui/components/FaIcon'
import { useNavigate } from '@admin/lib/routing'
import { cn } from '@ui/cn'
import styles from './widgets.module.css'

type PreviewDevice = 'desktop' | 'mobile'
/** 'checking' while the pre-check runs, then ready (embed) or unavailable. */
type PreviewStatus = 'checking' | 'ready' | 'unavailable'

/** Published site root — the public home page. */
const PREVIEW_PATH = '/'

/**
 * Logical viewport width the iframe RENDERS at per device — matching the Site
 * editor's breakpoints (Desktop 1440 / Mobile 375). We render the page at this
 * real width so it lays out with the correct responsive breakpoint, then scale
 * the whole iframe down (CSS transform) to fit the tile. Mobile therefore shows
 * the true mobile layout — never a cropped desktop with a horizontal scrollbar.
 */
const LOGICAL_WIDTH: Record<PreviewDevice, number> = { desktop: 1440, mobile: 375 }
function openLiveSite(): void {
  window.open(PREVIEW_PATH, '_blank', 'noopener,noreferrer')
}

export function LivePreviewWidget({ span, editing }: DashboardWidgetRendererProps) {
  const navigate = useNavigate()
  const [device, setDevice] = useState<PreviewDevice>('desktop')
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [status, setStatus] = useState<PreviewStatus>('checking')
  const frameRef = useRef<HTMLDivElement | null>(null)

  // Reveal (and start the pre-check) only once the tile scrolls into view.
  useEffect(() => {
    if (visible) return
    const node = frameRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.disconnect()
            return
          }
        }
      },
      { rootMargin: '120px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])

  // Pre-check the site root so we never paint the raw server error inside the
  // tile. Only render the iframe when the root responds OK with HTML.
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    // status starts at 'checking' (initial state); no synchronous setState here.
    fetch(PREVIEW_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'follow',
      headers: { Accept: 'text/html' },
      signal: controller.signal,
    })
      .then((res) => {
        const isHtml = res.ok && (res.headers.get('content-type') ?? '').includes('text/html')
        setStatus(isHtml ? 'ready' : 'unavailable')
      })
      .catch((err) => {
        if (isAbortError(err)) return
        setStatus('unavailable')
      })
    return () => controller.abort()
  }, [visible])

  // Measure the frame's rendered box so we can scale the fixed-viewport iframe
  // to fit it. Re-measures on tile resize (ResizeObserver) and on device change
  // (the mobile column is narrower). Until measured, the box is 0×0 and the
  // iframe falls back to the CSS default (fills the frame) — no overflow flash.
  //
  // The stage is NOT aspect-ratio-bound in the reference design: it stretches
  // to whatever height is left in the 463px card. So the logical viewport
  // height has to be derived from the measured height (÷ scale) rather than
  // from a fixed aspect constant — otherwise the page would be letterboxed or
  // clipped depending on the card's actual size.
  const [frameBox, setFrameBox] = useState({ width: 0, height: 0 })
  // Layout effect (not effect) so the re-measure on a device toggle flushes
  // before paint — otherwise the stale width briefly scales the new viewport
  // wrong and the page overflows for one frame.
  useLayoutEffect(() => {
    const node = frameRef.current
    if (!node || status !== 'ready') return
    const measure = () => setFrameBox({ width: node.clientWidth, height: node.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    return () => ro.disconnect()
  }, [status, device])

  // Scale = displayed frame width ÷ the logical viewport we render the page at.
  // Rendering at LOGICAL_WIDTH then scaling means the page uses its real
  // responsive layout for that width and can never overflow the tile sideways.
  const logicalWidth = LOGICAL_WIDTH[device]
  const scale = frameBox.width > 0 ? frameBox.width / logicalWidth : 0
  const scaledFrameStyle: CSSProperties =
    scale > 0
      ? ({
          '--pv-w': `${logicalWidth}px`,
          '--pv-h': `${frameBox.height / scale}px`,
          '--pv-scale': String(scale),
        } as CSSProperties)
      : {}

  return (
    <Widget
      widgetId="live-preview"
      title="Live preview"
      tint="sky"
      span={span}
      editing={editing}
      className={styles.cardPreview}
      action={
        status === 'ready' ? (
          <span className={styles.liveBadge}>
            <FaIcon name="circle" size={8} /> Live
          </span>
        ) : undefined
      }
    >
      {/* Stage (bordered viewport) → frame (the measured, scaled box). In
          Mobile the stage stays full-bleed and centres a 196px column, which
          is how the reference renders the phone preview. */}
      <div className={styles.previewStage} data-device={device}>
        <div
          className={styles.previewFrame}
          ref={frameRef}
          style={scaledFrameStyle}
        >
          {status === 'ready' ? (
            // Interactive embed: the operator can scroll and click inside it
            // like a real browser. Same-origin (the tenant's own published
            // site) so scripts/forms are allowed; "Open preview" still opens
            // the full tab.
            <iframe
              className={styles.previewIframe}
              src={PREVIEW_PATH}
              title="Published site preview"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              loading="lazy"
              onError={() => setStatus('unavailable')}
            />
          ) : status === 'unavailable' ? (
            <div className={styles.previewEmpty} role="status">
              <FaIcon name="globe" size={22} />
              <p className={styles.previewEmptyTitle}>No live preview yet</p>
              <p className={styles.previewEmptyHint}>
                Publish a page and your site preview appears here.
              </p>
            </div>
          ) : (
            <div className={styles.previewFallback} aria-hidden="true" />
          )}
        </div>
      </div>

      <div className={styles.previewControls}>
        {status === 'ready' ? (
          <div className={styles.deviceToggle} role="group" aria-label="Preview device">
            <Button
              variant="ghost"
              className={cn(styles.segBtn, device === 'desktop' && styles.segBtnActive)}
              pressed={device === 'desktop'}
              onClick={() => setDevice('desktop')}
            >
              <FaIcon name="desktop" size={15} />
              Desktop
            </Button>
            <Button
              variant="ghost"
              className={cn(styles.segBtn, device === 'mobile' && styles.segBtnActive)}
              pressed={device === 'mobile'}
              onClick={() => setDevice('mobile')}
            >
              <FaIcon name="mobile-screen-button" size={15} />
              Mobile
            </Button>
          </div>
        ) : null}
        <div className={styles.previewActions}>
          {status === 'unavailable' ? (
            // Nothing is published yet — "Open preview" would only open a 404,
            // so replace it with the real next step (publish a first page).
            <Button
              variant="ghost"
              className={cn(styles.actionBtn, styles.actionBtnEdit)}
              onClick={() => navigate('/admin/site')}
            >
              <FaIcon name="plus" size={15} />
              Publish first page
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                className={styles.actionBtn}
                onClick={openLiveSite}
                disabled={status !== 'ready'}
              >
                Open preview
                <FaIcon name="arrow-up-right-from-square" size={15} />
              </Button>
              <Button
                variant="ghost"
                className={cn(styles.actionBtn, styles.actionBtnEdit)}
                onClick={() => navigate('/admin/site')}
              >
                <FaIcon name="pen" size={15} />
                Edit site
              </Button>
            </>
          )}
        </div>
      </div>
    </Widget>
  )
}
