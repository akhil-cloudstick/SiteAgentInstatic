import {
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type Ref,
} from 'react'
import { cn } from '@ui/cn'
import { getColorInputValue, getColorSwatchValue } from './ColorInput.utils'
import styles from './ColorInput.module.css'

type ColorInputSize = 'xs' | 'sm' | 'md'

interface ColorInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  fieldSize?: ColorInputSize
  swatchValue?: string
  /** React 19: ref is a regular prop on function components. */
  ref?: Ref<HTMLInputElement>
}

type ColorInputStyle = CSSProperties & { '--color-input-value'?: string }

export function ColorInput({
  className,
  fieldSize = 'sm',
  swatchValue,
  value,
  defaultValue,
  disabled,
  onChange,
  onBlur,
  style,
  ref,
  ...props
}: ColorInputProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(getColorInputValue(defaultValue))

  // The value the OS picker is currently showing, held for as long as the picker
  // is open. The browser dismisses its own picker the instant the input's value
  // is written programmatically, and a controlled `value` does exactly that on
  // every re-render: the owner may not echo the dragged colour back verbatim —
  // it can normalise the format, reject it, or hold a non-hex value such as
  // `transparent` or `var(--token)`, all of which `getColorInputValue` collapses
  // to the `#000000` fallback. Rendering that back mid-drag closed the picker on
  // the first click and made a colour impossible to drag to. Echoing the live
  // value keeps the rendered value identical to the picker's, so nothing is
  // overwritten and the picker stays open until the user dismisses it.
  const [pickerValue, setPickerValue] = useState<string | null>(null)

  const ownerValue = value === undefined ? uncontrolledValue : getColorInputValue(value)
  const currentValue = pickerValue ?? ownerValue
  const displayValue = getColorSwatchValue(swatchValue ?? currentValue)
  const frameStyle: ColorInputStyle = {
    ...style,
    '--color-input-value': displayValue,
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setPickerValue(event.target.value)
    if (value === undefined) {
      setUncontrolledValue(event.target.value)
    }
    onChange?.(event)
  }

  // The picker keeps focus while it is open, so blur means it has closed: hand
  // control back to the owner's value (undo, a token pick, or a rejected edit
  // must all be able to move the swatch again).
  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    setPickerValue(null)
    onBlur?.(event)
  }

  return (
    <span
      className={cn(
        styles.colorInput,
        styles[`size-${fieldSize}`],
        disabled && styles.disabled,
        className,
      )}
      style={frameStyle}
    >
      <span className={styles.preview} aria-hidden="true" />
      <input
        {...props}
        ref={ref}
        type="color"
        value={currentValue}
        disabled={disabled}
        onChange={handleChange}
        onBlur={handleBlur}
        className={styles.nativeInput}
      />
    </span>
  )
}
