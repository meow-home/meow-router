import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, ReactNode } from 'react'

export type DropdownPlacement =
  | 'bottom-start'
  | 'bottom-end'
  | 'bottom-center'
  | 'top-start'
  | 'top-end'
  | 'top-center'

export interface BaseDropdownProps {
  trigger: ReactNode | ((props: { open: boolean; toggle: () => void }) => ReactNode)
  open?: boolean
  onOpenChange?: (open: boolean) => void
  placement?: DropdownPlacement
  offset?: number
  containerClassName?: string
  containerStyle?: CSSProperties
  menuClassName?: string
  menuStyle?: CSSProperties
  children: ReactNode
  closeOnOutsideClick?: boolean
  closeOnEscape?: boolean
}

export function computeDropdownPosition({
  triggerRect,
  menuRect,
  windowBounds,
  placement = 'bottom-start',
  offset = 4
}: {
  triggerRect: { top: number; bottom: number; left: number; right: number; width: number; height: number }
  menuRect: { width: number; height: number }
  windowBounds: { width: number; height: number }
  placement?: DropdownPlacement
  offset?: number
}): CSSProperties {
  const margin = 8
  const spaceBelow = windowBounds.height - triggerRect.bottom - offset - margin
  const spaceAbove = triggerRect.top - offset - margin

  let verticalDir: 'bottom' | 'top' = placement.startsWith('top') ? 'top' : 'bottom'

  if (verticalDir === 'bottom' && menuRect.height > spaceBelow && spaceAbove > spaceBelow) {
    verticalDir = 'top'
  } else if (verticalDir === 'top' && menuRect.height > spaceAbove && spaceBelow > spaceAbove) {
    verticalDir = 'bottom'
  }

  const resultStyle: CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    top: 'auto',
    bottom: 'auto',
    left: 'auto',
    right: 'auto'
  }

  if (verticalDir === 'top') {
    resultStyle.bottom = windowBounds.height - triggerRect.top + offset
  } else {
    resultStyle.top = triggerRect.bottom + offset
  }

  const maxAvail = verticalDir === 'top' ? spaceAbove : spaceBelow
  if (menuRect.height > maxAvail && maxAvail > 0) {
    resultStyle.maxHeight = Math.max(maxAvail, 120)
    resultStyle.overflowY = 'auto'
  }

  if (placement.endsWith('end')) {
    const calculatedRight = windowBounds.width - triggerRect.right
    const clampRight = Math.max(margin, Math.min(calculatedRight, windowBounds.width - menuRect.width - margin))
    resultStyle.right = clampRight
    resultStyle.left = 'auto'
  } else if (placement.endsWith('center')) {
    const triggerCenter = triggerRect.left + triggerRect.width / 2
    let calculatedLeft = triggerCenter - menuRect.width / 2
    calculatedLeft = Math.max(margin, Math.min(calculatedLeft, windowBounds.width - menuRect.width - margin))
    resultStyle.left = calculatedLeft
  } else {
    let calculatedLeft = triggerRect.left
    calculatedLeft = Math.max(margin, Math.min(calculatedLeft, windowBounds.width - menuRect.width - margin))
    resultStyle.left = calculatedLeft
  }

  return resultStyle
}

export function BaseDropdown({
  trigger,
  open: controlledOpen,
  onOpenChange,
  placement = 'bottom-start',
  offset = 4,
  containerClassName = '',
  containerStyle,
  menuClassName = '',
  menuStyle,
  children,
  closeOnOutsideClick = true,
  closeOnEscape = true
}: BaseDropdownProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen

  const containerRef = useRef<HTMLDivElement>(null)
  const triggerWrapperRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [positionStyle, setPositionStyle] = useState<CSSProperties>({
    position: 'fixed',
    top: -9999,
    left: -9999
  })

  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  const toggle = () => setOpen(!isOpen)

  useLayoutEffect(() => {
    if (!isOpen) return
    const updatePos = () => {
      if (!triggerWrapperRef.current || !menuRef.current) return
      const triggerRect = triggerWrapperRef.current.getBoundingClientRect()
      const menuRect = menuRef.current.getBoundingClientRect()
      const windowBounds = { width: window.innerWidth, height: window.innerHeight }
      const computed = computeDropdownPosition({
        triggerRect,
        menuRect,
        windowBounds,
        placement,
        offset
      })
      setPositionStyle(computed)
    }

    updatePos()
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
    }
  }, [isOpen, placement, offset])

  useEffect(() => {
    if (!isOpen) return
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (!closeOnOutsideClick) return
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }

    const handleKey = (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [isOpen, closeOnOutsideClick, closeOnEscape])

  const triggerNode = typeof trigger === 'function' ? trigger({ open: isOpen, toggle }) : trigger

  return (
    <div
      ref={containerRef}
      className={`base-dropdown-container ${containerClassName}`.trim()}
      style={containerStyle}
    >
      <div
        ref={triggerWrapperRef}
        className="base-dropdown-trigger-wrapper"
        onClick={() => toggle()}
        aria-expanded={isOpen}
      >
        {triggerNode}
      </div>

      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            className={`base-dropdown-menu ${menuClassName}`.trim()}
            style={{ ...positionStyle, ...menuStyle }}
          >
            {children}
          </div>,
          document.body
        )}
    </div>
  )
}
