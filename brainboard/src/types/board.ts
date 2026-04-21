/*
 * Brainboard Board Types
 * ======================
 * Pure TypeScript — no DOM, no React, no framework primitives.
 * This file is the portability contract between the prototype and the
 * SCF React branch. Change with care.
 *
 * Three relationships to keep clear:
 *   Card      → a physical placement on the board (position, rotation, color)
 *   Entity    → the canonical story object (title, noteRaw, attributes)
 *   Board     → the container for both, plus viewport and metadata
 *
 * A Card has entityId === null when it is an unpublished draft.
 * Multiple cards can share the same entityId — they are instances of the
 * same entity. Instances share noteRaw (via the Entity) but have independent
 * instanceNote, position, rotation, color.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const ENTITY_TYPES = [
  'Character',
  'Location',
  'Scene',
  'Prop',
  'Sequence',
  'Beat',
] as const

export type EntityType = (typeof ENTITY_TYPES)[number]

export const SWATCH_KEYS = [
  'amber',
  'sage',
  'sky',
  'sand',
  'violet',
  'rose',
  'slate',
  'fog',
] as const

export type SwatchKey = (typeof SWATCH_KEYS)[number]

// ---------------------------------------------------------------------------
// Entity type → default swatch mapping
// User-overridable per card; these are just the initial assignment on creation.
// ---------------------------------------------------------------------------

export const TYPE_SWATCH_DEFAULTS: Record<EntityType, SwatchKey> = {
  Character: 'amber',
  Location:  'sage',
  Scene:     'sky',
  Prop:      'sand',
  Sequence:  'violet',
  Beat:      'rose',
}

// ---------------------------------------------------------------------------
// Core data types
// ---------------------------------------------------------------------------

export interface Position {
  x: number
  y: number
}

export interface Viewport {
  x:    number  // scrollLeft in world pixels
  y:    number  // scrollTop in world pixels
  zoom: number  // 1 = 100%, 2 = 200%, etc.
}

/*
 * Card — one placement on the board.
 *
 * noteRaw lives here when the card is unpublished (entityId === null).
 * Once published, the canonical noteRaw moves to the Entity and this
 * field becomes a stale draft copy. Phase 5 introduces getNoteRaw()
 * accessor that handles both cases. Do not read card.noteRaw directly
 * in Phase 5+ code on published cards.
 */
export interface Card {
  id:           string
  entityId:     string | null  // null = unpublished draft
  type:         EntityType
  position:     Position
  rotation:     number         // degrees, default 0
  color:        SwatchKey
  zIndex:       number
  noteRaw:      string         // canonical entity note (draft when unpublished)
  instanceNote: string         // local to this placement; never promoted to entity
  isFlipped:    boolean        // attribute side showing
  title:        string
}

/*
 * Entity — the canonical story object.
 * Created by publishing a card. All instances of a card share one Entity.
 *
 * attributes is deliberately Record<string, string | string[]> for the
 * prototype's mock schema. Phase 6 introduces typed attribute schemas per
 * EntityType. The loose type here avoids premature schema lock-in.
 */
export interface Entity {
  id:         string
  type:       EntityType
  title:      string
  noteRaw:    string
  attributes: Record<string, string | string[]>
}

export interface Board {
  schemaVersion: 1
  boardId:       string
  name:          string
  createdAt:     string  // ISO 8601
  updatedAt:     string  // ISO 8601
  viewport:      Viewport
  cards:         Card[]
  entities:      Entity[]
}

// ---------------------------------------------------------------------------
// Derived / computed (pure functions on types, no state)
// ---------------------------------------------------------------------------

/*
 * Get the display note for a card. Use this in Phase 5+ instead of
 * reading card.noteRaw directly on published cards.
 */
export function getCardNote(card: Card, entities: Entity[]): string {
  if (card.entityId === null) return card.noteRaw
  return entities.find(e => e.id === card.entityId)?.noteRaw ?? ''
}

/*
 * Get the entity for a card, if it has one.
 */
export function getCardEntity(card: Card, entities: Entity[]): Entity | undefined {
  if (card.entityId === null) return undefined
  return entities.find(e => e.id === card.entityId)
}

/*
 * True if this card is a published instance (not the "original" — all
 * instances are equal after publish, but this is how the store counts them).
 * Used for the instance glyph affordance in Phase 8.
 */
export function isInstance(card: Card, allCards: Card[]): boolean {
  if (card.entityId === null) return false
  const siblings = allCards.filter(
    c => c.entityId === card.entityId && c.id !== card.id
  )
  return siblings.length > 0
}
