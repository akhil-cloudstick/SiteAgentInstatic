import type { ControlProps } from './shared'
import { Textarea } from '@ui/components/Input'
import { ControlRow } from '@ui/components/ControlRow'
import { charCounter } from '@site/panels/PropertiesPanel/inspector/charCounter'

interface TextareaControlProps extends ControlProps<string> {
  rows?: number
  placeholder?: string
  /** Hard character limit; also prints the reference's `used/max` counter. */
  maxLength?: number
}

export function TextareaControl({
  propKey,
  value,
  onChange,
  label,
  rows = 3,
  placeholder,
  maxLength,
  isOverride,
  disabled,
  layout,
}: TextareaControlProps) {
  return (
    <ControlRow
      propKey={propKey}
      label={label}
      layout={layout}
      isOverride={isOverride}
      disabled={disabled}
      description={charCounter(value, maxLength)}
    >
      <Textarea
        id={`ctrl-${propKey}`}
        value={value ?? ''}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        onChange={(e) => onChange(propKey, e.target.value)}
      />
    </ControlRow>
  )
}
