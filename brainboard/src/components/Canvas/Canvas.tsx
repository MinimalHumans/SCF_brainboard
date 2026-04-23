import React, { useRef, useEffect, useCallback, useState } from 'react'
import InfiniteViewer from 'react-infinite-viewer'
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

// ---------------------------------------------------------------------------
// Backdrop draw-to-create state
// ---------------------------------------------------------------------------
interface DrawState {
  type:    BackdropType
  startX:  number  // world coords
  startY:  number
  currentX: number
  currentY: number
}

export function Canvas() {
  const viewerRef      = useRef<InfiniteViewer>(null)
  const worldRef       = useRef<HTMLDivElement>(null)
  const canvasShellRef = useRef<HTMLDivElement>(null)
  const isSpaceDownRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  const lastMouseWorldRef     = useRef({ x: 4000, y: 4000 })

  const [shellEl, setShellEl]         = useState<HTMLDivElement | null>(null)
  // Tab menu: stores viewport-center world coords when opened
  const [tabMenu, setTabMenu]           = useState<{ worldX: number; worldY: number } | null>(null)
  const [creationMode, setCreationMode] = useState<BackdropType | null>(null)
  const [drawState, setDrawState]       = useState<DrawState | null>(null)
  const [canvasMenu, setCanvasMenu]     = useState<{ x: number; y: number; wx: number; wy: number } | null>(null)

  const { board, createCard, duplicateCard, createInstance, deleteCards, setViewport, createBackdrop } = useBoardStore()
  const { clearSelection, selectMany } = useSelectionStore()
  const { cards, backdrops }           = board

  // ── Mount: center viewport ────────────────────────────────────────────────
  useEffect(() => {
    let frame: number
    const tryScroll = () => {
      try {
        viewerRef.current?.scrollTo(
          WORLD_CENTER - window.innerWidth  / 2,
          WORLD_CENTER - (window.innerHeight - 76) / 2
        )
      } catch { frame = requestAnimationFrame(tryScroll) }
    }
    frame = requestAnimationFrame(tryScroll)
    return () => cancelAnimationFrame(frame)
  }, [])

  // ── Space key ─────────────────────────────────────────────────────────────
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

  // ── Tab → TabMenu; Escape → cancel modes ────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (inInput) return

      if (e.key === 'Tab') {
        e.preventDefault()
        if (tabMenu) { setTabMenu(null); return }
        const viewer = viewerRef.current
        const el     = canvasShellRef.current
        if (!viewer || !el) return
        // Place menu at last known cursor world position
        setTabMenu({ worldX: lastMouseWorldRef.current.x, worldY: lastMouseWorldRef.current.y })
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
      const viewer = viewerRef.current
      if (!viewer) return
      const rawDelta = e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY
      const oldZoom  = viewer.getZoom()
      const newZoom  = Math.max(0.1, Math.min(4, oldZoom * Math.exp(-rawDelta / 500)))
      const rect     = el.getBoundingClientRect()
      const screenX  = e.clientX - rect.left
      const screenY  = e.clientY - rect.top
      const worldX   = screenX / oldZoom + viewer.getScrollLeft()
      const worldY   = screenY / oldZoom + viewer.getScrollTop()
      viewer.setTo({ x: worldX - screenX / newZoom, y: worldY - screenY / newZoom, zoom: newZoom })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── Toolbar zoom commands ─────────────────────────────────────────────────
  const zoomCommand      = useViewerStore(s => s.zoomCommand)
  const clearZoomCommand = useViewerStore(s => s.clearZoomCommand)

  useEffect(() => {
    if (!zoomCommand) return
    const viewer = viewerRef.current
    const el     = canvasShellRef.current
    if (!viewer || !el) return
    const vpCx   = el.getBoundingClientRect().width  / 2
    const vpCy   = el.getBoundingClientRect().height / 2
    const oldZoom = viewer.getZoom()
    let newZoom   = oldZoom
    if (zoomCommand.type === 'in')    newZoom = Math.min(4,   oldZoom * 1.25)
    if (zoomCommand.type === 'out')   newZoom = Math.max(0.1, oldZoom / 1.25)
    if (zoomCommand.type === 'reset') newZoom = 1
    const worldX = vpCx / oldZoom + viewer.getScrollLeft()
    const worldY = vpCy / oldZoom + viewer.getScrollTop()
    viewer.setTo({ x: worldX - vpCx / newZoom, y: worldY - vpCy / newZoom, zoom: newZoom })
    clearZoomCommand()
  }, [zoomCommand, clearZoomCommand])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const frameAll = useCallback(() => {
    const viewer = viewerRef.current
    const { cards, backdrops } = useBoardStore.getState().board
    if (!viewer || (cards.length === 0 && backdrops.length === 0)) return
    const PAD = 80, TH = 76

    // Collect all bounding box corners: cards + backdrops
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
    const vpW  = window.innerWidth
    const vpH  = window.innerHeight - TH
    const z    = Math.min(vpW / (maxX - minX), vpH / (maxY - minY), 1)
    viewer.setTo({ x: (minX+maxX)/2 - vpW/(2*z), y: (minY+maxY)/2 - vpH/(2*z), zoom: z })
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (inInput) return
      const sel = useSelectionStore.getState()
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
  }, [cards, selectMany, clearSelection, duplicateCard, deleteCards])

  // ── Instance creation ─────────────────────────────────────────────────────
  const handleCreateInstance = useCallback((cardId: string) => {
    const card = useBoardStore.getState().board.cards.find(c => c.id === cardId)
    if (!card) return
    createInstance(cardId, { x: card.position.x + 32, y: card.position.y + 32 })
  }, [createInstance])

  // ── Screen → world coordinate helper ─────────────────────────────────────
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const viewer = viewerRef.current
    const world  = worldRef.current
    if (!viewer || !world) return { x: 0, y: 0 }
    const zoom = viewer.getZoom()
    const rect = world.getBoundingClientRect()
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom }
  }, [])

  // ── Pan ────────────────────────────────────────────────────────────────────
  const handleWorldPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return

    // In creation mode: start drawing a backdrop
    if (creationMode && e.button === 0) {
      const { x, y } = screenToWorld(e.clientX, e.clientY)
      e.currentTarget.setPointerCapture(e.pointerId)
      setDrawState({ type: creationMode, startX: x, startY: y, currentX: x, currentY: y })
      return
    }

    const isPan = e.button === 1 || (e.button === 0 && isSpaceDownRef.current)
    if (!isPan) return

    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    target.style.cursor = 'grabbing'

    const viewer = viewerRef.current!
    const startX = e.clientX, startY = e.clientY
    const startSX = viewer.getScrollLeft(), startSY = viewer.getScrollTop()

    const onMove = (me: PointerEvent) => {
      const zoom = viewer.getZoom()
      viewer.scrollTo(startSX - (me.clientX - startX) / zoom, startSY - (me.clientY - startY) / zoom)
    }
    const onUp = () => {
      target.style.cursor = ''
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup',   onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup',   onUp)
  }, [creationMode, screenToWorld])

  const handleWorldPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Always track cursor world position for Tab menu placement
    const viewer = viewerRef.current
    const world  = worldRef.current
    if (viewer && world) {
      const zoom = viewer.getZoom()
      const rect = world.getBoundingClientRect()
      lastMouseWorldRef.current = {
        x: (e.clientX - rect.left) / zoom,
        y: (e.clientY - rect.top)  / zoom,
      }
    }
    if (!drawState) return
    const { x, y } = screenToWorld(e.clientX, e.clientY)
    setDrawState(s => s ? { ...s, currentX: x, currentY: y } : null)
  }, [drawState, screenToWorld])

  const handleWorldPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawState) return
    const { type, startX, startY, currentX, currentY } = drawState

    const x = Math.min(startX, currentX)
    const y = Math.min(startY, currentY)
    const w = Math.abs(currentX - startX)
    const h = Math.abs(currentY - startY)

    // Only create if large enough to be intentional
    if (w >= 80 && h >= 60) {
      createBackdrop({ x, y }, { width: w, height: h }, type)
    }

    setDrawState(null)
    setCreationMode(null)
    suppressNextClickRef.current = true
  }, [drawState, createBackdrop])

  // ── Canvas right-click menu ───────────────────────────────────────────────
  const handleWorldContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    e.preventDefault()
    const { x, y } = screenToWorld(e.clientX, e.clientY)
    setCanvasMenu({ x: e.clientX, y: e.clientY, wx: x, wy: y })
  }, [screenToWorld])

  const canvasMenuItems: ContextMenuItem[] = canvasMenu ? [
    {
      label:   'New Card here',
      onClick: () => createCard({ x: canvasMenu.wx - CARD_W / 2, y: canvasMenu.wy - CARD_H / 2 }),
    },
    {
      label:    'Add Sequence backdrop',
      divider:  true,
      onClick:  () => setCreationMode('Sequence'),
    },
    {
      label:   'Add Act backdrop',
      onClick: () => setCreationMode('Act'),
    },
    {
      label:   'Add Beat backdrop',
      onClick: () => setCreationMode('Beat'),
    },
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

  const syncViewport = useCallback(() => {
    const v = viewerRef.current
    if (v) setViewport({ x: v.getScrollLeft(), y: v.getScrollTop(), zoom: v.getZoom() })
  }, [setViewport])

  const getViewerZoom = useCallback(() => viewerRef.current?.getZoom() ?? 1, [])

  // ── Draw preview dimensions ───────────────────────────────────────────────
  const drawPreview = drawState ? {
    x: Math.min(drawState.startX, drawState.currentX),
    y: Math.min(drawState.startY, drawState.currentY),
    w: Math.abs(drawState.currentX - drawState.startX),
    h: Math.abs(drawState.currentY - drawState.startY),
  } : null

  return (
    <div
      ref={el => { canvasShellRef.current = el; setShellEl(el) }}
      className={[
        styles.canvasShell,
        creationMode ? styles.drawMode : '',
      ].join(' ').trim()}
    >
      <InfiniteViewer
        ref={viewerRef}
        className={styles.viewer}
        useMouseDrag={false}
        useWheelScroll={false}
        onScroll={syncViewport}
        onZoom={syncViewport}
      >
        <div
          ref={worldRef}
          className={`${styles.world} canvas-grid`}
          style={{ width: WORLD_SIZE, height: WORLD_SIZE }}
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
              />
            ))}
          </div>
        </div>
      </InfiniteViewer>

      {/* Selecto rubber-band */}
      {shellEl && !creationMode && (
        <Selecto
          container={shellEl}
          rootContainer={shellEl}
          selectableTargets={['[data-card-id]']}
          hitRate={0}
          selectByClick={false}
          continueSelect={false}
          dragCondition={e => {
            const target = (e.inputEvent as MouseEvent).target as Element
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
