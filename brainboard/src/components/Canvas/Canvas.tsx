import React, { useRef, useEffect, useCallback, useState } from 'react'
import Selecto from 'react-selecto'
import { useBoardStore, WORLD_SIZE, WORLD_CENTER, CARD_W, CARD_H } from '@/store/boardStore'
import { useSelectionStore } from '@/store/selectionStore'
import { useViewerStore } from '@/store/viewerStore'
import { CardComponent } from '@/components/Card/Card'
import { BackdropComponent } from '@/components/Backdrop/Backdrop'
import { ContextMenu } from '@/components/ContextMenu/ContextMenu'
import type { ContextMenuItem } from '@/components/ContextMenu/ContextMenu'
import type { BackdropType, Viewport } from '@/types/board'
import { TabMenu } from '@/components/TabMenu/TabMenu'
import styles from './Canvas.module.css'

/*
 * Canvas — pan + pinch zoom + double-tap state machine.
 * -----------------------------------------------------
 *
 * History: this file used to host react-infinite-viewer for pan/zoom. That
 * was replaced with a transform-based world because of an iOS Safari
 * double-transform bug. This iteration extends the manual implementation
 * with two-finger pinch zoom (Phase 3) and custom touch double-tap-to-
 * create (Phase 5).
 *
 * Coordinate system (unchanged):
 *   viewport.x, viewport.y = world-coord top-left of the visible shell
 *   viewport.zoom          = scale factor
 *   world transform        = translate3d(-vx*z, -vy*z, 0) scale(z)
 *   screenToWorld(sx, sy)  = (sx/z + vx, sy/z + vy)  relative to shell
 *
 * Gesture state machine
 *   idle  ──(1 ptr down)─────────> pan
 *   pan   ──(2nd touch ptr)──────> pinch    (fresh baselines)
 *   pinch ──(1 ptr up)───────────> pan      (fresh baselines on remaining ptr)
 *   pinch ──(both up)────────────> idle
 *   pan   ──(ptr up)─────────────> idle
 *
 * Notes:
 *  - Mouse and pen never enter pinch — pinch requires two touch pointers.
 *  - 3+ touch pointers are tracked but don't reassign the pinch pair.
 *    The pinch stays with its original two pointers until one lifts.
 *  - When one pinch finger lifts, the remaining finger becomes a fresh
 *    pan with a new baseline — this prevents a position jump from
 *    midpoint math suddenly reverting to single-finger pan math.
 *
 * Tap / double-tap (touch only)
 *   A pointerdown→pointerup with movement < TAP_MAX_DIST_PX and elapsed
 *   < TAP_MAX_DURATION ms = a tap. Two taps within DOUBLE_TAP_INTERVAL_MS
 *   and DOUBLE_TAP_DIST_PX of each other = double-tap, which creates a
 *   card centred at the tap position.
 *
 *   Mouse double-click is left to the React onDoubleClick handler — it
 *   fires reliably on mouse. The browser never fires a consistent
 *   dblclick on touch, which is why touch has its own detection path.
 */

