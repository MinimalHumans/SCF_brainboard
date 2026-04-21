import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
} from 'react'
import InfiniteViewer from 'react-infinite-viewer'
import Selecto from 'react-selecto'
import { useBoardStore, WORLD_SIZE, WORLD_CENTER, CARD_W, CARD_H } from '@/store/boardStore'
import { useSelectionStore } from '@/store/selectionStore'
import { CardComponent } from '@/components/Card/Card'
import styles from './Canvas.module.css'

export function Canvas() {
  const viewerRef      = useRef<InfiniteViewer>(null)
  const worldRef       = useRef<HTMLDivElement>(null)
  const canvasShellRef = useRef<HTMLDivElement>(null)
  const isSpaceDownRef = useRef(false)

  // Selecto needs a real DOM element, which only exists after first render
  const [shellEl, setShellEl] = useState<HTMLDivElement | null>(null)

  const { board, createCard, setViewport } = useBoardStore()
  const { clearSelection, selectMany }     = useSelectionStore()
  const { cards }                          = board

  // -------------------------------------------------------------------------
  // Mount: center viewport
  // -------------------------------------------------------------------------
  useEffect(() => {
    let frame: number
    const tryScroll = () => {
      const viewer = viewerRef.current
      if (!viewer) return
      try {
        viewer.scrollTo(
          WORLD_CENTER - window.innerWidth  / 2,
          WORLD_CENTER - (window.innerHeight - 48) / 2
        )
      } catch {
        frame = requestAnimationFrame(tryScroll)
      }
    }
    frame = requestAnimationFrame(tryScroll)
    return () => cancelAnimationFrame(frame)
  }, [])

  // -------------------------------------------------------------------------
  // Space key: track via ref (not state) to avoid re-renders.
  // preventDefault prevents InfiniteViewer's internal space handler.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); isSpaceDownRef.current = true }
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

  // -------------------------------------------------------------------------
  // Prevent middle mouse autoscroll
  // -------------------------------------------------------------------------
  useEffect(() => {
    const el = canvasShellRef.current
    if (!el) return
    const block = (e: MouseEvent) => { if (e.button === 1) e.preventDefault() }
    el.addEventListener('mousedown', block, { passive: false })
    return () => el.removeEventListener('mousedown', block)
  }, [])

  // -------------------------------------------------------------------------
  // Wheel → zoom toward cursor (setTo is the correct API for 0.28.x)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const el = canvasShellRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const viewer = viewerRef.current
      if (!viewer) return
      const rawDelta = e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY
      const nextZoom = Math.max(0.1, Math.min(4, viewer.getZoom() * Math.exp(-rawDelta / 500)))
      const rect     = el.getBoundingClientRect()
      viewer.setTo({ zoom: nextZoom, zoomOffsetX: e.clientX - rect.left, zoomOffsetY: e.clientY - rect.top })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // -------------------------------------------------------------------------
  // Keyboard shortcuts: Ctrl+A, Escape, F
  // -------------------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !inInput) {
        e.preventDefault()
        selectMany(cards.map(c => c.id))
      }
      if (e.key === 'Escape' && !inInput) clearSelection()
      if ((e.key === 'f' || e.key === 'F') && !inInput) { e.preventDefault(); frameAll() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, selectMany, clearSelection])

  // -------------------------------------------------------------------------
  // Frame all cards (F)
  // setTo is atomic: sets x, y, and zoom together — no RAF needed
  // -------------------------------------------------------------------------
  const frameAll = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer || cards.length === 0) return
    const PAD = 80, TOOLBAR_H = 48
    const minX = Math.min(...cards.map(c => c.position.x)) - PAD
    const minY = Math.min(...cards.map(c => c.position.y)) - PAD
    const maxX = Math.max(...cards.map(c => c.position.x + CARD_W)) + PAD
    const maxY = Math.max(...cards.map(c => c.position.y + CARD_H)) + PAD
    const vpW  = window.innerWidth
    const vpH  = window.innerHeight - TOOLBAR_H
    const z    = Math.min(vpW / (maxX - minX), vpH / (maxY - minY), 1)
    viewer.setTo({
      x:    (minX + maxX) / 2 - vpW  / (2 * z),
      y:    (minY + maxY) / 2 - vpH / (2 * z),
      zoom: z,
    })
  }, [cards])

  // -------------------------------------------------------------------------
  // Pan — fires on: space + left-drag OR middle-mouse drag on world layer.
  //
  // Left-drag WITHOUT space is handled by react-selecto (rubber-band).
  // The selecto dragCondition returns false when space is held, so these
  // two are mutually exclusive.
  // -------------------------------------------------------------------------
  const handleWorldPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return  // clicking a card — not our job

      const isPan = e.button === 1 || (e.button === 0 && isSpaceDownRef.current)
      if (!isPan) return  // let selecto handle left-click rubber band

      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)

      const viewer     = viewerRef.current!
      const startX     = e.clientX
      const startY     = e.clientY
      const startSX    = viewer.getScrollLeft()
      const startSY    = viewer.getScrollTop()

      target.style.cursor = 'grabbing'

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
    },
    []
  )

  // -------------------------------------------------------------------------
  // Double-click empty world → create card
  // -------------------------------------------------------------------------
  const handleWorldDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return
      const viewer = viewerRef.current
      if (!viewer) return
      const zoom = viewer.getZoom()
      const rect = worldRef.current!.getBoundingClientRect()
      createCard({ x: (e.clientX - rect.left) / zoom - CARD_W / 2, y: (e.clientY - rect.top) / zoom - CARD_H / 2 })
    },
    [createCard]
  )

  // Click on empty canvas → clear selection
  const handleWorldClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) clearSelection() },
    [clearSelection]
  )

  const syncViewport = useCallback(() => {
    const v = viewerRef.current
    if (v) setViewport({ x: v.getScrollLeft(), y: v.getScrollTop(), zoom: v.getZoom() })
  }, [setViewport])

  const getViewerZoom = useCallback(() => viewerRef.current?.getZoom() ?? 1, [])

  return (
    <div
      ref={el => { canvasShellRef.current = el; setShellEl(el) }}
      className={styles.canvasShell}
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
          onDoubleClick={handleWorldDoubleClick}
          onClick={handleWorldClick}
        >
          {cards.map(card => (
            <CardComponent
              key={card.id}
              card={card}
              allCards={cards}
              getViewerZoom={getViewerZoom}
            />
          ))}
        </div>
      </InfiniteViewer>

      {/* Selecto rubber-band — lives outside the viewer so the band renders
          in screen space, not scaled world space. Card hit detection works
          correctly because getBoundingClientRect is always screen coordinates. */}
      {shellEl && (
        <Selecto
          container={shellEl}
          rootContainer={shellEl}
          selectableTargets={['[data-card-id]']}
          hitRate={0}
          selectByClick={false}
          continueSelect={false}
          dragCondition={(e) => {
            const target = (e.inputEvent as MouseEvent).target as Element
            // Skip rubber-band if: clicking on a card, or space is held (pan mode)
            if (target.closest('[data-card-id]')) return false
            if (isSpaceDownRef.current) return false
            return true
          }}
          onSelect={({ selected }) => {
            selectMany(
              selected
                .map(el => (el as HTMLElement).dataset.cardId)
                .filter(Boolean) as string[]
            )
          }}
        />
      )}

      {cards.length === 0 && <EmptyState />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
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
          <line x1="16" y1="4"  x2="16" y2="28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="4"  y1="16" x2="28" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <p className={styles.emptyPrimary}>Your board is empty</p>
      <p className={styles.emptySecondary}>Double-click anywhere to add a card</p>
      <div className={styles.shortcuts}>
        <Shortcut keys={['Double-click']}    label="New card"     />
        <Shortcut keys={['Drag']}            label="Select"       />
        <Shortcut keys={['Space', 'Drag']}   label="Pan"          />
        <Shortcut keys={['Scroll']}          label="Zoom"         />
        <Shortcut keys={['F']}               label="Frame all"    />
        <Shortcut keys={['Ctrl', 'A']}       label="Select all"   />
      </div>
    </div>
  )
}
