/**
 * PanelResizeHandle — the approved prototype's `PanelResizeHandle`
 * (`prototype-reference/src/StudioScreen.jsx:52-170`), ported unchanged.
 *
 * A `role="separator"` widget rather than a bare drag target: it reports its
 * range through `aria-valuemin/max/now`, moves on the arrow keys (Shift for a
 * coarse step), jumps to either end on Home/End, resets on Enter or a
 * double-click, and abandons a drag on Escape or window blur without
 * committing. `html.studio-resizing` carries the cursor lock so the pointer
 * does not flicker over the iframe it is dragging across.
 */
import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';

export interface PanelResizeHandleProps {
  className: string;
  label: string;
  /** id of the panel this separator sizes. */
  controls: string;
  value: number;
  minimum: number;
  maximum: number;
  defaultValue: number;
  /** `-1` for a handle whose panel lives to its RIGHT (the files handle). */
  dragDirection?: 1 | -1;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

interface DragState {
  pointerId: number;
  startX: number;
  startValue: number;
  currentValue: number;
}

export function PanelResizeHandle({
  className,
  label,
  controls,
  value,
  minimum,
  maximum,
  defaultValue,
  dragDirection = 1,
  onChange,
  onCommit,
}: PanelResizeHandleProps) {
  const drag = useRef<DragState | null>(null);
  // The window listeners are attached once, so they read the live props
  // through this ref instead of being torn down on every width change.
  const latest = useRef({ value, minimum, maximum, onChange, onCommit });
  latest.current = { value, minimum, maximum, onChange, onCommit };

  useEffect(() => {
    const finishDrag = (cancelled = false) => {
      if (!drag.current) return;
      const finalValue = cancelled ? drag.current.startValue : drag.current.currentValue;
      latest.current.onChange(finalValue);
      latest.current.onCommit(finalValue);
      drag.current = null;
      document.documentElement.classList.remove('studio-resizing');
    };

    const moveDrag = (event: PointerEvent) => {
      if (!drag.current || event.pointerId !== drag.current.pointerId) return;
      const delta = (event.clientX - drag.current.startX) * dragDirection;
      const nextValue = clamp(
        drag.current.startValue + delta,
        latest.current.minimum,
        latest.current.maximum,
      );
      drag.current.currentValue = nextValue;
      latest.current.onChange(nextValue);
    };

    const endDrag = (event: PointerEvent) => {
      if (!drag.current || event.pointerId !== drag.current.pointerId) return;
      finishDrag(false);
    };

    const cancelDrag = (event: PointerEvent | Event) => {
      const pointerId = (event as PointerEvent).pointerId;
      if (!drag.current || (pointerId != null && pointerId !== drag.current.pointerId)) return;
      finishDrag(true);
    };

    const cancelWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault();
        finishDrag(true);
      }
    };

    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('blur', cancelDrag);
    window.addEventListener('keydown', cancelWithEscape);
    return () => {
      window.removeEventListener('pointermove', moveDrag);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', cancelDrag);
      window.removeEventListener('blur', cancelDrag);
      window.removeEventListener('keydown', cancelWithEscape);
      document.documentElement.classList.remove('studio-resizing');
    };
  }, [dragDirection]);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: value,
      currentValue: value,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.documentElement.classList.add('studio-resizing');
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    let nextValue: number | undefined;
    if (event.key === 'ArrowRight') nextValue = value + step * dragDirection;
    if (event.key === 'ArrowLeft') nextValue = value - step * dragDirection;
    if (event.key === 'Home') nextValue = minimum;
    if (event.key === 'End') nextValue = maximum;
    if (event.key === 'Enter') nextValue = defaultValue;
    if (nextValue == null) return;
    event.preventDefault();
    const committedValue = clamp(nextValue, minimum, maximum);
    onChange(committedValue);
    onCommit(committedValue);
  };

  return (
    <div
      className={`studio-resize-handle ${className}`}
      role="separator"
      aria-label={label}
      aria-controls={controls}
      aria-orientation="vertical"
      aria-valuemin={Math.round(minimum)}
      aria-valuemax={Math.round(maximum)}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={beginDrag}
      onDoubleClick={() => {
        const resetValue = clamp(defaultValue, minimum, maximum);
        onChange(resetValue);
        onCommit(resetValue);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}
