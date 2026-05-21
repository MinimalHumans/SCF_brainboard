import React, { useRef, useEffect, useCallback, useState } from 'react'
import Selecto from 'react-selecto'
import { useBoardStore, WORLD_SIZE, WORLD_CENTER, CARD_W, CARD_H } from '@/store/boardStore'
import { useSelectionStore } from '@/store/selectionStore'
import { useViewerStore } from '@/store/viewerStore'
import { CardComponent } from '@/components/Card/Card'
import { BackdropComponent } from '@/components/Backdrop/Backdrop'
import { ContextMenu } from '@/components/ContextMenu/ContextMenu'
import type { ContextMenuItem } from '@/components/ContextMenu/ContextMenu'
import type { BackdropType } from '@/types/board'
import { TabMenu } from '@/components/TabMenu/TabMenu'
import styles from './Canvas.module.css'

/*
 * Canvas — manual pan/zoom implementation.
 * ----------------------------------------
 *
 * This file replaces a previous react-infinite-viewer implementation. The
 * reason for the rewrite is a stubborn "double transform" bug on touch
 * devices: when dragging a card with a finger, both the card AND the canvas
 * would move in parallel. Every CSS-side fix (touch-action: none, cascaded
 * through descendants) failed in the field, even though the spec says it
 * should suffice. The simplest explanation is that something — either iOS
 * Safari's nested-scrollable-container quirks or an InfiniteViewer-internal
 * touch handler — was still initiating a parallel pan on the
 * native-scrollable wrapper that the library used to position its content.
 *
 * The bypass: drop the scroll-based positioning entirely. The .world is now
 * a position:absolute div sitting inside an overflow:hidden shell, and pan
 * is implemented as a CSS transform we write directly. There is no
 * scrollable container anywhere in the canvas tree, so the browser has
 * nothing to native-scroll regardless of touch-action.
 *
 * Coordinate system (unchanged from the old code, just sourced differently):
 *   - viewport.x, viewport.y = world-coord top-left of the visible shell
 *   - viewport.zoom          = scale factor
 *   - world transform        = translate3d(-vx*z, -vy*z, 0) scale(z)
 *     with transform-origin: 0 0
 *   - screenToWorld(sx, sy)  = (sx/z + vx, sy/z + vy)  (relative to shell)
 *
 * Pan triggers:
 *   - Mouse middle button
 *   - Mouse left + Space held
 *   - Touch (primary finger) anywhere on empty world
 *   - Pen (primary contact) anywhere on empty world
 *
 * Pinch zoom (two-finger) is NOT implemented here. The existing build never
 * had it; this fix is scoped to the double-transform bug. Wheel zoom and
 * the toolbar zoom controls still work for desktop, and the keyboard
 * shortcuts (F to frame, Ctrl+Z, etc.) are untouched.
 */

