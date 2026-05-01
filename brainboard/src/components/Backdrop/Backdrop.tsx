import React, { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useBoardStore, CARD_W, CARD_H, BACKDROP_MIN_W, BACKDROP_MIN_H, snapshotBoard } from '@/store/boardStore'
import { useEditorSignalStore } from '@/store/editorSignalStore'
import { ContextMenu } from '@/components/ContextMenu/ContextMenu'
import type { ContextMenuItem } from '@/components/ContextMenu/ContextMenu'
import { SWATCH_KEYS, BACKDROP_TYPES, getContainedCardIds, getContainedBackdropIds } from '@/types/board'
import { BACKDROP_SCHEMAS } from '@/config/backdropSchemas'
import type { Backdrop } from '@/types/board'
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

  const liveBackdrop = useBoardStore(s => s.board.backdrops.find(b => b.id === backdrop.id) ?? backdrop)

  const updateBackdropContent         = useBoardStore(s => s.updateBackdropContent)
  const updateBackdropSize            = useBoardStore(s => s.updateBackdropSize)
  const updateBackdropType            = useBoardStore(s => s.updateBackdropType)
  const updateBackdropAttribute       = useBoardStore(s => s.updateBackdropAttribute)
  const moveBackdropWithCards         = useBoardStore(s => s.moveBackdropWithCards)
  const duplicateBackdrop             = useBoardStore(s => s.duplicateBackdrop)
  const duplicateBackdropWithContents = useBoardStore(s => s.duplicateBackdropWithContents)
  const deleteBackdrop                = useBoardStore(s => s.deleteBackdrop)
  const board                         = useBoardStore(s => s.board)

  const closeSignal = useEditorSignalStore(s => s.closeSignal)
  useEffect(() => { if (closeSignal > 0) setIsEditing(false) }, [closeSignal])

  const schema = BACKDROP_SCHEMAS[liveBackdrop.type] ?? []

  // Status — read from attributes; absent or 'Active' = no indicator
  const backdropStatus = liveBackdrop.attributes['status'] as string | undefined

  // filledAttrs: exclude 'status' — it has its own visual treatment, not listed
  const filledAttrs = schema
    .filter(f => f.key !== 'status')
    .map(f => ({ field: f, value: liveBackdrop.attributes[f.key] ?? '' }))
    .filter(({ value }) => value.trim() !== '')

  const handleHeaderPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'SELECT') return
    e.stopPropagation()
    const headerEl   = e.currentTarget
    headerEl.setPointerCapture(e.pointerId)
    const backdropEl = headerEl.closest('[data-backdrop-id]') as HTMLElement | null

    const zoom = getViewerZoom()
    const startX = e.clientX, startY = e.clientY
    const startBX = liveBackdrop.position.x, startBY = liveBackdrop.position.y

    const containedCardIds     = getContainedCardIds(liveBackdrop, board.cards, CARD_W, CARD_H)
    const containedBackdropIds = getContainedBackdropIds(liveBackdrop, board.backdrops)

    const cardStartPos = new Map(
      containedCardIds.map(id => board.cards.find(c => c.id === id)).filter(Boolean)
        .map(c => [c!.id, { ...c!.position }])
    )
    const bdStartPos = new Map(
      containedBackdropIds.map(id => board.backdrops.find(b => b.id === id)).filter(Boolean)
        .map(b => [b!.id, { ...b!.position }])
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
      for (const [id, start] of bdStartPos) {
        const el = document.querySelector<HTMLElement>(`[data-backdrop-id="${id}"]`)
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
        liveBackdrop.id,
        { x: startBX + dx, y: startBY + dy },
        [...cardStartPos.entries()].map(([id, s]) => ({ id, position: { x: s.x + dx, y: s.y + dy } })),
        [...bdStartPos.entries()].map(([id, s]) => ({ id, position: { x: s.x + dx, y: s.y + dy } }))
      )
    }

    headerEl.addEventListener('pointermove', onMove)
    headerEl.addEventListener('pointerup',   onUp)
  }, [liveBackdrop, board.cards, board.backdrops, getViewerZoom, moveBackdropWithCards])

  const handleResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, pos: HandlePos) => {
    e.stopPropagation(); e.preventDefault()
    const handleEl   = e.currentTarget
    handleEl.setPointerCapture(e.pointerId)
    const backdropEl = handleEl.closest('[data-backdrop-id]') as HTMLElement | null
    const zoom = getViewerZoom()
    const startX = e.clientX, startY = e.clientY
    const origX = liveBackdrop.position.x, origY = liveBackdrop.position.y
    const origW = liveBackdrop.size.width,  origH = liveBackdrop.size.height

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
      updateBackdropSize(liveBackdrop.id, { x: newX, y: newY }, { width: newW, height: newH })
    }
    handleEl.addEventListener('pointermove', onMove)
    handleEl.addEventListener('pointerup',   onUp)
  }, [liveBackdrop, getViewerZoom, updateBackdropSize])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const ctxItems: ContextMenuItem[] = [
    { label: 'Edit attributes',        onClick: () => setIsEditing(v => !v) },
    { label: 'Duplicate backdrop',     divider: true, onClick: () => duplicateBackdrop(liveBackdrop.id) },
    { label: 'Duplicate with contents',               onClick: () => duplicateBackdropWithContents(liveBackdrop.id) },
    { label: 'Delete backdrop',        danger: true, divider: true, onClick: () => deleteBackdrop(liveBackdrop.id) },
  ]

  const panelLeft = liveBackdrop.position.x + liveBackdrop.size.width + 8
  const panelTop  = liveBackdrop.position.y

  // data-status attribute value for CSS hooks
  const dataStatus =
    backdropStatus === 'Cut'   ? 'cut'   :
    backdropStatus === 'Draft' ? 'draft' :
    undefined

  return (
    <>
      <div
        data-backdrop-id={liveBackdrop.id}
        data-bd-type={liveBackdrop.type}
        className={styles.backdrop}
        data-swatch={liveBackdrop.color}
        data-status={dataStatus}
        style={{
          transform: `translate(${liveBackdrop.position.x}px, ${liveBackdrop.position.y}px)`,
          width:  liveBackdrop.size.width,
          height: liveBackdrop.size.height,
          zIndex: liveBackdrop.zIndex,
        }}
      >
        <div className={styles.header} onPointerDown={handleHeaderPointerDown} onContextMenu={handleContextMenu}>
          <span className={styles.typeBadge}>{liveBackdrop.type}</span>
          <div className={styles.headerActions}>
            {backdropStatus === 'Draft' && (
              <span className={styles.draftStatusBadge}>DRAFT</span>
            )}
            {!isEditing && (
              <button className={styles.iconBtn}
                onPointerDown={e => { e.stopPropagation(); e.preventDefault(); setIsEditing(true) }}
                title="Edit"><EditIcon /></button>
            )}
          </div>
        </div>

        <div className={styles.body}>
          <div className={styles.titleArea}>
            <span className={`${styles.title} text-display`}
              onDoubleClick={e => { e.stopPropagation(); setIsEditing(true) }}
              style={{ pointerEvents: 'auto' }} title="Double-click to edit">
              {liveBackdrop.title}
            </span>
          </div>
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
          {liveBackdrop.note && !isEditing && (
            <div className={styles.noteDisplay}>{liveBackdrop.note}</div>
          )}
        </div>

        {HANDLES.map(pos => (
          <div key={pos} className={`${styles.handle} ${styles[`handle_${pos}`]}`}
            onPointerDown={e => handleResizePointerDown(e, pos)} />
        ))}
      </div>

      {isEditing && worldRef.current && createPortal(
        <div className={styles.editPanel}
          style={{ position: 'absolute', left: panelLeft, top: panelTop, zIndex: liveBackdrop.zIndex + 9000 }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>{liveBackdrop.title}</span>
            <button className={styles.panelClose}
              onPointerDown={e => { e.stopPropagation(); e.preventDefault(); setIsEditing(false) }}
              title="Close">×</button>
          </div>

          {/* Type — updateBackdropType snapshots internally, one undo step per change */}
          <div className={styles.field}>
            <label className={styles.label}>Type</label>
            <select className={styles.select} value={liveBackdrop.type}
              onChange={e => updateBackdropType(liveBackdrop.id, e.target.value as any)}>
              {[...BACKDROP_TYPES].sort().map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Title — snapshot on focus, then free-type */}
          <div className={styles.field}>
            <label className={styles.label}>Title</label>
            <input
              className={styles.input}
              value={liveBackdrop.title}
              onFocus={() => snapshotBoard()}
              onChange={e => updateBackdropContent(liveBackdrop.id, { title: e.target.value })}
              placeholder={liveBackdrop.type}
              autoFocus
            />
          </div>

          {/* Type-specific attribute fields — supports text, textarea, and select */}
          {schema.map(field => (
            <div key={field.key} className={styles.field}>
              <label className={styles.label}>{field.label}</label>
              {field.type === 'select' ? (
                /*
                 * Attribute select — discrete action, snapshot before change.
                 * defaultValue set → no blank option (e.g. status → 'Active').
                 * emptyLabel set  → blank option with custom label.
                 */
                <select
                  className={styles.select}
                  value={liveBackdrop.attributes[field.key] ?? (field.defaultValue ?? '')}
                  onChange={e => {
                    snapshotBoard()
                    updateBackdropAttribute(liveBackdrop.id, field.key, e.target.value)
                  }}
                >
                  {field.defaultValue === undefined && (
                    <option value="">{field.emptyLabel ?? '—'}</option>
                  )}
                  {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : field.type === 'textarea' ? (
                /* Attribute textarea — snapshot on focus, then free-type */
                <textarea
                  className={styles.textarea}
                  value={liveBackdrop.attributes[field.key] ?? ''}
                  onFocus={() => snapshotBoard()}
                  onChange={e => updateBackdropAttribute(liveBackdrop.id, field.key, e.target.value)}
                  placeholder={field.hint}
                  rows={2}
                />
              ) : (
                /* Attribute text input — snapshot on focus, then free-type */
                <input
                  className={styles.input}
                  value={liveBackdrop.attributes[field.key] ?? ''}
                  onFocus={() => snapshotBoard()}
                  onChange={e => updateBackdropAttribute(liveBackdrop.id, field.key, e.target.value)}
                  placeholder={field.hint}
                />
              )}
            </div>
          ))}

          {/* Note — snapshot on focus, then free-type */}
          <div className={styles.field}>
            <label className={styles.label}>Note <span className={styles.noteHint}>· lower-left</span></label>
            <textarea
              className={styles.textarea}
              value={liveBackdrop.note ?? ''}
              onFocus={() => snapshotBoard()}
              onChange={e => updateBackdropContent(liveBackdrop.id, { note: e.target.value } as any)}
              placeholder="Add a note…"
              rows={2}
            />
          </div>

          {/* Colour — snapshot before applying so each swatch click is its own undo step */}
          <div className={styles.field}>
            <label className={styles.label}>Color</label>
            <div className={styles.swatches}>
              {SWATCH_KEYS.map(swatch => (
                <div key={swatch} role="button"
                  className={`${styles.swatch} ${liveBackdrop.color === swatch ? styles.swatchActive : ''}`}
                  style={{ '--dot': `var(--swatch-${swatch})` } as React.CSSProperties}
                  onPointerDown={e => {
                    e.stopPropagation(); e.preventDefault()
                    snapshotBoard()
                    updateBackdropContent(liveBackdrop.id, { color: swatch as any })
                  }}
                  title={swatch} />
              ))}
            </div>
          </div>
        </div>,
        worldRef.current
      )}

      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxItems} onClose={() => setCtxMenu(null)} />}
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
