/**
 * SelectButton — the approved prototype's `.select-button`
 * (`prototype-reference/src/ui.jsx:43-51`, styles `styles.css:520-535`).
 *
 * A leading Font Awesome glyph, an ellipsised label, and a trailing 8px
 * chevron. It is a disclosure trigger, not a `<select>`: on the Studio toolbar
 * both instances open an anchored popover.
 */
import type { ReactNode, Ref } from 'react';
import { FaIcon } from '@mms/shell';

export interface SelectButtonProps {
  /** Font Awesome Solid glyph name without the `fa-` prefix. */
  icon: string;
  children: ReactNode;
  className?: string;
  title?: string;
  'aria-label'?: string;
  'aria-haspopup'?: 'menu' | 'dialog' | 'listbox' | 'true';
  'aria-expanded'?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

export function SelectButton({
  icon,
  children,
  className,
  title,
  disabled,
  onClick,
  buttonRef,
  'aria-label': ariaLabel,
  'aria-haspopup': ariaHasPopup,
  'aria-expanded': ariaExpanded,
}: SelectButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={className ? `select-button ${className}` : 'select-button'}
      title={title}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
    >
      <FaIcon name={icon} size={14} />
      <span>{children}</span>
      <FaIcon name="chevron-down" size={8} className="fa-chevron-down" />
    </button>
  );
}
