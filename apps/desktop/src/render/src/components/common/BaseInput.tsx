import { forwardRef, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { classNames } from '../ui'

export interface BaseInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg'
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  clearable?: boolean
  onClear?: () => void
  error?: boolean | string
  className?: string
  style?: CSSProperties
  wrapperClassName?: string
  wrapperStyle?: CSSProperties
}

export const BaseInput = forwardRef<HTMLInputElement, BaseInputProps>(function BaseInput(
  {
    size = 'md',
    leftIcon,
    rightIcon,
    clearable = false,
    onClear,
    error,
    className,
    style,
    wrapperClassName,
    wrapperStyle,
    value,
    onChange,
    disabled,
    ...rest
  },
  ref
) {
  const hasValue = value !== undefined && value !== ''

  return (
    <div
      className={classNames(
        'base-input-wrapper',
        `base-input-wrapper--${size}`,
        disabled && 'base-input-wrapper--disabled',
        Boolean(error) && 'base-input-wrapper--error',
        wrapperClassName
      )}
      style={{ ...style, ...wrapperStyle }}
    >
      {leftIcon && <span className="base-input__icon base-input__icon--left">{leftIcon}</span>}
      <input
        ref={ref}
        className={classNames('input', `input--${size}`, Boolean(error) && 'input--error', className)}
        value={value}
        onChange={onChange}
        disabled={disabled}
        {...rest}
      />
      {clearable && hasValue && !disabled && (
        <button
          type="button"
          className="base-input__clear"
          onClick={onClear}
          tabIndex={-1}
          aria-label="Clear text"
        >
          <X size={13} />
        </button>
      )}
      {rightIcon && !clearable && <span className="base-input__icon base-input__icon--right">{rightIcon}</span>}
    </div>
  )
})
