import React, { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useBoardStore, CARD_W, CARD_H, BACKDROP_MIN_W, BACKDROP_MIN_H } from '@/store/boardStore'
import { ContextMenu } from '@/components/ContextMenu/ContextMenu'
import type { ContextMenuItem } from '@/components/ContextMenu/ContextMenu'
import type { Backdrop } from '@/types/board'
import { SWATCH_KEYS, BACKDROP_TYPES, getContainedCardIds } from '@/types/board'
import { BACKDROP_SCHEMAS } from '@/config/backdropSchemas'
import styles from './Backdrop.module.css'

type HandlePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: HandlePos[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

interface BackdropProps {
  backdrop:      Backdrop
  getViewerZoom: () => number
  worldRef:      React.RefObject<HTMLDivElement>
}

export function BackdropComponent({ backdrop, getViewerZoom, worldRef }: BackdropProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [ctxMenu, setCtxMenu]     = useState<{ x: number; y: number } | null>(null)

  const updateBackdropType      = useBoardStore(s => s.updateBackdropType)
  const updateBackdropContent   = useBoardStore(s => s.updateBackdropContent)
  const updateBackdropSize      = useBoardStore(s => s.updateBackdropSize)
  const updateBackdropAttribute = useBoardStore(s => s.updateBackdropAttribute)
  const moveBackdropWithCards   = useBoardStore(s => s.moveBackdropWithCards)
  const deleteBackdrop          = useBoardStore(s => s.deleteBackdrop)
  const board                   = useBoardStore(s => s.board)

  const schema = BACKDROP_SCHEMAS[backdrop.type] ?? []



  // ── Header drag ────────────────────────────────────────────────────────────

  const handleHeaderPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

    e.stopPropagation()
    const headerEl   = e.currentTarget
    headerEl.setPointerCapture(e.pointerId)
    const backdropEl = headerEl.closest('[data-backdrop-id]') as HTMLElement | null

    const zoom   = getViewerZoom()
    const startX = e.clientX, startY = e.clientY
    const startBX = backdrop.position.x, startBY = backdrop.position.y

    const containedIds = getContainedCardIds(backdrop, board.cards, CARD_W, CARD_H)
    const cardStartPos = new Map(
      containedIds
        .map(id => board.cards.find(c => c.id === id))
        .filter(Boolean)
        .map(c => [c!.id, { x: c!.position.x, y: c!.position.y }])
    )

    let dragging = false

    const onMove = (me: PointerEvent) => {
      const dx = (me.clientX - startX) / zoom
      const dy = (me.clientY - startY) / zoom
      if (!dragging && Math.hypot(dx, dy) < 4) return
      dragging = true
      if (backdropEl) backdropEl.style.transform = `translate(${startBX + dx}px, ${startBY + dy}px)`
      for (const [id, start] of cardStartPos) {
        const el = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
        if (el) el.style.transform = `translate(${start.x + dx}px, ${start.y + dy}px)`
      }
    }

    const onUp = (ue: PointerEvent) => {
      headerEl.removeEventListener('pointermove', onMove)
      headerEl.removeEventListener('pointerup',   onUp)
      if (!dragging) return
      const dx = (ue.clientX - startX) / zoom
      const dy = (ue.clientY - startY) / zoom
      moveBackdropWithCards(
        backdrop.id,
        { x: startBX + dx, y: startBY + dy },
        [...cardStartPos.entries()].map(([id, start]) => ({
          id, position: { x: start.x + dx, y: start.y + dy },
        }))
      )
    }

    headerEl.addEventListener('pointermove', onMove)
    headerEl.addEventListener('pointerup',   onUp)
  }, [backdrop, board.cards, getViewerZoom, moveBackdropWithCards])

  // ── Resize handles ─────────────────────────────────────────────────────────

  const handleResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, pos: HandlePos) => {
    e.stopPropagation()
    e.preventDefault()
    const handleEl   = e.currentTarget
    handleEl.setPointerCapture(e.pointerId)
    const backdropEl = handleEl.closest('[data-backdrop-id]') as HTMLElement | null

    const zoom   = getViewerZoom()
    const startX = e.clientX, startY = e.clientY
    const origX  = backdrop.position.x, origY = backdrop.position.y
    const origW  = backdrop.size.width,  origH = backdrop.size.height

    const calc = (dx: number, dy: number) => {
      let newX = origX, newY = origY, newW = origW, newH = origH
      if (pos.includes('e')) newW = Math.max(BACKDROP_MIN_W, origW + dx)
      if (pos.includes('s')) newH = Math.max(BACKDROP_MIN_H, origH + dy)
      if (pos.includes('w')) { const d = Math.min(dx, origW - BACKDROP_MIN_W); newX = origX + d; newW = origW - d }
      if (pos.includes('n')) { const d = Math.min(dy, origH - BACKDROP_MIN_H); newY = origY + d; newH = origH - d }
      return { newX, newY, newW, newH }
    }

    const onMove = (me: PointerEvent) => {
      const { newX, newY, newW, newH } = calc((me.clientX - startX) / zoom, (me.clientY - startY) / zoom)
      if (backdropEl) {
        backdropEl.style.transform = `translate(${newX}px, ${newY}px)`
        backdropEl.style.width     = `${newW}px`
        backdropEl.style.height    = `${newH}px`
      }
    }

    const onUp = (ue: PointerEvent) => {
      handleEl.removeEventListener('pointermove', onMove)
      handleEl.removeEventListener('pointerup',   onUp)
      const { newX, newY, newW, newH } = calc((ue.clientX - startX) / zoom, (ue.clientY - startY) / zoom)
      updateBackdropSize(backdrop.id, { x: newX, y: newY }, { width: newW, height: newH })
    }

    handleEl.addEventListener('pointermove', onMove)
    handleEl.addEventListener('pointerup',   onUp)
  }, [backdrop, getViewerZoom, updateBackdropSize])

  // ── Context menu ───────────────────────────────────────────────────────────

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const ctxItems: ContextMenuItem[] = [
    { label: 'Edit attributes', onClick: () => setIsEditing(v => !v) },
    { label: 'Delete backdrop', danger: true, divider: true, onClick: () => deleteBackdrop(backdrop.id) },
  ]

  const filledAttrs = schema
    .map(f => ({ field: f, value: backdrop.attributes[f.key] ?? '' }))
    .filter(({ value }) => value.trim() !== '')

  return (
    <>
      <div
        data-backdrop-id={backdrop.id}
        className={styles.backdrop}
        data-swatch={backdrop.color}
        style={{
          transform: `translate(${backdrop.position.x}px, ${backdrop.position.y}px)`,
          width:     backdrop.size.width,
          height:    backdrop.size.height,
          zIndex:    backdrop.zIndex,
        }}
      >
        {/* HEADER — pointer-events: auto, full width drag zone */}
        <div className={styles.header} onPointerDown={handleHeaderPointerDown} onContextMenu={handleContextMenu}>
          <span className={styles.typeBadge}>{backdrop.type}</span>
          <div className={styles.headerActions}>
            {!isEditing && (
              <button
                className={styles.iconBtn}
                onPointerDown={e => { e.stopPropagation(); e.preventDefault(); setIsEditing(true) }}
                title="Edit"
              >
                <EditIcon />
              </button>
            )}
          </div>
        </div>

        {/* BODY — pointer-events: none so clicks fall through */}
        <div className={styles.body}>

          {/* ── VIEW MODE ── */}
          {!isEditing && (
            <>
              <div className={styles.titleArea}>
                <span
                  className={`${styles.title} text-display`}
                  style={{ pointerEvents: 'auto' }}
                  onDoubleClick={e => { e.stopPropagation(); setIsEditing(true) }}
                  title="Double-click to edit"
                >
                  {backdrop.title}
                </span>
              </div>

              {filledAttrs.length > 0 && (
                <div className={styles.attrDisplay}>
                  {filledAttrs.map(({ field, value }) => (
                    <div key={field.key} className={styles.attrRow}>
                      <span className={styles.attrKey}>{field.label}</span>
                      <span className={styles.attrVal}>{value}</span>
                    </div>
                  ))}
                </div>
              )}

              {backdrop.note && (
                <div className={styles.noteDisplay}>
                  {backdrop.note}
                </div>
              )}
            </>
          )}

        </div>

        {/* RESIZE HANDLES */}
        {HANDLES.map(pos => (
          <div
            key={pos}
            className={`${styles.handle} ${styles[`handle_${pos}`]}`}
            onPointerDown={e => handleResizePointerDown(e, pos)}
          />
        ))}
      </div>

      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxItems} onClose={() => setCtxMenu(null)} />
      )}

      {/* Edit panel — portal so it's above ALL cards regardless of stacking context */}
      {isEditing && worldRef.current && createPortal(
        <div
          className={styles.editPanel}
          style={{
            position: 'absolute',
            // Anchor top-right of backdrop in world space
            left: backdrop.position.x + backdrop.size.width + 8,
            top:  backdrop.position.y,
            zIndex: backdrop.zIndex + 1000,
          }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>{backdrop.title}</span>
            <button className={styles.panelClose} onPointerDown={e => { e.stopPropagation(); e.preventDefault(); setIsEditing(false) }} title="Close">×</button>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Type</label>
            <select
              className={styles.select}
              value={backdrop.type}
              onChange={e => updateBackdropType(backdrop.id, e.target.value as any)}
            >
              {[...BACKDROP_TYPES].sort().map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Title</label>
            <input
              className={styles.input}
              value={backdrop.title}
              onChange={e => updateBackdropContent(backdrop.id, { title: e.target.value })}
              placeholder={backdrop.type}
              autoFocus
            />
          </div>
          {schema.map(field => (
            <div key={field.key} className={styles.field}>
              <label className={styles.label}>{field.label}</label>
              {field.type === 'textarea' ? (
                <textarea
                  className={styles.textarea}
                  value={backdrop.attributes[field.key] ?? ''}
                  onChange={e => updateBackdropAttribute(backdrop.id, field.key, e.target.value)}
                  placeholder={field.hint}
                  rows={2}
                />
              ) : (
                <input
                  className={styles.input}
                  value={backdrop.attributes[field.key] ?? ''}
                  onChange={e => updateBackdropAttribute(backdrop.id, field.key, e.target.value)}
                  placeholder={field.hint}
                />
              )}
            </div>
          ))}
          <div className={styles.field}>
            <label className={styles.label}>Note <span className={styles.noteHint}>· shown in lower-left</span></label>
            <textarea
              className={styles.textarea}
              value={backdrop.note ?? ''}
              onChange={e => updateBackdropContent(backdrop.id, { note: e.target.value } as any)}
              placeholder="Add a note…"
              rows={2}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Color</label>
            <div className={styles.swatches}>
              {SWATCH_KEYS.map(swatch => (
                <div key={swatch} role="button"
                  className={`${styles.swatch} ${backdrop.color === swatch ? styles.swatchActive : ''}`}
                  style={{ '--dot': `var(--swatch-${swatch})` } as React.CSSProperties}
                  onPointerDown={e => {
                    e.stopPropagation(); e.preventDefault()
                    updateBackdropContent(backdrop.id, { color: swatch as any })
                  }}
                  title={swatch}
                />
              ))}
            </div>
          </div>
        </div>,
        worldRef.current!
      )}
    </>
  )
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M1.5 9.5h1.5L8 4 7 3 1.5 8.5V9.5zM7 3l1-1 1 1-1 1L7 3z"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}
