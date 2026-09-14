import React, { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export interface BaseModalProps {
  open?: boolean
  title?: ReactNode
  subtitle?: ReactNode
  onClose?: () => void
  children?: ReactNode
  footer?: ReactNode
  actions?: ReactNode
  showCloseButton?: boolean
  closeOnBackdropClick?: boolean
  closeOnEscape?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl'
  width?: number | string
  role?: 'dialog' | 'alertdialog'
  className?: string
  backdropClassName?: string
  style?: React.CSSProperties
}

export interface HeaderProps {
  title?: ReactNode
  subtitle?: ReactNode
  onClose?: () => void
  showCloseButton?: boolean
  className?: string
  style?: React.CSSProperties
  children?: ReactNode
}

export interface BodyProps {
  noPadding?: boolean
  className?: string
  style?: React.CSSProperties
  children: ReactNode
}

export interface FooterProps {
  className?: string
  style?: React.CSSProperties
  children: ReactNode
}

/**
 * ModalHeader: Top section of BaseModal containing title, optional subtitle,
 * optional custom header elements, and the close (X) button.
 */
export function ModalHeader({
  title,
  subtitle,
  onClose,
  showCloseButton = true,
  className = '',
  style,
  children
}: HeaderProps) {
  return (
    <header className={`dialog-header ${className}`.trim()} style={style}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
        {title && (
          typeof title === 'string' ? <h3>{title}</h3> : title
        )}
        {subtitle && (
          <span style={{ fontSize: 'var(--fs-1)', color: 'var(--text-dim)' }}>{subtitle}</span>
        )}
      </div>
      {children}
      {showCloseButton && onClose && (
        <button
          type="button"
          className="dialog-close"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      )}
    </header>
  )
}

/**
 * ModalBody: Middle section of BaseModal containing the primary scrollable content.
 */
export function ModalBody({
  noPadding = false,
  className = '',
  style,
  children
}: BodyProps) {
  const classes = ['dialog-body', noPadding ? 'no-padding' : '', className].filter(Boolean).join(' ')
  return (
    <div className={classes} style={style}>
      {children}
    </div>
  )
}

/**
 * ModalFooter: Bottom section of BaseModal containing action buttons.
 */
export function ModalFooter({
  className = '',
  style,
  children
}: FooterProps) {
  return (
    <footer className={`dialog-footer ${className}`.trim()} style={style}>
      {children}
    </footer>
  )
}

/**
 * BaseModal: A modal component with strict separation of Header, Body, and Footer.
 * Supports both compound component pattern (<BaseModal.Header>, <BaseModal.Body>, <BaseModal.Footer>)
 * and simple prop-based pattern (title, children, footer/actions, onClose).
 */
export function BaseModal({
  open = true,
  title,
  subtitle,
  onClose,
  children,
  footer,
  actions,
  showCloseButton = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  size = 'md',
  width,
  role = 'dialog',
  className = '',
  backdropClassName = '',
  style
}: BaseModalProps) {
  useEffect(() => {
    if (!open || !closeOnEscape || !onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeOnEscape, onClose])

  if (!open) return null

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && closeOnBackdropClick && onClose) {
      onClose()
    }
  }

  const dialogClasses = ['dialog', `dialog-${size}`, className].filter(Boolean).join(' ')
  const backdropClasses = ['dialog-backdrop', backdropClassName].filter(Boolean).join(' ')

  const inlineStyle: React.CSSProperties = {
    ...style,
    ...(width ? { width: typeof width === 'number' ? `${width}px` : width } : {})
  }

  const childArray = React.Children.toArray(children)
  const isCompound = childArray.some(
    child => React.isValidElement(child) && (
      child.type === ModalHeader ||
      child.type === ModalBody ||
      child.type === ModalFooter
    )
  )

  const effectiveFooter = footer ?? actions

  const content = isCompound ? (
    children
  ) : (
    <>
      {(title || (showCloseButton && onClose)) && (
        <ModalHeader
          title={title}
          subtitle={subtitle}
          onClose={onClose}
          showCloseButton={showCloseButton}
        />
      )}
      <ModalBody>{children}</ModalBody>
      {effectiveFooter && (
        <ModalFooter>{effectiveFooter}</ModalFooter>
      )}
    </>
  )

  return createPortal(
    <div className={backdropClasses} onClick={handleBackdropClick} role="presentation">
      <div
        className={dialogClasses}
        role={role}
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        style={inlineStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </div>
    </div>,
    document.body
  )
}

BaseModal.Header = ModalHeader
BaseModal.Body = ModalBody
BaseModal.Footer = ModalFooter
