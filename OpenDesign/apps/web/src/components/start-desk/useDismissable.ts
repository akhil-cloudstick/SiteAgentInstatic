/**
 * useDismissable — the Start Desk's popover dismissal contract.
 *
 * A menu that only closes when you click its trigger again is a trap: the
 * approved prototype has exactly that bug, and in a scrolling page it is worse
 * than cosmetic, because an absolutely-positioned panel detaches from its
 * trigger the moment the page moves under it. So this closes on all four of:
 *
 *   - a pointer press outside the panel AND outside its trigger
 *   - a scroll anywhere in the ancestor chain (capture phase, so the app's own
 *     scroll container counts, not just the window)
 *   - Escape — which also returns focus to the trigger, so keyboard users are
 *     not dropped at the top of the document
 *   - a viewport resize, for the same reason as scroll
 *
 * `pointerdown` rather than `click`: closing on press matches every native
 * menu, and it fires before the pressed element's own handler, so clicking
 * straight from one open menu onto another control does the expected thing
 * instead of needing two clicks.
 *
 * Listeners exist only while the popover is open, so a page full of closed
 * menus costs nothing.
 */
import { useEffect, type RefObject } from 'react';

export interface DismissableOptions {
  /** Nothing is bound while this is false. */
  open: boolean;
  /** The panel. A press inside it is not a dismissal. */
  panelRef: RefObject<HTMLElement | null>;
  /**
   * The control that opened it. Excluded from the outside test so its own
   * toggle handler runs instead of being pre-empted by a close.
   */
  triggerRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
  /**
   * Move focus back to the trigger after an Escape dismissal. Off for
   * popovers whose trigger is unmounting with them.
   */
  restoreFocus?: boolean;
}

export function useDismissable({
  open,
  panelRef,
  triggerRef,
  onDismiss,
  restoreFocus = true,
}: DismissableOptions): void {
  useEffect(() => {
    if (!open) return;

    const isInside = (target: EventTarget | null): boolean => {
      if (!(target instanceof Node)) return false;
      return Boolean(panelRef.current?.contains(target) || triggerRef.current?.contains(target));
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (isInside(event.target)) return;
      onDismiss();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      onDismiss();
      if (restoreFocus) triggerRef.current?.focus();
    };

    // Capture, because the element that actually scrolls is a descendant of
    // document (`.entry-main`), and scroll does not bubble.
    const onScroll = (event: Event): void => {
      // A scroll INSIDE the panel is the user reading a long menu, not leaving
      // it. Only movement of the page beneath the panel dismisses.
      if (isInside(event.target)) return;
      onDismiss();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onDismiss);
    };
  }, [open, panelRef, triggerRef, onDismiss, restoreFocus]);
}
