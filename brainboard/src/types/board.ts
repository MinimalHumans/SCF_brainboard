/*
 * Brainboard Board Types
 *
 * Two distinct concepts on the canvas:
 *   Card     — a story entity placement (Character, Scene, etc.)
 *   Backdrop — a spatial region / container (Sequence, Act, Beat-region)
 *
 * Phase 11: Backdrops are purely spatial. Membership is computed from
 * geometry at drag-start; never persisted as explicit card-ID arrays.
 * The SCF export layer can derive contains: [...] from geometry at save time.
 */

// ---------------------------------------------------------------------------
// Card entity types
// ---------------------------------------------------------------------------

export const ENTITY_TYPES = [
  'Character',
  'Location',
  'Scene',
  'Prop',
  'Beat',
  'Theme',
  'Arc',
  'Shot',
  'Thought',
] as const

export type EntityType = (typeof ENTITY_TYPES)[number]

// ---------------------------------------------------------------------------
// Backdrop types
// ---------------------------------------------------------------------------

export const BACKDROP_TYPES = ['Sequence', 'Act', 'Beat', 'Scene', 'Custom'] as const
export type BackdropType = (typeof BACKDROP_TYPES)[number]

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

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

export const TYPE_SWATCH_DEFAULTS: Record<EntityType, SwatchKey> = {
  Character: 'amber',
  Location:  'sage',
  Scene:     'sky',
  Prop:      'sand',
  Beat:      'rose',
  Theme:     'violet',
  Arc:       'slate',
  Shot:      'fog',
  Thought:   'fog',
}

export const BACKDROP_SWATCH_DEFAULTS: Record<BackdropType, SwatchKey> = {
  Sequence: 'sky',
  Act:      'violet',
  Beat:     'rose',
  Scene:    'sky',
  Custom:   'fog',
}

// ---------------------------------------------------------------------------
// Core data types
// ---------------------------------------------------------------------------

export interface Position {
  x: number
  y: number
}

export interface Size {
  width:  number
  height: number
}

export interface Viewport {
  x:    number
  y:    number
  zoom: number
}

export interface Card {
  id:           string
  entityId:     string | null
  type:         EntityType
  position:     Position
  rotation:     number
  color:        SwatchKey
  zIndex:       number
  noteRaw:      string
  instanceNote: string
  isFlipped:    boolean
  title:        string
}

export interface Entity {
  id:         string
  type:       EntityType
  title:      string
  noteRaw:    string
  attributes: Record<string, string | string[]>
}

export interface Backdrop {
  id:         string
  type:       BackdropType
  title:      string
  note:       string            // displayed in lower-right of backdrop body
  position:   Position
  size:       Size
  color:      SwatchKey
  zIndex:     number
  attributes: Record<string, string>
}

export interface Board {
  schemaVersion: 1
  boardId:       string
  name:          string
  createdAt:     string
  updatedAt:     string
  viewport:      Viewport
  cards:         Card[]
  entities:      Entity[]
  backdrops:     Backdrop[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getCardNote(card: Card, entities: Entity[]): string {
  if (card.entityId === null) return card.noteRaw
  return entities.find(e => e.id === card.entityId)?.noteRaw ?? ''
}

export function getCardEntity(card: Card, entities: Entity[]): Entity | undefined {
  if (card.entityId === null) return undefined
  return entities.find(e => e.id === card.entityId)
}

export function isInstance(card: Card, allCards: Card[]): boolean {
  if (card.entityId === null) return false
  return allCards.some(c => c.entityId === card.entityId && c.id !== card.id)
}

/*
 * Compute which card IDs are spatially contained within a backdrop.
 * A card is "contained" when its full bounding box is inside the backdrop bounds.
 * This is recomputed at drag-start — never stored.
 */
export function getContainedCardIds(
  backdrop: Backdrop,
  cards:    Card[],
  cardW:    number,
  cardH:    number,
): string[] {
  const bx1 = backdrop.position.x
  const by1 = backdrop.position.y
  const bx2 = bx1 + backdrop.size.width
  const by2 = by1 + backdrop.size.height

  return cards
    .filter(c => {
      const cx1 = c.position.x
      const cy1 = c.position.y
      const cx2 = c.position.x + cardW
      const cy2 = c.position.y + cardH
      return cx1 >= bx1 && cy1 >= by1 && cx2 <= bx2 && cy2 <= by2
    })
    .map(c => c.id)
}
