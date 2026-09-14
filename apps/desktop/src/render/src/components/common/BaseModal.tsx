import React, { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export interface BaseModalProps {
  title?: ReactNode
  onClose?: () => void
  children?: ReactNode
  actions?: ReactNode
  showCloseButton?: boolean
  closeOnBackdropClick?: boolean
  closeOnEscape?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl'
  role?: 'dialog' | 'alertdialog'
  className?: string
  backdropClassName?: string
}

export interface HeaderProps {
  title?: ReactNode
  onClose?: () => void
  showCloseButton?: boolean
  className?: string
  children?: ReactNode
}

export interface BodyProps {
  noPadding?: boolean
  className?: string
  children: ReactNode
}

export interface FooterProps {
  className?: string
  children: ReactNode
}

function ModalHeader({
  title,
  onClose,
  showCloseButton = true,
  className = '',
  children
}: HeaderProps) {
  return (
    <header className={`dialog-header ${className}`.trim()}>
      {title && <h3>{title}</h3>}
      {children}
      {showCloseButton && onClose && (
        <button className="dialog-close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      )}
    </header>
  )
}

function ModalBody({
  noPadding = false,
  className = '',
  children
}: BodyProps) {
  const classes = ['dialog-body', noPadding ? 'no-padding' : '', className].filter(Boolean).join(' ')
  return <div className={classes}>{children}</div>
}

function ModalFooter({
  className = '',
  children
}: FooterProps) {
  return <footer className={`dialog-footer ${className}`.trim()}>{children}</footer>
}

export function BaseModal({
  title,
  onClose,
  children,
  actions,
  showCloseButton = true,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  size = 'md',
  role = 'dialog',
  className = '',
  backdropClassName = ''
}: BaseModalProps) {
  useEffect(() => {
    if (!closeOnEscape || !onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeOnEscape, onClose])

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && closeOnBackdropClick && onClose) {
      onClose()
    }
  }

  const dialogClasses = ['dialog', `dialog-${size}`, className].filter(Boolean).join(' ')
  const backdropClasses = ['dialog-backdrop', backdropClassName].filter(Boolean).join(' ')

  const childArray = React.Children.toArray(children)
  const isCompound = childArray.some(
    child => React.isValidElement(child) && (
      child.type === ModalHeader ||
      child.type === ModalBody ||
      child.type === ModalFooter
    )
  )

  const content = isCompound ? (
    children
  ) : (
    <>
      {(title || (showCloseButton && onClose)) && (
        <ModalHeader title={title} onClose={onClose} showCloseButton={showCloseButton} />
      )}
      <ModalBody>{children}</ModalBody>
      {actions && <ModalFooter>{actions}</ModalFooter>}
    </>
  )

  return createPortal(
    <div className={backdropClasses} onClick={handleBackdropClick}>
      <div className={dialogClasses} role={role} aria-modal="true">
        {content}
      </div>
    </div>,
    document.body
  )
}

BaseModal.Header = ModalHeader
BaseModal.Body = ModalBody
BaseModal.Footer = ModalFooter
