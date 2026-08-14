/**
 * ViewportSwitcher — the approved prototype's `<details>` viewport menu
 * (`prototype-reference/src/Workspace.jsx:134-170`, styles
 * `prototype-reference/src/styles.css:2211-2283`).
 *
 * It replaces the segmented Desktop/Tablet/Mobile control that used to sit in
 * the viewer toolbar. The build kit explicitly allows the move — "Use one
 * Desktop/Tablet/Mobile viewport selector. MMSBUILD may place it in the
 * right-side toolbar area while preserving upstream option semantics"
 * (OPEN-DESIGN-DEVELOPER-BUILD-INSTRUCTIONS §4) — and the three options carry
 * exactly the upstream ids and dimensions.
 */
import { useEffect, useRef } from 'react';
import { FaIcon } from '@mms/shell';
import { useT } from '../../i18n';

export type StudioViewportId = 'desktop' | 'tablet' | 'mobile';

const OPTIONS: Array<{ id: StudioViewportId; icon: string }> = [
  { id: 'desktop', icon: 'globe' },
  { id: 'tablet', icon: 'tablet-screen-button' },
  { id: 'mobile', icon: 'mobile-screen-button' },
];

export interface ViewportSwitcherProps {
  viewport: StudioViewportId;
  onViewport: (viewport: StudioViewportId) => void;
}

export function ViewportSwitcher({ viewport, onViewport }: ViewportSwitcherProps) {
  const t = useT();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selected = OPTIONS.find((option) => option.id === viewport) ?? OPTIONS[0]!;

  const label = (id: StudioViewportId) =>
    id === 'desktop'
      ? t('fileViewer.viewportDesktop')
      : id === 'tablet'
        ? t('fileViewer.viewportTablet')
        : t('fileViewer.viewportMobile');

  // Widths mirror `PREVIEW_VIEWPORT_PRESETS`; the frame fills the stage
  // vertically, so only the width is a promise worth printing.
  const detail = (id: StudioViewportId) =>
    id === 'desktop' ? t('studio.viewportFullWidth') : id === 'tablet' ? '744 px' : '360 px';

  // The prototype left the menu open when the pointer moved elsewhere. A
  // `<details>` has no dismissal of its own, so close it on an outside
  // pointerdown and on Escape — the same contract every other popover on this
  // screen honours.
  useEffect(() => {
    const node = detailsRef.current;
    if (!node) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!node.open) return;
      if (!node.contains(event.target as Node)) node.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !node.open) return;
      node.open = false;
      window.requestAnimationFrame(() => node.querySelector('summary')?.focus());
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return (
    <details className="viewport-switcher" ref={detailsRef}>
      <summary aria-label={`${t('fileViewer.viewportAria')}: ${label(selected.id)}`}>
        <FaIcon name={selected.icon} size={13} />
        <span>{label(selected.id)}</span>
        <FaIcon name="chevron-down" size={9} className="viewport-chevron" />
      </summary>
      <div className="viewport-menu" role="menu" aria-label={t('fileViewer.viewportAria')}>
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="menuitemradio"
            aria-checked={viewport === option.id}
            className={viewport === option.id ? 'active' : ''}
            onClick={() => {
              onViewport(option.id);
              if (detailsRef.current) detailsRef.current.open = false;
            }}
          >
            <FaIcon name={option.icon} size={13} />
            <span>{label(option.id)}</span>
            <small>{detail(option.id)}</small>
          </button>
        ))}
      </div>
    </details>
  );
}
