import { useCallback } from 'react'
import { useBoardStore } from '@/store/boardStore'
import { useSelectionStore } from '@/store/selectionStore'
import type { Card } from '@/types/board'

/*
 * useCardDrag
 *
 * Fixes vs Phase 4:
 *   - Bails early if pointer target is an interactive element (button, input,
 *     textarea, select). Prevents swatch clicks and textarea resizes from
 *     triggering a card drag.
 *   - When card is in 'open' mode, only drag if the pointer hit the drag
 *     handle bar (data-drag-handle attribute on the handle element).
 *   - Selection logic unchanged.
 *
 * Touch fix (current):
 *   InfiniteViewer is built on the `gesto` library, which attaches NATIVE
 *   pointerdown/touchstart listeners directly to its container element.
 *   React's `e.stopPropagation()` only stops the synthetic event tree, NOT
 *   the native event — so without an explicit native stop, gesto receives
 *   the same pointerdown that started our card drag and runs its own pan
 *   in parallel. Visible result: the card moves AND the canvas pans (the
 *   "double transform" bug, identical in Chrome and Safari since it's a
 *   JS-listener conflict, not a browser-native gesture issue).
 *
 *   The fix is `e.nativeEvent.stopImmediatePropagation()` immediately after
 *   we decide this pointerdown is ours. stopImmediatePropagation is the
 *   strong form: it stops bubbling AND prevents other listeners on the
 *   same element from firing, which matters because gesto may attach at a
 *   shared ancestor.
 *
 *   We still call React's e.stopPropagation() for the synthetic tree so
 *   parent React components (selection clearer on canvas click etc) also
 *   don't see this event. Both calls are needed; they cover separate
 *   event paths.
 */

const INTERACTIVE_TAGS = new Set(['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'])

export function useCardDrag(
  cardId:        string,
  getViewerZoom: () => number,
  isOpen:        boolean,       // when true, only drag from drag handle
) {
  const updateCardPosition = useBoardStore(s => s.updateCardPosition)
  const bringToFront       = useBoardStore(s => s.bringToFront)

  return useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return

      const target = e.target as HTMLElement

      // Never steal events from interactive elements.
      // This fixes: swatch clicks, textarea resize, select dropdown, buttons.
      if (INTERACTIVE_TAGS.has(target.tagName)) return

      // When open (edit mode), only drag from the designated drag handle bar.
      // Clicking anywhere else in an open card is for text editing, not dragging.
      if (isOpen && !target.closest('[data-drag-handle]')) return

      // Stop the NATIVE event from reaching gesto / InfiniteViewer.
      // Must happen before React's stopPropagation — see top-of-file comment
      // for why both are needed.
      e.nativeEvent.stopImmediatePropagation()

      e.stopPropagation()

      // --- Selection ---
      const sel = useSelectionStore.getState()

      if (e.shiftKey) {
        if (sel.selectedIds.has(cardId)) {
          sel.removeFromSelection(cardId)
          return
        } else {
          sel.addToSelection(cardId)
        }
      } else if (!sel.selectedIds.has(cardId)) {
        sel.select(cardId)
      }

      bringToFront(cardId)

      // --- Drag ---
      const target2 = e.currentTarget
      target2.setPointerCapture(e.pointerId)

      const zoom   = getViewerZoom()
      const startX = e.clientX
      const startY = e.clientY

      // Snapshot world positions for all currently selected cards
      const dragIds    = [...useSelectionStore.getState().selectedIds]
      const boardCards = useBoardStore.getState().board.cards
      const startPos   = new Map<string, { x: number; y: number }>(
        dragIds
          .map(id => boardCards.find(c => c.id === id))
          .filter((c): c is Card => !!c)
          .map(c => [c.id, { x: c.position.x, y: c.position.y }])
      )

      let dragging = false

      const onMove = (me: PointerEvent) => {
        const dx = (me.clientX - startX) / zoom
        const dy = (me.clientY - startY) / zoom
        if (!dragging && Math.hypot(dx, dy) < 4) return
        dragging = true

        for (const [id, start] of startPos) {
          const el = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
          if (el) el.style.transform = `translate(${start.x + dx}px, ${start.y + dy}px)`
        }
      }

      const onUp = (ue: PointerEvent) => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup',   onUp)
        if (!dragging) return

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
    [cardId, isOpen, getViewerZoom, bringToFront, updateCardPosition]
  )
}
