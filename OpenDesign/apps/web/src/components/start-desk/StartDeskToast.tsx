/**
 * StartDeskToast — the screen's one notice surface.
 *
 * The approved Start Desk answers every action that does not navigate with a
 * short confirmation at the bottom-right, then clears itself. Before this, the
 * Start Desk's `onNotice` fed a state field nothing rendered, so pressing Send
 * without a URL, or picking a start, looked like the click had been swallowed.
 *
 * One live region, `role="status"`, so a screen reader hears each notice once
 * without the announcement stealing focus from the composer.
 */
import { useEffect } from 'react';

/** The reference's dwell time. Long enough to read a sentence, short enough not to nag. */
const DISMISS_AFTER_MS = 2600;

export interface StartDeskNotice {
  text: string;
  /**
   * A failure and an acknowledgement must not look alike. `success` is the
   * reference's green check; `error` swaps the glyph and the accent so a
   * "could not reach the daemon" never appears under a tick. `info` is for
   * guidance about a step not yet taken ("paste the target URL") — it is
   * neither, and showing it as either misreads the situation to the user.
   */
  tone: 'success' | 'error' | 'info';
}

export interface StartDeskToastProps {
  /** Null renders nothing — the toast has no idle shape. */
  notice: StartDeskNotice | null;
  onDismiss: () => void;
}

export function StartDeskToast({ notice, onDismiss }: StartDeskToastProps) {
  const text = notice?.text ?? '';

  useEffect(() => {
    if (!text) return undefined;
    const timer = window.setTimeout(onDismiss, DISMISS_AFTER_MS);
    // Keyed on the text, so a second notice arriving mid-dwell restarts the
    // clock rather than inheriting the remainder of the first one's.
    return () => window.clearTimeout(timer);
  }, [text, onDismiss]);

  if (!notice || !text) return null;

  const failed = notice.tone === 'error';

  return (
    // `alert` for a failure so it is announced immediately; `status` for an
    // acknowledgement so it waits its turn and does not interrupt typing.
    <div className="sd-toast" data-tone={notice.tone} role={failed ? 'alert' : 'status'}>
      <i
        className={`fa-solid fa-${
          failed ? 'circle-exclamation' : notice.tone === 'info' ? 'circle-info' : 'circle-check'
        }`}
        aria-hidden="true"
      />
      {text}
    </div>
  );
}
