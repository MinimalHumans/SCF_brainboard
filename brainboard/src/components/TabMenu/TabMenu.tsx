import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useBoardStore, CARD_W, CARD_H, BACKDROP_MIN_W, BACKDROP_MIN_H } from '@/store/boardStore'
import { ENTITY_TYPES } from '@/types/board'
import { BACKDROP_TYPES } from '@/types/board'
import type { EntityType, BackdropType } from '@/types/board'
import styles from './TabMenu.module.css'

// ---------------------------------------------------------------------------
// Item definitions — all createable things, alphabetically sorted
// ---------------------------------------------------------------------------

type TabItem =
  | { kind: 'card';     type: EntityType }
  | { kind: 'backdrop'; type: BackdropType }

const ALL_ITEMS: TabItem[] = [
  ...[...ENTITY_TYPES].sort().map(t => ({ kind: 'card' as const, type: t })),
  ...[...BACKDROP_TYPES].sort().map(t => ({ kind: 'backdrop' as const, type: t })),
]

function itemLabel(item: TabItem): string {
  return item.kind === 'backdrop' ? `${item.type} backdrop` : item.type
}

function itemKey(item: TabItem): string {
  return `${item.kind}-${item.type}`
}

// ---------------------------------------------------------------------------
// MenuPositioned — positions the menu near the cursor, clamped to viewport
// ---------------------------------------------------------------------------

const MENU_W = 360
const MENU_H = 420  // approximate max height

function MenuPositioned({ screenX, screenY, onClose, children }: {
  screenX:  number
  screenY:  number
  onClose:  () => void
  children: React.ReactNode
}) {
  const PAD = 12
  const vw  = window.innerWidth
  const vh  = window.innerHeight

  // Position below-right of cursor; flip left if near right edge, flip up if near bottom
  let left = screenX + 8
  let top  = screenY + 8

  if (left + MENU_W + PAD > vw) left = screenX - MENU_W - 8
  if (top  + MENU_H + PAD > vh) top  = screenY - MENU_H - 8

  // Clamp to viewport
  left = Math.max(PAD, Math.min(left, vw - MENU_W - PAD))
  top  = Math.max(PAD, Math.min(top,  vh - PAD))

  return (
    <div
      style={{ position: 'absolute', left, top, width: MENU_W }}
      className={''} // picks up no overlay centering
      role="dialog"
      aria-label="Create card or backdrop"
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TabMenu component
// ---------------------------------------------------------------------------

interface TabMenuProps {
  worldX:        number   // world coords — used for card/backdrop creation
  worldY:        number
  screenX:       number   // screen coords — used for menu positioning
  screenY:       number
  onClose:       () => void
  getViewerZoom: () => number
}

export function TabMenu({ worldX, worldY, screenX, screenY, onClose, getViewerZoom }: TabMenuProps) {
  const [query, setQuery]         = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef                  = useRef<HTMLInputElement>(null)
  const listRef                   = useRef<HTMLUListElement>(null)

  const createCard     = useBoardStore(s => s.createCard)
  const createBackdrop = useBoardStore(s => s.createBackdrop)

  // Filter items by query
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ALL_ITEMS
    return ALL_ITEMS.filter(item =>
      item.type.toLowerCase().startsWith(q) ||
      itemLabel(item).toLowerCase().startsWith(q)
    )
  }, [query])

  // Reset active index when filter changes
  useEffect(() => setActiveIdx(0), [filtered])

  // Auto-focus input on mount
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  // Scroll active item into view
  useEffect(() => {
    const li = listRef.current?.children[activeIdx] as HTMLElement | undefined
    li?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const commit = useCallback((item: TabItem) => {
    if (item.kind === 'card') {
      createCard(
        { x: worldX - CARD_W / 2, y: worldY - CARD_H / 2 },
        item.type
      )
    } else {
      createBackdrop(
        { x: worldX - BACKDROP_MIN_W, y: worldY - BACKDROP_MIN_H },
        { width: BACKDROP_MIN_W * 3, height: BACKDROP_MIN_H * 3 },
        item.type
      )
    }
    onClose()
  }, [worldX, worldY, createCard, createBackdrop, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        onClose()
        break
      case 'ArrowDown':
        e.preventDefault()
        setActiveIdx(i => Math.min(i + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIdx(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filtered[activeIdx]) commit(filtered[activeIdx])
        break
      case 'Tab':
        // Second Tab press: same as Enter
        e.preventDefault()
        if (filtered[activeIdx]) commit(filtered[activeIdx])
        break
    }
  }, [filtered, activeIdx, commit, onClose])

  return createPortal(
    <div className={styles.overlay} onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <MenuPositioned screenX={screenX} screenY={screenY} onClose={onClose}>
        <div className={styles.menuBox}>
        <div className={styles.searchRow}>
          <span className={styles.tabIcon}>⊞</span>
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Search card or backdrop type…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-autocomplete="list"
            spellCheck={false}
          />
          <kbd className={styles.hint}>Esc to close</kbd>
        </div>

        {filtered.length === 0 ? (
          <div className={styles.empty}>No matches for "{query}"</div>
        ) : (
          <ul ref={listRef} className={styles.list} role="listbox">
            {filtered.map((item, idx) => (
              <li
                key={itemKey(item)}
                className={`${styles.item} ${idx === activeIdx ? styles.active : ''}`}
                role="option"
                aria-selected={idx === activeIdx}
                onPointerDown={e => { e.preventDefault(); commit(item) }}
                onPointerEnter={() => setActiveIdx(idx)}
              >
                <span className={`${styles.badge} ${styles[`badge_${item.kind}`]}`}>
                  {item.kind === 'card' ? 'Card' : 'Backdrop'}
                </span>
                <span className={styles.label}>{itemLabel(item)}</span>
                {idx === activeIdx && <span className={styles.enterHint}>↵</span>}
              </li>
            ))}
          </ul>
        )}
        </div>
      </MenuPositioned>
    </div>,
    document.body
  )
}
