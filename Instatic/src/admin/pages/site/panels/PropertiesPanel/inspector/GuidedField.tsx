/**
 * GuidedField — the approved Site screen's `.field`, in its two guided forms.
 *
 * `ControlRow` already carries the reference's field geometry inside the Site
 * scope (stacked label above a full-width control, 11px/620 label, 9px/450
 * helper, 13px bottom margin). `SegmentField` adds the one thing a plain
 * control row has no concept of: a `.segmented` picker as the field's control,
 * which is how every guided CSS control in Responsive review is drawn.
 *
 * The field's other reference affordance, the `25/100` counter, is plain text
 * rather than a component — see `./charCounter`.
 */
import type { ReactNode } from 'react'
import { ControlRow } from '@ui/components/ControlRow'
import { SegmentedControl } from '@ui/components/SegmentedControl'
import { FaIcon } from '@ui/components/FaIcon'
import { cn } from '@ui/cn'
import styles from './Inspector.module.css'

export interface SegmentOption<T extends string> {
  value: T
  /** Visible label. Omit for glyph-only segments (the `.icon-segment` form). */
  label?: string
  /** Font Awesome glyph name without the `fa-` prefix. */
  glyph?: string
  /** Required when the segment is glyph-only. */
  ariaLabel?: string
}

interface SegmentFieldProps<T extends string> {
  propKey: string
  label: string
  value: T | undefined
  options: ReadonlyArray<SegmentOption<T>>
  onChange: (next: T) => void
  description?: ReactNode
}

/**
 * A labelled `.segmented` control — the reference's Content width, Text
 * alignment, Image position and Editing context fields.
 */
export function SegmentField<T extends string>({
  propKey,
  label,
  value,
  options,
  onChange,
  description,
}: SegmentFieldProps<T>) {
  const iconOnly = options.every((option) => option.label === undefined)

  return (
    <ControlRow propKey={propKey} label={label} layout="stacked" description={description}>
      <SegmentedControl
        fullWidth
        className={cn(iconOnly && styles.iconSegment)}
        aria-label={label}
        data-testid={`guided-${propKey}`}
        value={value}
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
          ariaLabel: option.ariaLabel ?? option.label,
          icon: option.glyph ? <FaIcon name={option.glyph} size={16} /> : undefined,
        }))}
        onChange={onChange}
      />
    </ControlRow>
  )
}
