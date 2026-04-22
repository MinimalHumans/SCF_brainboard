import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './ContextMenu.module.css'

export interface ContextMenuItem {
  label:    string
  shortcut?: string
  onClick:  () => void
  disabled?: boolean
  danger?:   boolean
  divider?:  boolean  // render a divider BEFORE this item
}

interface ContextMenuProps {
  x:       number
  y:       number
  items:   ContextMenuItem[]
  onClose: () => void
}

/*
 * ContextMenu
 * -----------
 * Rendered into document.body via a portal so it escapes InfiniteViewer's
 * transform context. x/y are screen coordinates (from contextmenu event
 * clientX/clientY). The menu repositions itself if it would overflow the
 * viewport.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click or Escape
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Use capture so we intercept before other handlers
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    document.addEventListener('keydown',     onKeyDown,     { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
      document.removeEventListener('keydown',     onKeyDown,     { capture: true })
    }
  }, [onClose])

  // Reposition if menu would overflow viewport edges
  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    if (rect.right  > vw) el.style.left = `${vw - rect.width  - 8}px`
    if (rect.bottom > vh) el.style.top  = `${vh - rect.height - 8}px`
  }, [x, y])

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: x, top: y }}
      onContextMenu={e => e.preventDefault()}
    >
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {item.divider && <div className={styles.divider} />}
          <button
            className={[
              styles.item,
              item.danger    ? styles.danger    : '',
              item.disabled  ? styles.disabled  : '',
            ].join(' ').trim()}
            onClick={() => {
              if (!item.disabled) {
                item.onClick()
                onClose()
              }
            }}
            disabled={item.disabled}
          >
            <span className={styles.label}>{item.label}</span>
            {item.shortcut && (
              <span className={styles.shortcut}>{item.shortcut}</span>
            )}
          </button>
        </React.Fragment>
      ))}
    </div>,
    document.body
  )
}
