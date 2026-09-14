import { useState, type ReactNode, type CSSProperties } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { BaseDropdown, type DropdownPlacement } from './BaseDropdown'

export interface BaseSelectOption {
  value: string
  label: string
  icon?: ReactNode
  disabled?: boolean
}

export interface BaseSelectProps {
  name?: string
  value?: string
  defaultValue?: string
  options: BaseSelectOption[]
  onChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  required?: boolean
  className?: string
  style?: CSSProperties
  placement?: DropdownPlacement
  size?: 'sm' | 'md' | 'lg'
  'aria-label'?: string
}

export function BaseSelect({
  name,
  value: controlledValue,
  defaultValue,
  options = [],
  onChange,
  placeholder = 'Select...',
  disabled = false,
  required = false,
  className = '',
  style,
  placement = 'bottom-start',
  size = 'md',
  'aria-label': ariaLabel,
}: BaseSelectProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(() => {
    if (defaultValue !== undefined) return defaultValue
    if (controlledValue !== undefined) return controlledValue
    return options[0]?.value ?? ''
  })
  const [open, setOpen] = useState(false)

  const isControlled = controlledValue !== undefined
  const currentValue = isControlled ? controlledValue : uncontrolledValue

  const selectedOption = options.find((o) => o.value === currentValue)

  const handleSelect = (option: BaseSelectOption) => {
    if (option.disabled) return
    if (!isControlled) setUncontrolledValue(option.value)
    onChange?.(option.value)
    setOpen(false)
  }

  return (
    <>
      {name && <input type="hidden" name={name} value={currentValue} required={required} />}
      <BaseDropdown
        open={open}
        onOpenChange={setOpen}
        placement={placement}
        trigger={({ open }) => (
          <button
            type="button"
            className={`dropdown-trigger select-trigger dropdown-trigger--${size} select-trigger--${size} ${className}`.trim()}
            style={style}
            disabled={disabled}
            aria-expanded={open}
            aria-label={ariaLabel ?? placeholder}
            role="combobox"
          >
            {selectedOption ? (
              <span className="select-value-label">
                {selectedOption.icon && <span className="select-option-icon">{selectedOption.icon}</span>}
                {selectedOption.label}
              </span>
            ) : (
              <span className="select-value-label select-value-placeholder">{placeholder}</span>
            )}
            <ChevronDown size={14} className="dropdown-caret" aria-hidden="true" />
          </button>
        )}
      >
        <div role="listbox" className="select-menu-list">
          {options.map((opt) => {
            const isSelected = opt.value === currentValue
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={opt.disabled}
                className={`select-option ${isSelected ? 'is-selected' : ''}`.trim()}
                onClick={() => handleSelect(opt)}
              >
                {opt.icon && <span className="select-option-icon">{opt.icon}</span>}
                <span className="select-option-label">{opt.label}</span>
                {isSelected && <Check size={14} className="select-option-check" />}
              </button>
            )
          })}
        </div>
      </BaseDropdown>
    </>
  )
}
