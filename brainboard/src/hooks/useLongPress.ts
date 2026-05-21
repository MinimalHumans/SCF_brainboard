import { useCallback, useEffect, useRef } from 'react'

/*
 * useLongPress
 * ------------
 *
 * Detects a long press (stationary pointer held for `duration` ms) and
 * fires a callback with the press position. By default it only fires for
 * touch — mouse and pen are filtered out (mouse long-press isn't a
 * standard interaction; right-click handles the equivalent).
 *
 * Cancellation: the timer is cleared if the pointer moves more than
 * `moveThreshold` pixels, lifts before the timer elapses, is cancelled by
 * the system (pointercancel), or if the caller invokes the returned
 * `cancel()` method — used when a competing gesture takes over (e.g. a
 * second finger arriving on the canvas to start a pinch).
 *
 * Drag coexistence: when long-press fires, the user's finger is still
 * down. If another subsystem (useCardDrag, Backdrop header drag) is also
 * listening for the same pointer's move/up events, subsequent finger
 * movement toward the menu would drag the card/backdrop, AND the captured
 * pointer would prevent menu items from receiving events at all. The
 * `cancelDrag` helper in the callback payload handles both: it walks up
 * from the press target to find the element holding pointer capture,
 * releases that capture, and dispatches a synthetic pointerup at the
 * original press coordinates. The synthetic event:
 *   - Triggers any document-level pointerup listeners (useCardDrag) with
 *     dx=dy=0, so no position commit happens.
 *   - Bubbles to element-level listeners (Backdrop's headerEl-attached
 *     handlers) for the same reason.
 *   - Releases capture so the menu (rendered as a portal) can receive
 *     subsequent pointer events normally.
 *
 * The synthetic event has `isTrusted: false` — any downstream handler
 * that gates behaviour on `event.isTrusted` will see this and may behave
 * differently. None of Scriptyard's current code does that.
 */

export interface LongPressPayload {
  clientX:     number
  clientY:     number
  target:      EventTarget | null
  pointerType: string
  pointerId:   number
  /**
   * Terminate any in-flight pointer-capture-based drag for this pointer.
   * Releases pointer capture from whichever ancestor of `target` holds
   * it, and dispatches a synthetic `pointerup` at the original press
   * coordinates so drag listeners (useCardDrag, Backdrop drag) tear down
   * cleanly without committing position changes.
   */
  cancelDrag: () => void
}

export interface UseLongPressOptions {
  /** Press duration before firing, in ms. Default 500. */
  duration?: number
  /** Movement threshold in screen pixels — cancels timer if exceeded. Default 8. */
  moveThreshold?: number
  /** When true (default), only touch pointers trigger detection. */
  touchOnly?: boolean
  /**
   * Optional filter. Return false to ignore this pointerdown — useful
   * for skipping interactive children (buttons, inputs, swatches).
   */
  filter?: (e: React.PointerEvent) => boolean
}

export interface UseLongPressReturn {
  /** Call from your own onPointerDown handler. */
  onPointerDown: (e: React.PointerEvent) => void
  /** Cancel any in-flight timer (e.g. when a pinch starts). */
  cancel: () => void
}

function findCapturingElement(start: Element | null, pointerId: number): Element | null {
  let el: Element | null = start
  while (el) {
    const anyEl = el as unknown as { hasPointerCapture?: (id: number) => boolean }
    if (typeof anyEl.hasPointerCapture === 'function' && anyEl.hasPointerCapture(pointerId)) {
      return el
    }
    el = el.parentElement
  }
  return null
}

export function useLongPress(
  onLongPress: (payload: LongPressPayload) => void,
  options: UseLongPressOptions = {}
): UseLongPressReturn {
  const {
    duration      = 500,
    moveThreshold = 8,
    touchOnly     = true,
    filter,
  } = options

  // Keep the latest callback in a ref so users don't have to memoise it.
  const callbackRef = useRef(onLongPress)
  callbackRef.current = onLongPress

  const timerRef    = useRef<number | null>(null)
  const teardownRef = useRef<(() => void) | null>(null)

  const cancel = useCallback(() => {
    teardownRef.current?.()
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (touchOnly && e.pointerType !== 'touch') return
    if (!e.isPrimary) return
    if (filter && !filter(e)) return

    // Clear any in-flight press first
    teardownRef.current?.()

    const startX      = e.clientX
    const startY      = e.clientY
    const pointerId   = e.pointerId
    const pointerType = e.pointerType
    const target      = e.target

    const onMove = (me: PointerEvent) => {
      if (me.pointerId !== pointerId) return
      const dist = Math.hypot(me.clientX - startX, me.clientY - startY)
      if (dist > moveThreshold) teardown()
    }
    const onUpOrCancel = (ue: PointerEvent) => {
      if (ue.pointerId !== pointerId) return
      teardown()
    }
    const teardown = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      document.removeEventListener('pointermove',   onMove)
      document.removeEventListener('pointerup',     onUpOrCancel)
      document.removeEventListener('pointercancel', onUpOrCancel)
      teardownRef.current = null
    }

    teardownRef.current = teardown
    document.addEventListener('pointermove',   onMove)
    document.addEventListener('pointerup',     onUpOrCancel)
    document.addEventListener('pointercancel', onUpOrCancel)

    timerRef.current = window.setTimeout(() => {
      // Clear our own bookkeeping BEFORE invoking the callback so any state
      // changes the callback makes don't race against our teardown.
      timerRef.current = null
      document.removeEventListener('pointermove',   onMove)
      document.removeEventListener('pointerup',     onUpOrCancel)
      document.removeEventListener('pointercancel', onUpOrCancel)
      teardownRef.current = null

      const cancelDrag = () => {
        const capturingEl = findCapturingElement(target as Element | null, pointerId)

        const eventInit: PointerEventInit = {
          pointerId,
          pointerType,
          clientX:    startX,
          clientY:    startY,
          bubbles:    true,
          cancelable: true,
          isPrimary:  true,
        }

        if (capturingEl) {
          // Release the capture first so the synthetic pointerup doesn't
          // re-trigger any capture-related browser behaviour.
          const anyEl = capturingEl as unknown as { releasePointerCapture?: (id: number) => void }
          if (typeof anyEl.releasePointerCapture === 'function') {
            try { anyEl.releasePointerCapture(pointerId) }
            catch { /* already released by something else */ }
          }
          // Bubbles → reaches both element-level listeners on `capturingEl`
          // and document-level listeners on `document`.
          capturingEl.dispatchEvent(new PointerEvent('pointerup', eventInit))
        } else {
          // No capture found — at least notify document listeners.
          document.dispatchEvent(new PointerEvent('pointerup', eventInit))
        }
      }

      callbackRef.current({
        clientX: startX,
        clientY: startY,
        target,
        pointerType,
        pointerId,
        cancelDrag,
      })
    }, duration)
  }, [duration, moveThreshold, touchOnly, filter])

  // Cleanup on unmount
  useEffect(() => {
    return () => { teardownRef.current?.() }
  }, [])

  return { onPointerDown, cancel }
}
