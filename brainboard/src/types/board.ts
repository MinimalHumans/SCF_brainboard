/*
 * Brainboard Board Types
 * Beat/Backdrop is NOT a card type — it's a Phase 11 spatial region.
 * Removed from ENTITY_TYPES to reflect this.
 */

export const ENTITY_TYPES = [
  'Character',
  'Location',
  'Scene',
  'Prop',
  'Sequence',
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

export const TYPE_SWATCH_DEFAULTS: Record<EntityType, SwatchKey> = {
  Character: 'amber',
  Location:  'sage',
  Scene:     'sky',
  Prop:      'sand',
  Sequence:  'violet',
}

export interface Position {
  x: number
  y: number
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

export interface Board {
  schemaVersion: 1
  boardId:       string
  name:          string
  createdAt:     string
  updatedAt:     string
  viewport:      Viewport
  cards:         Card[]
  entities:      Entity[]
}

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
