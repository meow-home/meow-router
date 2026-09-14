import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
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
  className?: string
  placement?: DropdownPlacement
}

export function BaseSelect({
  value: controlledValue,
  defaultValue,
  options,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  className = '',
  placement = 'bottom-start'
}: BaseSelectProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? options[0]?.value ?? '')
  const [open, setOpen] = useState(false)

  const isControlled = controlledValue !== undefined
  const currentValue = isControlled ? controlledValue : uncontrolledValue

  const selectedOption = options.find(o => o.value === currentValue)

  const handleSelect = (option: BaseSelectOption) => {
    if (option.disabled) return
    if (!isControlled) setUncontrolledValue(option.value)
    onChange?.(option.value)
    setOpen(false)
  }

  return (
    <BaseDropdown
      open={open}
      onOpenChange={setOpen}
      placement={placement}
      trigger={({ open }) => (
        <button
          type="button"
          className={`dropdown-trigger select-trigger ${className}`.trim()}
          disabled={disabled}
          aria-expanded={open}
          role="combobox"
        >
          {selectedOption ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              {selectedOption.icon}
              {selectedOption.label}
            </span>
          ) : (
            <span style={{ color: 'var(--text-dim)' }}>{placeholder}</span>
          )}
          <ChevronDown size={14} className="dropdown-caret" aria-hidden="true" />
        </button>
      )}
    >
      <div role="listbox" style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '160px' }}>
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            role="option"
            aria-selected={opt.value === currentValue}
            disabled={opt.disabled}
            className={`select-option ${opt.value === currentValue ? 'is-selected' : ''}`.trim()}
            onClick={() => handleSelect(opt)}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        ))}
      </div>
    </BaseDropdown>
  )
}
