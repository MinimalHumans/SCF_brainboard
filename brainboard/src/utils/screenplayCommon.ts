/**
 * screenplayCommon.ts
 * -------------------
 * Shared geometric helpers, parent-map builders, and scene-heading assembly
 * used by buildOutline.ts, buildFountain.ts, and buildFDX.ts.
 *
 * Extracted from buildOutline.ts so all three emitters share identical
 * containment logic — changing it in one place fixes it everywhere.
 */

import type { Backdrop, Card, Entity } from '@/types/board'

// ─── Geometry constants ──────────────────────────────────────────────────────

export const CARD_W   = 320
export const CARD_H   = 160
export const ROW_SNAP = 80

/** Backdrop structural rank — higher value = more prominent in hierarchy. */
export const RANK: Record<string, number> = {
  Act: 4, Sequence: 3, Scene: 2, Beat: 1, Custom: 0,
}

// ─── Geometric helpers ───────────────────────────────────────────────────────

export function fullyInside(
  ix: number, iy: number, iw: number, ih: number,
  bd: Backdrop,
): boolean {
  return (
    ix      >= bd.position.x &&
    iy      >= bd.position.y &&
    ix + iw <= bd.position.x + bd.size.width &&
    iy + ih <= bd.position.y + bd.size.height
  )
}

/**
 * Innermost (smallest area) non-Custom backdrop fully containing the item.
 * Skips the backdrop with `excludeId` (used when testing a backdrop against itself).
 */
export function innermostParent(
  ix: number, iy: number, iw: number, ih: number,
  backdrops: Backdrop[],
  excludeId?: string,
): Backdrop | null {
  const hits = backdrops.filter(bd =>
    bd.type !== 'Custom' &&
    bd.id   !== excludeId &&
    fullyInside(ix, iy, iw, ih, bd),
  )
  if (!hits.length) return null
  return hits.reduce((a, b) =>
    a.size.width * a.size.height < b.size.width * b.size.height ? a : b,
  )
}

/** Sort by row-snap row then x, so left-to-right within a visual row. */
export function rowSort<T extends { position: { x: number; y: number } }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ra = Math.round(a.position.y / ROW_SNAP)
    const rb = Math.round(b.position.y / ROW_SNAP)
    return ra !== rb ? ra - rb : a.position.x - b.position.x
  })
}

// ─── Parent-map builders ─────────────────────────────────────────────────────

/**
 * For each non-Custom backdrop, map id → immediate non-Custom parent id (or null).
 * "Immediate" means innermost — a Scene inside a Sequence inside an Act maps to
 * the Sequence, not the Act.
 */
export function buildBackdropParentMap(backdrops: Backdrop[]): Map<string, string | null> {
  const nonCustom = backdrops.filter(b => b.type !== 'Custom')
  const map = new Map<string, string | null>()
  for (const bd of nonCustom) {
    const p = innermostParent(
      bd.position.x, bd.position.y, bd.size.width, bd.size.height,
      backdrops, bd.id,
    )
    map.set(bd.id, p?.id ?? null)
  }
  return map
}

/**
 * For each card, map id → innermost non-Custom parent backdrop id (or null).
 */
export function buildCardParentMap(
  cards: Card[],
  backdrops: Backdrop[],
): Map<string, string | null> {
  const map = new Map<string, string | null>()
  for (const c of cards) {
    const p = innermostParent(c.position.x, c.position.y, CARD_W, CARD_H, backdrops)
    map.set(c.id, p?.id ?? null)
  }
  return map
}

/**
 * Cards whose immediate parent is `backdropId`, in row-snap order.
 * Returns only direct children — does not descend into nested backdrops.
 */
export function cardsInBackdrop(
  backdropId: string,
  cards: Card[],
  cardParent: Map<string, string | null>,
): Card[] {
  return rowSort(cards.filter(c => cardParent.get(c.id) === backdropId))
}

/**
 * Non-Custom backdrops whose immediate parent is `backdropId`, in row-snap order.
 */
export function backdropsInBackdrop(
  backdropId: string,
  backdrops: Backdrop[],
  bdParent: Map<string, string | null>,
): Backdrop[] {
  return rowSort(
    backdrops
      .filter(b => b.type !== 'Custom')
      .filter(b => bdParent.get(b.id) === backdropId),
  )
}

/**
 * Root-level (no non-Custom parent) non-Custom backdrops, in row-snap order.
 */
export function rootBackdrops(
  backdrops: Backdrop[],
  bdParent: Map<string, string | null>,
): Backdrop[] {
  return rowSort(
    backdrops
      .filter(b => b.type !== 'Custom')
      .filter(b => bdParent.get(b.id) === null),
  )
}

/**
 * Cards at root level — not contained by any non-Custom backdrop.
 */
export function rootCards(
  cards: Card[],
  cardParent: Map<string, string | null>,
): Card[] {
  return cards.filter(c => cardParent.get(c.id) === null)
}

// ─── Scene heading assembly ──────────────────────────────────────────────────

