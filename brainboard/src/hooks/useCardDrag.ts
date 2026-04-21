import { useCallback } from 'react'
import { useBoardStore } from '@/store/boardStore'
import { useSelectionStore } from '@/store/selectionStore'
import type { Card } from '@/types/board'

/*
 * useCardDrag
 * -----------
 * Returns an onPointerDown handler for a card.
 *
 * On pointer down:
 *   1. Selection logic (click-to-select, shift-click to add/remove)
 *   2. Bring to front
 *   3. Snapshot world positions of ALL currently selected cards
 *   4. Drive multi-card drag via direct DOM mutation (performance)
 *   5. Commit final positions to store on pointer up
 *
 * Coordinate correction:
 *   dragDelta_world = dragDelta_screen / viewerZoom
 *   This is critical — without it, cards overshoot at zoom > 1.
 *   We read zoom once at drag start (not per-frame), which is correct
 *   since zoom doesn't change mid-drag.
 *
 * Why not react-moveable:
 *   Moveable measures positions via getBoundingClientRect (screen space)
 *   then applies CSS transforms in element space. Inside InfiniteViewer's
 *   scale() transform, this causes overshoot proportional to zoom level.
 *   The pointer-events approach is immune to this because we do the
 *   screen→world conversion explicitly.
 */

export function useCardDrag(
  cardId: string,
  getViewerZoom: () => number,
) {
  const updateCardPosition = useBoardStore(s => s.updateCardPosition)
  const bringToFront       = useBoardStore(s => s.bringToFront)

  return useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.stopPropagation()

      bringToFront(cardId)

      // --- Selection ---
      // Read current state directly (not from hook closure) to avoid
      // stale values — Zustand's getState() is always current.
      const sel = useSelectionStore.getState()

      if (e.shiftKey) {
        if (sel.selectedIds.has(cardId)) {
          sel.removeFromSelection(cardId)
          return  // card was deselected; don't start drag
        } else {
          sel.addToSelection(cardId)
        }
      } else if (!sel.selectedIds.has(cardId)) {
        sel.select(cardId)
      }

      // --- Drag setup ---
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)

      const zoom   = getViewerZoom()  // snapshot at drag start
      const startX = e.clientX
      const startY = e.clientY

      // Snapshot world positions of every selected card
      const dragIds     = [...useSelectionStore.getState().selectedIds]
      const boardCards  = useBoardStore.getState().board.cards
      const startPos    = new Map<string, { x: number; y: number }>(
        dragIds
          .map(id => boardCards.find(c => c.id === id))
          .filter((c): c is Card => c !== undefined)
          .map(c => [c.id, { x: c.position.x, y: c.position.y }])
      )

      let dragging = false

      const onMove = (me: PointerEvent) => {
        const dx = (me.clientX - startX) / zoom
        const dy = (me.clientY - startY) / zoom

        // Dead zone: ignore tiny movements to avoid accidental micro-drags
        if (!dragging && Math.hypot(dx, dy) < 4) return
        dragging = true

        // Direct DOM mutation — avoids triggering React re-renders on every frame
        for (const [id, start] of startPos) {
          const el = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
          if (el) el.style.transform = `translate(${start.x + dx}px, ${start.y + dy}px)`
        }
      }

      const onUp = (ue: PointerEvent) => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup',   onUp)

        if (!dragging) return  // was a click — selection already handled above

        const dx = (ue.clientX - startX) / zoom
        const dy = (ue.clientY - startY) / zoom

        for (const [id, start] of startPos) {
          updateCardPosition(id, { x: start.x + dx, y: start.y + dy })
        }
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup',   onUp)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardId, getViewerZoom, bringToFront, updateCardPosition]
    // Note: sel.* functions are intentionally omitted — we call getState()
    // directly inside the handler to avoid stale closure issues.
  )
}
