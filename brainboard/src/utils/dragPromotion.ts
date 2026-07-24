/**
 * dragPromotion.ts
 * ----------------
 * Scoped compositor-layer promotion for elements being dragged.
 *
 * The problem this replaces
 * ------------------------
 * `.card` and `.backdrop` used to carry `will-change: transform` permanently.
 * That is not what `will-change` is for, and it caused a visible bug.
 *
 * `will-change: transform` promotes an element to its own compositor layer.
 * The browser rasterises that layer's texture once, at whatever effective
 * scale is in force at the moment the layer is created, and thereafter just
 * GPU-scales the existing texture when an ancestor's scale changes — that is
 * the entire point of a compositor layer, and normally the entire point of
 * `will-change`.
 *
 * The world is scaled by `transform: scale(zoom)`, so "effective scale at
 * creation time" means "the zoom level when the card was added to the DOM":
 *
 *   create a card at zoom 0.4  -> texture rasterised at 0.4x
 *   zoom in to 1.0             -> that texture is stretched 2.5x -> blurry
 *   create a card at zoom 1.0  -> texture rasterised at 1.0x     -> sharp
 *
 * which is exactly the reported symptom: cards made while zoomed out look soft
 * once you zoom in, while a card made next to them at the new zoom looks
 * crisp. Both eventually sharpen because Chrome re-rasterises promoted layers
 * on an idle heuristic — hence the "short delay" before they match.
 *
 * The fix
 * -------
 * Promote only for the duration of a drag, which is what the MDN guidance for
 * `will-change` says to do: set it shortly before the change, remove it when
 * the change is done. Outside a drag, cards paint into the world's own layer
 * and are re-rasterised with it on every zoom change, so text is sharp
 * immediately at any zoom, with no delay and nothing to wait for.
 *
 * During a drag the transform changes every frame and the promotion is worth
 * having, which is the case `will-change` actually exists for. Raster scale
 * cannot go stale here because zoom is fixed while dragging.
 *
 * Note the deliberate asymmetry with `.world`: the world keeps its
 * `translate3d(...)` promotion, because it is the layer we *want* Chrome to
 * re-rasterise on zoom — being one layer, it re-rasters as a unit.
 */

/** Mark an element as about to be transformed repeatedly. */
export function promoteForDrag(el: HTMLElement | null | undefined) {
  if (el) el.style.willChange = 'transform'
}

/**
 * Release the promotion so the element folds back into the world layer and
 * picks up the world's raster scale on the next zoom.
 *
 * Must be called on *every* exit path from a drag, including the "never
 * actually moved" one — a promotion left behind is precisely the permanent
 * `will-change` this module exists to remove, just applied one element at a
 * time.
 */
export function releaseDragPromotion(el: HTMLElement | null | undefined) {
  if (el) el.style.willChange = ''
}

/** Promote every element matching a data-attribute lookup by id. */
export function promoteAllForDrag(attr: string, ids: Iterable<string>) {
  for (const id of ids) {
    promoteForDrag(document.querySelector<HTMLElement>(`[${attr}="${id}"]`))
  }
}

/** Inverse of {@link promoteAllForDrag}. */
export function releaseAllDragPromotions(attr: string, ids: Iterable<string>) {
  for (const id of ids) {
    releaseDragPromotion(document.querySelector<HTMLElement>(`[${attr}="${id}"]`))
  }
}
