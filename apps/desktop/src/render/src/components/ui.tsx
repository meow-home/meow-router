/* Reusable UI primitives for Meow Gateway — aligned with meow-coding's design system. */

import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { BaseModal } from './common/BaseModal'

export { BaseModal } from './common/BaseModal'
export { BaseDropdown } from './common/BaseDropdown'
export { BaseSelect } from './common/BaseSelect'

export function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function Panel({
  title,
  actions,
  children,
  className,
  style,
}: {
  title?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <section className={classNames('panel', className)} style={style}>
      {(title || actions) && (
        <div className="panel-header">
          {title ? <h3 className="panel-title">{title}</h3> : <span />}
          {actions && <div className="view-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function ViewHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: ReactNode
}) {
  return (
    <header className="view-header">
      <div>
        <h2 className="view-title">{title}</h2>
        {subtitle && <p className="view-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="view-actions">{children}</div>}
    </header>
  )
}

export function Button({
  variant = 'default',
  type = 'button',
  onClick,
  disabled,
  children,
  title,
  style,
  className,
}: {
  variant?: 'default' | 'primary' | 'live' | 'danger' | 'ghost'
  type?: 'button' | 'submit'
  onClick?: () => void
  disabled?: boolean
  children: ReactNode
  title?: string
  style?: React.CSSProperties
  className?: string
}) {
  return (
    <button
      type={type}
      className={classNames('btn', variant !== 'default' && `btn--${variant}`, className)}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
    >
      {children}
    </button>
  )
}

export function Pill({
  tone = 'muted',
  children,
}: {
  tone?: 'ok' | 'live' | 'fault' | 'muted' | 'warn'
  children: ReactNode
}) {
  return (
    <span className={classNames('pill', `pill--${tone}`)}>
      <span className="pill__dot" aria-hidden="true" />
      {children}
    </span>
  )
}

export function Field({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={classNames('field', className)}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  )
}

export function ErrorBanner({ children }: { children: string | null }) {
  if (!children) return null
  return <div className="error-banner" role="alert">{children}</div>
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export function Select({
  name,
  value,
  defaultValue,
  options,
  onChange,
  disabled,
  required,
  placeholder,
  className,
}: {
  name?: string
  value?: string
  defaultValue?: string
  options: SelectOption[]
  onChange?: (value: string) => void
  disabled?: boolean
  required?: boolean
  placeholder?: string
  className?: string
}) {
  const includesPlaceholder = placeholder != null

  // Never set both `value` and `defaultValue`: a controlled select must not also
  // receive a default, or React warns. We default to `''` only in uncontrolled
  // mode (no `value`) so a placeholder shows as the initial empty option.
  const isControlled = value !== undefined

  return (
    <select
      className={classNames('input', className)}
      name={name}
      value={value}
      defaultValue={isControlled ? undefined : defaultValue !== undefined ? defaultValue : includesPlaceholder ? '' : undefined}
      onChange={(e) => onChange?.(e.target.value)}
      disabled={disabled}
      required={required}
      aria-label={placeholder}
    >
      {includesPlaceholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string
}

export function Input({ className, ...rest }: InputProps) {
  return <input className={classNames('input', className)} {...rest} />
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string
}

export function TextArea({ className, ...rest }: TextAreaProps) {
  return <textarea className={classNames('input', className)} {...rest} />
}

export function Checkbox({
  children,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { children?: ReactNode; className?: string }) {
  return (
    <label className={classNames('check', className)}>
      <input type="checkbox" {...rest} />
      {children}
    </label>
  )
}

export function Spinner({ size = 14, label }: { size?: number; label?: string }) {
  return (
    <span className="spinner-wrap" role="status" aria-label={label ?? 'loading'}>
      <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />
      {label && <span className="spinner-label">{label}</span>}
    </span>
  )
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  label?: ReactNode
}) {
  return (
    <label className={classNames('toggle', disabled && 'toggle--disabled')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={classNames('toggle__track', checked && 'is-on')}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle__thumb" aria-hidden="true" />
      </button>
      {label && <span className="toggle__label">{label}</span>}
    </label>
  )
}

export function Modal({
  open,
  title,
  children,
  footer,
  onClose,
  width,
}: {
  open: boolean
  title?: string
  children?: ReactNode
  footer?: ReactNode
  onClose: () => void
  width?: number
}) {
  return (
    <BaseModal
      open={open}
      title={title}
      onClose={onClose}
      footer={footer}
      width={width}
    >
      {children}
    </BaseModal>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="dialog-message">{message}</p>
    </Modal>
  )
}

export function EmptyState({ icon = '—', title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <span className="empty-mark">{icon}</span>
      <span className="empty-state-title">{title}</span>
      {hint && <span className="empty-state-hint">{hint}</span>}
    </div>
  )
}
