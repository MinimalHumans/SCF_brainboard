import React, { useState, useCallback, useRef } from 'react'
import { useBoardStore, CARD_W, CARD_H, BACKDROP_MIN_W, BACKDROP_MIN_H } from '@/store/boardStore'
import { ContextMenu } from '@/components/ContextMenu/ContextMenu'
import type { ContextMenuItem } from '@/components/ContextMenu/ContextMenu'
import type { Backdrop } from '@/types/board'
import { SWATCH_KEYS, getContainedCardIds } from '@/types/board'
import { BACKDROP_SCHEMAS } from '@/config/backdropSchemas'
import styles from './Backdrop.module.css'

// ---------------------------------------------------------------------------
// Resize handle positions
// ---------------------------------------------------------------------------
type HandlePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const HANDLES: HandlePos[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

interface BackdropProps {
  backdrop:      Backdrop
  getViewerZoom: () => number
}

export function BackdropComponent({ backdrop, getViewerZoom }: BackdropProps) {
  const [isEditing, setIsEditing]  = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [ctxMenu, setCtxMenu]      = useState<{ x: number; y: number } | null>(null)
  const titleInputRef              = useRef<HTMLInputElement>(null)

  // Separate selectors — never return object literals from useBoardStore
  // (new object reference every render → infinite loop)
  const updateBackdropPosition  = useBoardStore(s => s.updateBackdropPosition)
  const updateBackdropSize      = useBoardStore(s => s.updateBackdropSize)
  const updateBackdropContent   = useBoardStore(s => s.updateBackdropContent)
  const updateBackdropAttribute = useBoardStore(s => s.updateBackdropAttribute)
  const moveBackdropWithCards   = useBoardStore(s => s.moveBackdropWithCards)
  const deleteBackdrop          = useBoardStore(s => s.deleteBackdrop)
  const board                   = useBoardStore(s => s.board)

  const schema = BACKDROP_SCHEMAS[backdrop.type] ?? []

  // ── Title inline rename ─────────────────────────────────────────────────

  const startRename = useCallback(() => {
    setDraftTitle(backdrop.title)
    setIsRenaming(true)
    requestAnimationFrame(() => titleInputRef.current?.select())
  }, [backdrop.title])

  const commitRename = useCallback(() => {
    const t = draftTitle.trim()
    if (t) updateBackdropContent(backdrop.id, { title: t })
    setIsRenaming(false)
  }, [draftTitle, backdrop.id, updateBackdropContent])

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitRename() }
    if (e.key === 'Escape') { e.preventDefault(); setIsRenaming(false) }
  }, [commitRename])

  // ── Header drag — moves backdrop + spatially contained cards ────────────

  const handleHeaderPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // Don't initiate drag from interactive elements inside the header
    const target = e.target as HTMLElement
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT') return

    e.stopPropagation()
    const el = e.currentTarget.closest('[data-backdrop-id]') as HTMLDivElement
    if (!el) return
    el.setPointerCapture(e.pointerId)

    const zoom   = getViewerZoom()
    const startX = e.clientX
    const startY = e.clientY
    const startBX = backdrop.position.x
    const startBY = backdrop.position.y

    // Compute contained card IDs at drag start (spatial membership)
    const containedIds   = getContainedCardIds(backdrop, board.cards, CARD_W, CARD_H)
    const cardStartPos   = new Map(
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

      // Move backdrop DOM element
      el.style.transform = `translate(${startBX + dx}px, ${startBY + dy}px)`

      // Move contained cards DOM elements
      for (const [id, start] of cardStartPos) {
        const cardEl = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
        if (cardEl) cardEl.style.transform = `translate(${start.x + dx}px, ${start.y + dy}px)`
      }
    }

    const onUp = (ue: PointerEvent) => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup',   onUp)
      if (!dragging) return

      const dx = (ue.clientX - startX) / zoom
      const dy = (ue.clientY - startY) / zoom

      moveBackdropWithCards(
        backdrop.id,
        { x: startBX + dx, y: startBY + dy },
        [...cardStartPos.entries()].map(([id, start]) => ({
          id,
          position: { x: start.x + dx, y: start.y + dy },
        }))
      )
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup',   onUp)
  }, [backdrop, board.cards, getViewerZoom, moveBackdropWithCards])

  // ── Resize handle drag ──────────────────────────────────────────────────

  const handleResizePointerDown = useCallback((
    e:   React.PointerEvent<HTMLDivElement>,
    pos: HandlePos,
  ) => {
    e.stopPropagation()
    e.preventDefault()

    // Capture on the handle element that received the event.
    // Calling setPointerCapture on a different element (e.g. the backdrop root)
    // is invalid per spec and causes the capture to silently fail.
    const handleEl  = e.currentTarget
    handleEl.setPointerCapture(e.pointerId)

    // Separate reference to the backdrop root for DOM visual feedback
    const backdropEl = handleEl.closest('[data-backdrop-id]') as HTMLElement | null

    const zoom   = getViewerZoom()
    const startX = e.clientX
    const startY = e.clientY
    const origX  = backdrop.position.x
    const origY  = backdrop.position.y
    const origW  = backdrop.size.width
    const origH  = backdrop.size.height

    // Pure calculation — no side effects, shared by onMove and onUp
    const calcBounds = (dx: number, dy: number) => {
      let newX = origX, newY = origY, newW = origW, newH = origH
      if (pos.includes('e')) newW = Math.max(BACKDROP_MIN_W, origW + dx)
      if (pos.includes('s')) newH = Math.max(BACKDROP_MIN_H, origH + dy)
      if (pos.includes('w')) {
        const d = Math.min(dx, origW - BACKDROP_MIN_W)
        newX = origX + d; newW = origW - d
      }
      if (pos.includes('n')) {
        const d = Math.min(dy, origH - BACKDROP_MIN_H)
        newY = origY + d; newH = origH - d
      }
      return { newX, newY, newW, newH }
    }

    const onMove = (me: PointerEvent) => {
      const { newX, newY, newW, newH } = calcBounds(
        (me.clientX - startX) / zoom,
        (me.clientY - startY) / zoom,
      )
      if (backdropEl) {
        backdropEl.style.transform = `translate(${newX}px, ${newY}px)`
        backdropEl.style.width     = `${newW}px`
        backdropEl.style.height    = `${newH}px`
      }
    }

    const onUp = (ue: PointerEvent) => {
      handleEl.removeEventListener('pointermove', onMove)
      handleEl.removeEventListener('pointerup',   onUp)

      const { newX, newY, newW, newH } = calcBounds(
        (ue.clientX - startX) / zoom,
        (ue.clientY - startY) / zoom,
      )

      // Do NOT reset inline styles here. Resetting them causes a one-frame
      // flash where the backdrop collapses to 0 size while React re-renders.
      // React's reconciliation will overwrite the inline styles with the
      // correct store-derived values on the next render pass.
      updateBackdropSize(backdrop.id, { x: newX, y: newY }, { width: newW, height: newH })
    }

    // Attach to the capturing element — events follow the pointer regardless
    // of where it moves, because we set pointer capture above.
    handleEl.addEventListener('pointermove', onMove)
    handleEl.addEventListener('pointerup',   onUp)
  }, [backdrop, getViewerZoom, updateBackdropSize])

  // ── Context menu ─────────────────────────────────────────────────────────

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const ctxItems: ContextMenuItem[] = [
    {
      label:   'Edit attributes',
      onClick: () => setIsEditing(v => !v),
    },
    {
      label:   'Delete backdrop',
      danger:  true,
      divider: true,
      onClick: () => deleteBackdrop(backdrop.id),
    },
  ]

  // ── Filled attribute display ──────────────────────────────────────────────

  const filledAttrs = schema
    .map(f => ({ field: f, value: backdrop.attributes[f.key] ?? '' }))
    .filter(({ value }) => value.trim() !== '')

  return (
    <>
      <div
        data-backdrop-id={backdrop.id}
        className={`${styles.backdrop} ${isEditing ? styles.editing : ''}`}
        data-swatch={backdrop.color}
        style={{
          transform: `translate(${backdrop.position.x}px, ${backdrop.position.y}px)`,
          width:     backdrop.size.width,
          height:    backdrop.size.height,
          zIndex:    backdrop.zIndex,
        }}
        onContextMenu={handleContextMenu}
      >
        {/* Header */}
        <div className={styles.header} onPointerDown={handleHeaderPointerDown}>
          <span className={styles.typeBadge}>{backdrop.type}</span>

          {isRenaming ? (
            <input
              ref={titleInputRef}
              className={styles.titleInput}
              value={draftTitle}
              onChange={e => setDraftTitle(e.target.value)}
              onBlur={commitRename}
              onKeyDown={handleTitleKeyDown}
              onClick={e => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <span className={styles.title} onDoubleClick={e => { e.stopPropagation(); startRename() }}>
              {backdrop.title}
            </span>
          )}

          <div className={styles.headerActions}>
            <button
              className={styles.iconBtn}
              onPointerDown={e => { e.stopPropagation(); e.preventDefault(); setIsEditing(v => !v) }}
              title={isEditing ? 'Close attributes' : 'Edit attributes'}
            >
              {isEditing ? <CloseIcon /> : <EditIcon />}
            </button>
          </div>
        </div>

        {/* Attribute display (view mode) */}
        {!isEditing && filledAttrs.length > 0 && (
          <div className={styles.attrDisplay}>
            {filledAttrs.map(({ field, value }) => (
              <div key={field.key} className={styles.attrRow}>
                <span className={styles.attrKey}>{field.label}</span>
                <span className={styles.attrVal}>{value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Attribute edit panel */}
        {isEditing && (
          <div className={styles.editPanel} onClick={e => e.stopPropagation()}>
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
            {/* Color picker */}
            <div className={styles.field}>
              <label className={styles.label}>Color</label>
              <div className={styles.swatches}>
                {SWATCH_KEYS.map(swatch => (
                  <div
                    key={swatch}
                    role="button"
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
          </div>
        )}

        {/* Resize handles */}
        {HANDLES.map(pos => (
          <div
            key={pos}
            className={`${styles.handle} ${styles[`handle_${pos}`]}`}
            onPointerDown={e => handleResizePointerDown(e, pos)}
          />
        ))}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
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