interface DrawState {
  type:     BackdropType
  startX:   number
  startY:   number
  currentX: number
  currentY: number
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 4

// Tap / double-tap thresholds (touch only)
const TAP_MAX_DIST_PX        = 12
const TAP_MAX_DURATION       = 500
const DOUBLE_TAP_INTERVAL_MS = 300
const DOUBLE_TAP_DIST_PX     = 24

// Gesture state — null when idle.
type GestureState =
  | {
      kind: 'pan'
      pointerId: number
      startScreen:   { x: number; y: number }
      startViewport: Viewport
    }
  | {
      kind: 'pinch'
      p1Id: number
      p2Id: number
      startDist: number
      startWorldAtMid: { x: number; y: number }
      startZoom: number
    }
  | {
      kind: 'draw'
      pointerId: number
    }
  | null

export function Canvas() {
  const worldRef       = useRef<HTMLDivElement>(null)
  const canvasShellRef = useRef<HTMLDivElement>(null)
  const isSpaceDownRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  const lastMouseWorldRef    = useRef({ x: WORLD_CENTER, y: WORLD_CENTER })
  const lastMouseScreenRef   = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

  // Every pointer currently captured by the world. pointerId → screen pos + type.
  const pointersRef = useRef<Map<number, { x: number; y: number; type: string }>>(new Map())

  // Current gesture (mutually exclusive).
  const gestureRef = useRef<GestureState>(null)

  // Tap / double-tap detection (touch only).
  const tapDownRef = useRef<{ pointerId: number; x: number; y: number; time: number } | null>(null)
  const lastTapRef = useRef<{ x: number; y: number; time: number } | null>(null)

  const [shellEl,      setShellEl]      = useState<HTMLDivElement | null>(null)
  const [tabMenu,      setTabMenu]      = useState<{ worldX: number; worldY: number; screenX: number; screenY: number } | null>(null)
  const [creationMode, setCreationMode] = useState<BackdropType | null>(null)
  const [drawState,    setDrawState]    = useState<DrawState | null>(null)
  const [canvasMenu,   setCanvasMenu]   = useState<{ x: number; y: number; wx: number; wy: number } | null>(null)

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

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getViewport   = useCallback(() => useBoardStore.getState().board.viewport, [])
  const getViewerZoom = useCallback(() => getViewport().zoom, [getViewport])

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

  // Midpoint of two screen positions, relative to the shell (for pinch math).
  const screenMidRelativeToShell = useCallback((p1: { x: number; y: number }, p2: { x: number; y: number }) => {
    const shell = canvasShellRef.current
    if (!shell) return { x: 0, y: 0 }
    const rect = shell.getBoundingClientRect()
    return {
      x: (p1.x + p2.x) / 2 - rect.left,
      y: (p1.y + p2.y) / 2 - rect.top,
    }
  }, [])

  // ── Gesture transition helpers ────────────────────────────────────────────
  const startPan = useCallback((pointerId: number, screenX: number, screenY: number, worldEl: HTMLElement) => {
    gestureRef.current = {
      kind: 'pan',
      pointerId,
      startScreen:   { x: screenX, y: screenY },
      startViewport: { ...useBoardStore.getState().board.viewport },
    }
    worldEl.style.cursor = 'grabbing'
  }, [])

  const startPinch = useCallback((p1Id: number, p2Id: number) => {
    const p1 = pointersRef.current.get(p1Id)
    const p2 = pointersRef.current.get(p2Id)
    if (!p1 || !p2) return
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    if (dist < 1) return  // degenerate — wait until fingers separate
    const mid = screenMidRelativeToShell(p1, p2)
    const vp  = useBoardStore.getState().board.viewport
    gestureRef.current = {
      kind: 'pinch',
      p1Id, p2Id,
      startDist: dist,
      startWorldAtMid: {
        x: mid.x / vp.zoom + vp.x,
        y: mid.y / vp.zoom + vp.y,
      },
      startZoom: vp.zoom,
    }
  }, [screenMidRelativeToShell])

  // ── Mount: center viewport ────────────────────────────────────────────────
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

  // ── World pointer events: pan / pinch / draw / tap detection ──────────────
  const onWorldPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return

    // Creation mode (drawing a backdrop)
    if (creationMode && e.button === 0) {
      const { x, y } = screenToWorld(e.clientX, e.clientY)
      e.currentTarget.setPointerCapture(e.pointerId)
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
      gestureRef.current = { kind: 'draw', pointerId: e.pointerId }
      setDrawState({ type: creationMode, startX: x, startY: y, currentX: x, currentY: y })
      return
    }

    // Mouse: only pan with middle button or Space+left
    if (e.pointerType === 'mouse') {
      const isPanIntent = e.button === 1 || (e.button === 0 && isSpaceDownRef.current)
      if (!isPanIntent) return
    }

    // Capture and record
    e.currentTarget.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })

    // Touch — track start for tap / double-tap detection
    if (e.pointerType === 'touch') {
      tapDownRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, time: Date.now() }
    }

    // State machine — decide what this pointerdown means
    const g = gestureRef.current
    if (!g) {
      // First pointer in a gesture → pan
      startPan(e.pointerId, e.clientX, e.clientY, e.currentTarget)
    } else if (
      g.kind === 'pan' &&
      e.pointerType === 'touch' &&
      pointersRef.current.get(g.pointerId)?.type === 'touch'
    ) {
      // Pan → pinch upgrade (only when both pointers are touch)
      startPinch(g.pointerId, e.pointerId)
    }
    // else: already in pinch (3+ fingers ignored), or pan can't upgrade
    // because the in-flight pointer isn't touch — leave state alone.
  }, [creationMode, screenToWorld, startPan, startPinch])

  const onWorldPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Track last cursor position (for tab menu, hover effects, etc.)
    const shell = canvasShellRef.current
    if (shell) {
      const vp = useBoardStore.getState().board.viewport
      const rect = shell.getBoundingClientRect()
      lastMouseWorldRef.current = {
        x: (e.clientX - rect.left) / vp.zoom + vp.x,
        y: (e.clientY - rect.top)  / vp.zoom + vp.y,
      }
    }
    lastMouseScreenRef.current = { x: e.clientX, y: e.clientY }

    // Only respond if this pointer is part of our active gesture
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })

    const g = gestureRef.current
    if (!g) return

    if (g.kind === 'draw' && e.pointerId === g.pointerId) {
      const { x, y } = screenToWorld(e.clientX, e.clientY)
      setDrawState(s => s ? { ...s, currentX: x, currentY: y } : null)
    } else if (g.kind === 'pan' && e.pointerId === g.pointerId) {
      const dx = e.clientX - g.startScreen.x
      const dy = e.clientY - g.startScreen.y
      useBoardStore.getState().setViewport({
        x: g.startViewport.x - dx / g.startViewport.zoom,
        y: g.startViewport.y - dy / g.startViewport.zoom,
        zoom: g.startViewport.zoom,
      })
    } else if (g.kind === 'pinch') {
      // Read both pinch pointers and recompute zoom + viewport
      const p1 = pointersRef.current.get(g.p1Id)
      const p2 = pointersRef.current.get(g.p2Id)
      if (!p1 || !p2) return
      const newDist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      if (newDist < 1 || g.startDist < 1) return
      let newZoom = g.startZoom * (newDist / g.startDist)
      newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom))
      const mid = screenMidRelativeToShell(p1, p2)
      // Place the world point that was originally under the midpoint
      // back under the current midpoint, at the new zoom level.
      // This makes the pinch feel like the fingers are "grabbing" the
      // world at the midpoint — pan + zoom together as fingers move.
      useBoardStore.getState().setViewport({
        x: g.startWorldAtMid.x - mid.x / newZoom,
        y: g.startWorldAtMid.y - mid.y / newZoom,
        zoom: newZoom,
      })
    }
  }, [screenToWorld, screenMidRelativeToShell])

  const onWorldPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Was this pointerup a tap? (touch only — small movement, short time)
    let isTap = false
    if (e.pointerType === 'touch' && tapDownRef.current?.pointerId === e.pointerId) {
      const td      = tapDownRef.current
      const dist    = Math.hypot(e.clientX - td.x, e.clientY - td.y)
      const elapsed = Date.now() - td.time
      isTap = dist < TAP_MAX_DIST_PX && elapsed < TAP_MAX_DURATION
      tapDownRef.current = null
    }

    pointersRef.current.delete(e.pointerId)

    const g = gestureRef.current
    if (g?.kind === 'draw' && e.pointerId === g.pointerId) {
      // Commit the backdrop draw
      if (drawState) {
        const { type, startX, startY, currentX, currentY } = drawState
        const x = Math.min(startX, currentX)
        const y = Math.min(startY, currentY)
        const w = Math.abs(currentX - startX)
        const h = Math.abs(currentY - startY)
        if (w >= 80 && h >= 60) {
          createBackdrop({ x, y }, { width: w, height: h }, type)
        }
      }
      setDrawState(null)
      setCreationMode(null)
      suppressNextClickRef.current = true
      gestureRef.current = null
    } else if (g?.kind === 'pan' && e.pointerId === g.pointerId) {
      gestureRef.current = null
      e.currentTarget.style.cursor = ''
    } else if (g?.kind === 'pinch' && (e.pointerId === g.p1Id || e.pointerId === g.p2Id)) {
      // One finger of the pinch lifted. If the other is still down, demote
      // to single-finger pan with a fresh baseline so the user doesn't
      // experience a position jump from midpoint math suddenly switching
      // to single-finger pan math.
      const remainingId = e.pointerId === g.p1Id ? g.p2Id : g.p1Id
      const remaining   = pointersRef.current.get(remainingId)
      if (remaining) {
        startPan(remainingId, remaining.x, remaining.y, e.currentTarget)
      } else {
        gestureRef.current = null
        e.currentTarget.style.cursor = ''
      }
    }

    // Touch double-tap detection. Only fires when this pointerup was a tap
    // (no significant movement). Mouse double-click is handled separately
    // by the React onDoubleClick handler.
    if (isTap && e.pointerType === 'touch' && !creationMode) {
      const now  = Date.now()
      const last = lastTapRef.current
      if (
        last &&
        now - last.time < DOUBLE_TAP_INTERVAL_MS &&
        Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_DIST_PX
      ) {
        // Double-tap → create card centred at the tap position
        const { x, y } = screenToWorld(e.clientX, e.clientY)
        createCard({ x: x - CARD_W / 2, y: y - CARD_H / 2 })
        lastTapRef.current = null
        suppressNextClickRef.current = true
      } else {
        lastTapRef.current = { x: e.clientX, y: e.clientY, time: now }
      }
    }
  }, [drawState, createBackdrop, creationMode, screenToWorld, createCard, startPan])

  // Pointer cancel — iOS interrupts (notification banner, system gesture,
  // browser palm rejection). Clear state cleanly so we don't leave a stale
  // gesture fighting the next touch.
  const onWorldPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId)
    tapDownRef.current = null

    const g = gestureRef.current
    if (g?.kind === 'pinch' && (e.pointerId === g.p1Id || e.pointerId === g.p2Id)) {
      const remainingId = e.pointerId === g.p1Id ? g.p2Id : g.p1Id
      const remaining   = pointersRef.current.get(remainingId)
      if (remaining) {
        startPan(remainingId, remaining.x, remaining.y, e.currentTarget)
        return
      }
    }
    if (g?.kind === 'draw') setDrawState(null)
    gestureRef.current = null
    e.currentTarget.style.cursor = ''
  }, [startPan])

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

  // Mouse double-click → create card. Touch double-tap handled in onPointerUp.
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

  // ── Draw preview ──────────────────────────────────────────────────────────
  const drawPreview = drawState ? {
    x: Math.min(drawState.startX, drawState.currentX),
    y: Math.min(drawState.startY, drawState.currentY),
    w: Math.abs(drawState.currentX - drawState.startX),
    h: Math.abs(drawState.currentY - drawState.startY),
  } : null

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
        onPointerDown={onWorldPointerDown}
        onPointerMove={onWorldPointerMove}
        onPointerUp={onWorldPointerUp}
        onPointerCancel={onWorldPointerCancel}
        onDoubleClick={handleWorldDoubleClick}
        onClick={handleWorldClick}
        onContextMenu={handleWorldContextMenu}
      >
        <div className={styles.backdropLayer}>
          {backdrops.map(backdrop => (
            <BackdropComponent
              key={backdrop.id}
              backdrop={backdrop}
              getViewerZoom={getViewerZoom}
              worldRef={worldRef}
            />
          ))}
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

      {creationMode && (
        <div className={styles.creationBanner}>
          Drawing <strong>{creationMode}</strong> backdrop — drag to define bounds · Esc to cancel
        </div>
      )}

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
      <p className={styles.emptySecondary}>Double-click or double-tap to add a card · Right-click for more options</p>
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
