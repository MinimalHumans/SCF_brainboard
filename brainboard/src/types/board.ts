export const ENTITY_TYPES = [
  'Character', 'Location', 'Scene', 'Prop',
  'Beat', 'Theme', 'Arc', 'Shot', 'Thought',
] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

export const BACKDROP_TYPES = ['Sequence', 'Act', 'Beat', 'Scene', 'Custom'] as const
export type BackdropType = (typeof BACKDROP_TYPES)[number]

export const SWATCH_KEYS = [
  'amber', 'sage', 'sky', 'sand', 'violet', 'rose', 'slate', 'fog',
  'crimson', 'emerald', 'cobalt', 'gold',
] as const
export type SwatchKey = (typeof SWATCH_KEYS)[number]

export const TYPE_SWATCH_DEFAULTS: Record<EntityType, SwatchKey> = {
  Character: 'amber', Location: 'sage',   Scene:    'sky',
  Prop:      'sand',  Beat:     'rose',   Theme:    'violet',
  Arc:       'slate', Shot:     'fog',    Thought:  'fog',
}

export const BACKDROP_SWATCH_DEFAULTS: Record<BackdropType, SwatchKey> = {
  Sequence: 'sky', Act: 'violet', Beat: 'rose', Scene: 'sky', Custom: 'fog',
}

export interface Position { x: number; y: number }
export interface Size     { width: number; height: number }
export interface Viewport { x: number; y: number; zoom: number }

export interface Card {
  id:           string
  entityId:     string       // always set — cards are published on creation
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
  note:       string
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

export function isInstance(card: Card, allCards: Card[]): boolean {
  return allCards.some(c => c.entityId === card.entityId && c.id !== card.id)
}

export function getContainedCardIds(backdrop: Backdrop, cards: Card[], cardW: number, cardH: number): string[] {
  const bx1 = backdrop.position.x, by1 = backdrop.position.y
  const bx2 = bx1 + backdrop.size.width, by2 = by1 + backdrop.size.height
  return cards.filter(c => {
    const cx1 = c.position.x, cy1 = c.position.y
    return cx1 >= bx1 && cy1 >= by1 && cx1 + cardW <= bx2 && cy1 + cardH <= by2
  }).map(c => c.id)
}

export function getContainedBackdropIds(parent: Backdrop, backdrops: Backdrop[]): string[] {
  const bx1 = parent.position.x, by1 = parent.position.y
  const bx2 = bx1 + parent.size.width, by2 = by1 + parent.size.height
  return backdrops.filter(b => {
    if (b.id === parent.id) return false
    return b.position.x >= bx1 && b.position.y >= by1 &&
           b.position.x + b.size.width  <= bx2 &&
           b.position.y + b.size.height <= by2
  }).map(b => b.id)
}
