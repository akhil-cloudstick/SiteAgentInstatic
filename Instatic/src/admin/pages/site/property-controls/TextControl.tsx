import type { ControlProps } from './shared'
import type { TextControlNormalize } from '@core/module-engine'
import { normalizeIdentifierInput, normalizeIdentifierValue } from '@core/utils/identifier'
import { Input } from '@ui/components/Input'
import { ControlRow } from '@ui/components/ControlRow'
import { charCounter } from '@site/panels/PropertiesPanel/inspector/charCounter'

interface TextControlProps extends ControlProps<string> {
  placeholder?: string
  normalize?: TextControlNormalize
  /** Hard character limit; also prints the reference's `used/max` counter. */
  maxLength?: number
  onInputFocus?: () => void
  onInputBlur?: (value: string) => void
}

export function TextControl({
  propKey,
  value,
  onChange,
  label,
  placeholder,
  normalize,
  maxLength,
  isOverride,
  disabled,
  layout,
  onInputFocus,
  onInputBlur,
}: TextControlProps) {
  function handleChange(nextValue: string) {
    onChange(propKey, normalize === 'identifier' ? normalizeIdentifierInput(nextValue) : nextValue)
  }

  function handleBlur(nextValue: string) {
    if (normalize === 'identifier') {
      const normalized = normalizeIdentifierValue(nextValue)
      if (normalized !== value) onChange(propKey, normalized)
    }
    onInputBlur?.(nextValue)
  }

  return (
    <ControlRow
      propKey={propKey}
      label={label}
      layout={layout}
      isOverride={isOverride}
      disabled={disabled}
      description={charCounter(value, maxLength)}
    >
      <Input
        id={`ctrl-${propKey}`}
        type="text"
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        fieldSize="sm"
        autoCapitalize={normalize === 'identifier' ? 'none' : undefined}
        spellCheck={normalize === 'identifier' ? false : undefined}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={onInputFocus}
        onBlur={(e) => handleBlur(e.target.value)}
      />
    </ControlRow>
  )
}