export interface SceneHeadingParts {
  /** The assembled slugline, ready to write (already uppercased). */
  raw:    string
  /** How the heading was derived — for debugging. */
  source: 'verbatim' | 'composed' | 'fallback'
}

/** Regex that detects an already-written slugline in the title field. */
const SLUGLINE_RE = /^(INT|EXT|INT\/EXT|I\/E)[\.\s]/i

function normaliseTime(t: string | undefined): string {
  if (!t || !t.trim()) return 'DAY'
  return t.trim().toUpperCase()
}

/**
 * Map a Location entity's `type` attribute value to a screenplay INT/EXT prefix.
 * Returns null for non-spatial types (Virtual, Abstract).
 */
function locationTypeToIntExt(locType: string | undefined): string | null {
  if (!locType) return null
  if (locType === 'Interior') return 'INT.'
  if (locType === 'Exterior') return 'EXT.'
  if (locType === 'Int/Ext')  return 'INT/EXT.'
  return null
}

/**
 * Assemble a scene heading from a **Scene backdrop**.
 *
 * Priority order:
 * 1. Title already looks like a slugline → use it verbatim (uppercased).
 * 2. Use `int_ext` / `time_of_day` backdrop attributes + nearest contained
 *    Location card for the location name.
 * 3. Fallback: use the backdrop title uppercased, optionally prefixed with
 *    the int_ext attribute.
 */
export function assembleSceneHeadingFromBackdrop(
  bd:         Backdrop,
  cards:      Card[],
  entities:   Map<string, Entity>,
  cardParent: Map<string, string | null>,
): SceneHeadingParts {
  const title = bd.title.trim()

  // 1. Verbatim slugline already in title
  if (SLUGLINE_RE.test(title)) {
    return { raw: title.toUpperCase(), source: 'verbatim' }
  }

  // 2. Compose from backdrop attributes + contained Location card
  const intExtAttr = (bd.attributes['int_ext']    as string | undefined)?.trim() || null
  const timeAttr   = (bd.attributes['time_of_day'] as string | undefined)?.trim()
  const time       = normaliseTime(timeAttr)

  // Find the first Location card spatially contained by this backdrop
  const locCard   = cards.find(c => c.type === 'Location' && cardParent.get(c.id) === bd.id)
  const locEntity = locCard ? entities.get(locCard.entityId) : undefined
  const locName   = locEntity?.title?.trim().toUpperCase() ?? null

  if (locName) {
    const prefix = intExtAttr
      ?? locationTypeToIntExt(locEntity?.attributes?.['type'] as string | undefined)
      ?? 'INT.'
    return { raw: `${prefix} ${locName} - ${time}`, source: 'composed' }
  }

  // intExt set but no location card — use title as location
  if (intExtAttr) {
    return { raw: `${intExtAttr} ${title.toUpperCase()} - ${time}`, source: 'composed' }
  }

  // 3. Fallback: title uppercased
  return { raw: title.toUpperCase(), source: 'fallback' }
}

/**
 * Assemble a scene heading from a **Scene card / entity**.
 *
 * Priority order:
 * 1. Entity title already looks like a slugline → verbatim.
 * 2. Entity `int_ext` / `time_of_day` attributes + sibling Location card in
 *    the same parent backdrop.
 * 3. Fallback: title uppercased, optionally prefixed with int_ext.
 */
export function assembleSceneHeadingFromCard(
  card:       Card,
  entity:     Entity | undefined,
  cards:      Card[],
  entities:   Map<string, Entity>,
  cardParent: Map<string, string | null>,
): SceneHeadingParts {
  const title = (entity?.title ?? card.title).trim()

  // 1. Verbatim slugline
  if (SLUGLINE_RE.test(title)) {
    return { raw: title.toUpperCase(), source: 'verbatim' }
  }

  // 2. Entity attributes
  const intExtAttr = (entity?.attributes?.['int_ext']    as string | undefined)?.trim() || null
  const timeAttr   = (entity?.attributes?.['time_of_day'] as string | undefined)?.trim()
  const time       = normaliseTime(timeAttr)

  // Look for sibling Location cards in the same parent backdrop
  const parentId     = cardParent.get(card.id) ?? null
  const sibLocCard   = parentId
    ? cards.find(c => c.type === 'Location' && c.id !== card.id && cardParent.get(c.id) === parentId)
    : undefined
  const sibLocEntity = sibLocCard ? entities.get(sibLocCard.entityId) : undefined
  const locName      = sibLocEntity?.title?.trim().toUpperCase() ?? null

  if (locName) {
    const prefix = intExtAttr
      ?? locationTypeToIntExt(sibLocEntity?.attributes?.['type'] as string | undefined)
      ?? 'INT.'
    return { raw: `${prefix} ${locName} - ${time}`, source: 'composed' }
  }

  // int_ext set but no sibling location — use title as the scene description
  if (intExtAttr) {
    return { raw: `${intExtAttr} ${title.toUpperCase()} - ${time}`, source: 'composed' }
  }

  // 3. Fallback
  return { raw: title.toUpperCase(), source: 'fallback' }
}