interface DrawState {
  type:     BackdropType
  startX:   number  // world coords
  startY:   number
  currentX: number
  currentY: number
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 4

export function Canvas() {
  const worldRef       = useRef<HTMLDivElement>(null)
  const canvasShellRef = useRef<HTMLDivElement>(null)
  const isSpaceDownRef = useRef(false)
  const suppressNextClickRef  = useRef(false)
  const lastMouseWorldRef     = useRef({ x: WORLD_CENTER, y: WORLD_CENTER })
  const lastMouseScreenRef    = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

  const [shellEl,      setShellEl]      = useState<HTMLDivElement | null>(null)
  const [tabMenu,      setTabMenu]      = useState<{ worldX: number; worldY: number; screenX: number; screenY: number } | null>(null)
  const [creationMode, setCreationMode] = useState<BackdropType | null>(null)
  const [drawState,    setDrawState]    = useState<DrawState | null>(null)
  const [canvasMenu,   setCanvasMenu]   = useState<{ x: number; y: number; wx: number; wy: number } | null>(null)

  // Board state — board updates re-render Canvas (matching the previous
  // file's pattern). The world's CSS transform is recomputed on render
  // from viewport, which makes pan/zoom visually update without any
  // imperative DOM manipulation.
  const board    = useBoardStore(s => s.board)
  const viewport = board.viewport
  const { cards, backdrops } = board

  const createCard      = useBoardStore(s => s.createCard)
  const duplicateCard   = useBoardStore(s => s.duplicateCard)
  const createInstance  = useBoardStore(s => s.createInstance)
  const deleteCards     = useBoardStore(s => s.deleteCards)
  const createBackdrop  = useBoardStore(s => s.createBackdrop)
  const undo            = useBoardStore(s => s.undo)
  const redo            = useBoardStore(s => s.redo)

  const { clearSelection, selectMany } = useSelectionStore()

  // ── Helpers: read viewport from store synchronously ───────────────────────
  const getViewport   = useCallback(() => useBoardStore.getState().board.viewport, [])
  const getViewerZoom = useCallback(() => getViewport().zoom, [getViewport])

  // ── screen → world ─────────────────────────────────────────────────────────
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const shell = canvasShellRef.current
    if (!shell) return { x: 0, y: 0 }
    const rect = shell.getBoundingClientRect()
    const vp = getViewport()
    return {
      x: (clientX - rect.left) / vp.zoom + vp.x,
      y: (clientY - rect.top)  / vp.zoom + vp.y,
    }
  }, [getViewport])

  // ── Mount: center viewport on world center ────────────────────────────────
  // Matches previous behavior (always center on mount). If you ever want to
  // restore the saved viewport from localStorage instead, you'd skip this
  // when the loaded viewport is not the default.
  useEffect(() => {
    const shell = canvasShellRef.current
    if (!shell) return
    const rect = shell.getBoundingClientRect()
    useBoardStore.getState().setViewport({
      x: WORLD_CENTER - rect.width / 2,
      y: WORLD_CENTER - rect.height / 2,
      zoom: 1,
    })
  }, [])

  // ── Space key tracking ────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const active = document.activeElement
      const inInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      if (!inInput) { e.preventDefault(); isSpaceDownRef.current = true }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') isSpaceDownRef.current = false
    }
    window.addEventListener('keydown', onKeyDown, { passive: false })
    window.addEventListener('keyup',   onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)
    }
  }, [])

  // ── Tab → TabMenu; Escape → cancel modes ─────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (inInput) return

      if (e.key === 'Tab') {
        e.preventDefault()
        if (tabMenu) { setTabMenu(null); return }
        setTabMenu({
          worldX:  lastMouseWorldRef.current.x,
          worldY:  lastMouseWorldRef.current.y,
          screenX: lastMouseScreenRef.current.x,
          screenY: lastMouseScreenRef.current.y,
        })
        return
      }

      if (e.key !== 'Escape') return
      if (creationMode) { setCreationMode(null); setDrawState(null); return }
      if (tabMenu)      { setTabMenu(null); return }
      clearSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [creationMode, tabMenu, clearSelection])

  // ── Middle mouse prevention ───────────────────────────────────────────────
  useEffect(() => {
    const el = canvasShellRef.current
    if (!el) return
    const block = (e: MouseEvent) => { if (e.button === 1) e.preventDefault() }
    el.addEventListener('mousedown', block, { passive: false })
    return () => el.removeEventListener('mousedown', block)
  }, [])

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = canvasShellRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rawDelta = e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY
      const vp = getViewport()
      const oldZoom = vp.zoom
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * Math.exp(-rawDelta / 500)))
      const rect = el.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const worldX = sx / oldZoom + vp.x
      const worldY = sy / oldZoom + vp.y
      useBoardStore.getState().setViewport({
        x: worldX - sx / newZoom,
        y: worldY - sy / newZoom,
        zoom: newZoom,
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [getViewport])

  // ── Toolbar zoom commands ─────────────────────────────────────────────────
  const zoomCommand      = useViewerStore(s => s.zoomCommand)
  const clearZoomCommand = useViewerStore(s => s.clearZoomCommand)

  useEffect(() => {
    if (!zoomCommand) return
    const el = canvasShellRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vpCx = rect.width  / 2
    const vpCy = rect.height / 2
    const vp = getViewport()
    const oldZoom = vp.zoom
    let newZoom = oldZoom
    if (zoomCommand.type === 'in')    newZoom = Math.min(MAX_ZOOM, oldZoom * 1.25)
    if (zoomCommand.type === 'out')   newZoom = Math.max(MIN_ZOOM, oldZoom / 1.25)
    if (zoomCommand.type === 'reset') newZoom = 1
    const worldX = vpCx / oldZoom + vp.x
    const worldY = vpCy / oldZoom + vp.y
    useBoardStore.getState().setViewport({
      x: worldX - vpCx / newZoom,
      y: worldY - vpCy / newZoom,
      zoom: newZoom,
    })
    clearZoomCommand()
  }, [zoomCommand, clearZoomCommand, getViewport])

  // ── Frame all ─────────────────────────────────────────────────────────────
  const frameAll = useCallback(() => {
    const { cards, backdrops } = useBoardStore.getState().board
    if (cards.length === 0 && backdrops.length === 0) return
    const shell = canvasShellRef.current
    if (!shell) return
    const PAD = 80

    const x1s = [
      ...cards.map(c => c.position.x),
      ...backdrops.map(b => b.position.x),
    ]
    const y1s = [
      ...cards.map(c => c.position.y),
      ...backdrops.map(b => b.position.y),
    ]
    const x2s = [
      ...cards.map(c => c.position.x + CARD_W),
      ...backdrops.map(b => b.position.x + b.size.width),
    ]
    const y2s = [
      ...cards.map(c => c.position.y + CARD_H),
      ...backdrops.map(b => b.position.y + b.size.height),
    ]

    const minX = Math.min(...x1s) - PAD
    const minY = Math.min(...y1s) - PAD
    const maxX = Math.max(...x2s) + PAD
    const maxY = Math.max(...y2s) + PAD
    const rect = shell.getBoundingClientRect()
    const vpW = rect.width
    const vpH = rect.height
    const newZoom = Math.min(vpW / (maxX - minX), vpH / (maxY - minY), 1)
    useBoardStore.getState().setViewport({
      x: (minX + maxX) / 2 - vpW / (2 * newZoom),
      y: (minY + maxY) / 2 - vpH / (2 * newZoom),
      zoom: newZoom,
    })
  }, [])

  // Frame All command from toolbar
  const frameCommand = useViewerStore(s => s.frameCommand)
  useEffect(() => {
    if (frameCommand > 0) frameAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameCommand])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (inInput) return
      const sel = useSelectionStore.getState()
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); selectMany(cards.map(c => c.id)); return }
      if (e.key === 'f' || e.key === 'F')             { e.preventDefault(); frameAll(); return }
      if (sel.selectedIds.size === 0) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault()
        ;[...sel.selectedIds].forEach(id => duplicateCard(id))
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault()
        const first = cards.find(c => sel.selectedIds.has(c.id) && c.entityId !== null)
        if (first) createInstance(first.id, { x: first.position.x + 32, y: first.position.y + 32 })
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteCards([...sel.selectedIds])
        clearSelection()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, selectMany, clearSelection, duplicateCard, deleteCards, undo, redo, frameAll, createInstance])

  // ── Instance creation ─────────────────────────────────────────────────────
  const handleCreateInstance = useCallback((cardId: string) => {
    const card = useBoardStore.getState().board.cards.find(c => c.id === cardId)
    if (!card) return
    createInstance(cardId, { x: card.position.x + 32, y: card.position.y + 32 })
  }, [createInstance])

  // ── World pointerdown — pan / draw ─────────────────────────────────────────
  const handleWorldPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only respond when the pointer hit empty world (not a card / backdrop).
    if (e.target !== e.currentTarget) return

    // Creation mode: start drawing a backdrop
    if (creationMode && e.button === 0) {
      const { x, y } = screenToWorld(e.clientX, e.clientY)
      e.currentTarget.setPointerCapture(e.pointerId)
      setDrawState({ type: creationMode, startX: x, startY: y, currentX: x, currentY: y })
      return
    }

    // Second touch ignored — we only handle primary pointer pan. Reserved
    // for a future pinch-zoom implementation if Chris wants it.
    if (e.pointerType === 'touch' && !e.isPrimary) return

    // Pan triggers:
    //   - mouse: middle button OR left + Space
    //   - touch: primary finger
    //   - pen:   primary contact
    const isPanIntent =
      (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && isSpaceDownRef.current))) ||
      (e.pointerType === 'touch' && e.isPrimary) ||
      (e.pointerType === 'pen'   && e.isPrimary)

    if (!isPanIntent) return

    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    target.style.cursor = 'grabbing'

    const startX = e.clientX, startY = e.clientY
    const start  = getViewport()

    const onMove = (me: PointerEvent) => {
      const dx = me.clientX - startX
      const dy = me.clientY - startY
      useBoardStore.getState().setViewport({
        x: start.x - dx / start.zoom,
        y: start.y - dy / start.zoom,
        zoom: start.zoom,
      })
    }
    const onUp = () => {
      target.style.cursor = ''
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup',   onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup',   onUp)
  }, [creationMode, screenToWorld, getViewport])

  const handleWorldPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Track cursor world position for Tab menu placement
    const vp = getViewport()
    const shell = canvasShellRef.current
    if (shell) {
      const rect = shell.getBoundingClientRect()
      lastMouseWorldRef.current = {
        x: (e.clientX - rect.left) / vp.zoom + vp.x,
        y: (e.clientY - rect.top)  / vp.zoom + vp.y,
      }
    }
    lastMouseScreenRef.current = { x: e.clientX, y: e.clientY }
    if (!drawState) return
    const { x, y } = screenToWorld(e.clientX, e.clientY)
    setDrawState(s => s ? { ...s, currentX: x, currentY: y } : null)
  }, [drawState, screenToWorld, getViewport])

  const handleWorldPointerUp = useCallback(() => {
    if (!drawState) return
    const { type, startX, startY, currentX, currentY } = drawState

    const x = Math.min(startX, currentX)
    const y = Math.min(startY, currentY)
    const w = Math.abs(currentX - startX)
    const h = Math.abs(currentY - startY)

    if (w >= 80 && h >= 60) {
      createBackdrop({ x, y }, { width: w, height: h }, type)
    }

    setDrawState(null)
    setCreationMode(null)
    suppressNextClickRef.current = true
  }, [drawState, createBackdrop])

  // ── Right-click menu ─────────────────────────────────────────────────────
  const handleWorldContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    e.preventDefault()
    const { x, y } = screenToWorld(e.clientX, e.clientY)
    setCanvasMenu({ x: e.clientX, y: e.clientY, wx: x, wy: y })
  }, [screenToWorld])

  const canvasMenuItems: ContextMenuItem[] = canvasMenu ? [
    { label: 'New Card here', onClick: () => createCard({ x: canvasMenu.wx - CARD_W / 2, y: canvasMenu.wy - CARD_H / 2 }) },
    { label: 'Draw Act backdrop',      divider: true, onClick: () => setCreationMode('Act')      },
    { label: 'Draw Sequence backdrop',               onClick: () => setCreationMode('Sequence')  },
    { label: 'Draw Scene backdrop',                  onClick: () => setCreationMode('Scene')     },
    { label: 'Draw Beat backdrop',                   onClick: () => setCreationMode('Beat')      },
    { label: 'Draw Custom backdrop',                 onClick: () => setCreationMode('Custom')    },
  ] : []

  // ── Double-click: create card ─────────────────────────────────────────────
  const handleWorldDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (creationMode) return
    const { x, y } = screenToWorld(e.clientX, e.clientY)
    createCard({ x: x - CARD_W / 2, y: y - CARD_H / 2 })
  }, [createCard, creationMode, screenToWorld])

  const handleWorldClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (suppressNextClickRef.current) { suppressNextClickRef.current = false; return }
    if (!creationMode) clearSelection()
  }, [clearSelection, creationMode])

  // ── Draw preview dimensions ───────────────────────────────────────────────
  const drawPreview = drawState ? {
    x: Math.min(drawState.startX, drawState.currentX),
    y: Math.min(drawState.startY, drawState.currentY),
    w: Math.abs(drawState.currentX - drawState.startX),
    h: Math.abs(drawState.currentY - drawState.startY),
  } : null

  // ── World transform — recomputed on every viewport change ─────────────────
  // translate3d + scale, transform-origin: 0 0 (set in CSS).
  // translate3d nudges the browser onto the GPU compositor for smoother pan.
  const worldTransform = `translate3d(${-viewport.x * viewport.zoom}px, ${-viewport.y * viewport.zoom}px, 0) scale(${viewport.zoom})`

  return (
    <div
      ref={el => { canvasShellRef.current = el; setShellEl(el) }}
      className={[
        styles.canvasShell,
        creationMode ? styles.drawMode : '',
      ].join(' ').trim()}
    >
      <div
        ref={worldRef}
        className={`${styles.world} canvas-grid`}
        style={{
          width:     WORLD_SIZE,
          height:    WORLD_SIZE,
          transform: worldTransform,
        }}
        onPointerDown={handleWorldPointerDown}
        onPointerMove={handleWorldPointerMove}
        onPointerUp={handleWorldPointerUp}
        onDoubleClick={handleWorldDoubleClick}
        onClick={handleWorldClick}
        onContextMenu={handleWorldContextMenu}
      >
        {/* Backdrop layer — always behind cards */}
        <div className={styles.backdropLayer}>
          {backdrops.map(backdrop => (
            <BackdropComponent
              key={backdrop.id}
              backdrop={backdrop}
              getViewerZoom={getViewerZoom}
              worldRef={worldRef}
            />
          ))}

          {/* Draw preview rect */}
          {drawPreview && drawPreview.w > 4 && drawPreview.h > 4 && (
            <div
              className={styles.drawPreview}
              style={{
                transform: `translate(${drawPreview.x}px, ${drawPreview.y}px)`,
                width:     drawPreview.w,
                height:    drawPreview.h,
              }}
            />
          )}
        </div>

        {/* Card layer */}
        <div className={styles.cardLayer}>
          {cards.map(card => (
            <CardComponent
              key={card.id}
              card={card}
              allCards={cards}
              getViewerZoom={getViewerZoom}
              onCreateInstance={handleCreateInstance}
              worldRef={worldRef}
            />
          ))}
        </div>
      </div>

      {/* Selecto rubber-band — desktop only via dragCondition */}
      {shellEl && !creationMode && (
        <Selecto
          container={shellEl}
          rootContainer={shellEl}
          selectableTargets={['[data-card-id]']}
          hitRate={0}
          selectByClick={false}
          continueSelect={false}
          dragCondition={e => {
            const ie = e.inputEvent as PointerEvent | MouseEvent | TouchEvent
            if ('pointerType' in ie && (ie as PointerEvent).pointerType === 'touch') return false
            if (typeof TouchEvent !== 'undefined' && ie instanceof TouchEvent) return false
            const target = ie.target as Element
            if (target.closest('[data-card-id]') || target.closest('[data-backdrop-id]')) return false
            if (isSpaceDownRef.current) return false
            return true
          }}
          onSelectEnd={({ selected }) => {
            suppressNextClickRef.current = true
            if (selected.length > 0) {
              selectMany(selected.map(el => (el as HTMLElement).dataset.cardId!).filter(Boolean))
            } else {
              suppressNextClickRef.current = false
            }
          }}
        />
      )}

      {/* Creation mode hint banner */}
      {creationMode && (
        <div className={styles.creationBanner}>
          Drawing <strong>{creationMode}</strong> backdrop — drag to define bounds · Esc to cancel
        </div>
      )}

      {/* Canvas context menu */}
      {canvasMenu && (
        <ContextMenu
          x={canvasMenu.x}
          y={canvasMenu.y}
          items={canvasMenuItems}
          onClose={() => setCanvasMenu(null)}
        />
      )}

      {cards.length === 0 && backdrops.length === 0 && <EmptyState />}

      {tabMenu && (
        <TabMenu
          worldX={tabMenu.worldX}
          worldY={tabMenu.worldY}
          screenX={tabMenu.screenX}
          screenY={tabMenu.screenY}
          onClose={() => setTabMenu(null)}
          getViewerZoom={getViewerZoom}
        />
      )}
    </div>
  )
}

function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className={styles.shortcut}>
      <span className={styles.shortcutLabel}>{label}</span>
      <span className={styles.shortcutKeys}>
        {keys.map((k, i) => (
          <React.Fragment key={k}>
            <kbd className={styles.kbd}>{k}</kbd>
            {i < keys.length - 1 && <span className={styles.plus}>+</span>}
          </React.Fragment>
        ))}
      </span>
    </div>
  )
}

function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon} aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <line x1="16" y1="4"  x2="16" y2="28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="4"  y1="16" x2="28" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
      <p className={styles.emptyPrimary}>Your board is empty</p>
      <p className={styles.emptySecondary}>Double-click to add a card · Right-click for more options</p>
      <div className={styles.shortcuts}>
        <Shortcut keys={['Double-click']}  label="New card"     />
        <Shortcut keys={['Right-click']}   label="New backdrop" />
        <Shortcut keys={['Space', 'Drag']} label="Pan"          />
        <Shortcut keys={['Scroll']}        label="Zoom"         />
        <Shortcut keys={['F']}             label="Frame all"    />
      </div>
    </div>
  )
}
