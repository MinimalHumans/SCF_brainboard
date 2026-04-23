import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { Board, Card, Entity, Backdrop, EntityType, BackdropType, Position, Size, Viewport } from '@/types/board'
import { TYPE_SWATCH_DEFAULTS, BACKDROP_SWATCH_DEFAULTS, getContainedCardIds, getContainedBackdropIds } from '@/types/board'
import { useHistoryStore } from '@/store/historyStore'

export const WORLD_SIZE    = 8000
export const WORLD_CENTER  = WORLD_SIZE / 2
export const CARD_W        = 320
export const CARD_H        = 160
export const BACKDROP_MIN_W = 200
export const BACKDROP_MIN_H = 120

function makeBoard(): Board {
  return {
    schemaVersion: 1, boardId: nanoid(),
    name: 'Untitled Board',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    viewport: { x: WORLD_CENTER, y: WORLD_CENTER, zoom: 1 },
    cards: [], entities: [], backdrops: [],
  }
}

function touch<T extends { updatedAt: string }>(obj: T): T {
  return { ...obj, updatedAt: new Date().toISOString() }
}

function maxZ(items: { zIndex: number }[]): number {
  return items.length === 0 ? 0 : Math.max(...items.map(c => c.zIndex))
}

// Push snapshot to history before mutating
function snapshot() {
  useHistoryStore.getState().push(useBoardStore.getState().board)
}

interface BoardStore {
  board: Board
  setBoardName:           (name: string) => void
  setViewport:            (viewport: Viewport) => void
  createCard:             (position: Position, type?: EntityType) => Card
  duplicateCard:          (id: string) => Card | null
  createInstance:         (id: string, position: Position) => Card | null
  deleteCard:             (id: string) => void
  deleteCards:            (ids: string[]) => void
  updateCardPosition:     (id: string, position: Position) => void
  updateCardPositions:    (updates: { id: string; position: Position }[]) => void
  updateCardContent:      (id: string, patch: Partial<Pick<Card, 'title' | 'noteRaw' | 'instanceNote' | 'color' | 'type'>>) => void
  bringToFront:           (id: string) => void
  updateEntityAttribute:  (entityId: string, key: string, value: string | string[]) => void
  publishCard:            (id: string) => void
  publishCards:           (ids: string[]) => void
  publishAll:             () => void
  createBackdrop:         (position: Position, size: Size, type: BackdropType, fromMenu?: boolean) => Backdrop
  duplicateBackdrop:      (id: string) => void
  updateBackdropPosition: (id: string, position: Position) => void
  updateBackdropSize:     (id: string, position: Position, size: Size) => void
  updateBackdropContent:  (id: string, patch: Partial<Pick<Backdrop, 'title' | 'color' | 'note'>>) => void
  updateBackdropType:     (id: string, type: BackdropType) => void
  updateBackdropAttribute:(id: string, key: string, value: string) => void
  deleteBackdrop:         (id: string) => void
  moveBackdropWithCards:  (id: string, backdropPos: Position, cardUpdates: { id: string; position: Position }[], backdropUpdates: { id: string; position: Position }[]) => void
  loadBoard:              (board: Board) => void
  undo:                   () => void
  redo:                   () => void
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  board: makeBoard(),

  setBoardName: (name) => { snapshot(); set(s => ({ board: touch({ ...s.board, name }) })) },

  setViewport: (viewport) => set(s => ({ board: { ...s.board, viewport } })),

  createCard: (position, type = 'Thought') => {
    snapshot()
    const entityId = nanoid()
    const entity: Entity = { id: entityId, type: type ?? 'Thought', title: 'New Card', noteRaw: '', attributes: {} }
    const card: Card = {
      id: nanoid(), entityId,
      type: type ?? 'Thought',
      position, rotation: 0,
      color: TYPE_SWATCH_DEFAULTS[type ?? 'Thought'],
      zIndex: maxZ(get().board.cards) + 1,
      noteRaw: '', instanceNote: '', isFlipped: false, title: 'New Card',
    }
    set(s => ({ board: touch({ ...s.board, cards: [...s.board.cards, card], entities: [...s.board.entities, entity] }) }))
    return card
  },

  duplicateCard: (id) => {
    snapshot()
    const source = get().board.cards.find(c => c.id === id)
    if (!source) return null
    const entityId = nanoid()
    const srcEntity = get().board.entities.find(e => e.id === source.entityId)
    const entity: Entity = { id: entityId, type: source.type, title: source.title, noteRaw: source.noteRaw, attributes: { ...(srcEntity?.attributes ?? {}) } }
    const card: Card = { ...source, id: nanoid(), entityId, position: { x: source.position.x + 24, y: source.position.y + 24 }, zIndex: maxZ(get().board.cards) + 1, instanceNote: '' }
    set(s => ({ board: touch({ ...s.board, cards: [...s.board.cards, card], entities: [...s.board.entities, entity] }) }))
    return card
  },

  createInstance: (id, position) => {
    snapshot()
    const source = get().board.cards.find(c => c.id === id)
    if (!source) return null
    const card: Card = { ...source, id: nanoid(), position, zIndex: maxZ(get().board.cards) + 1, instanceNote: '', isFlipped: false }
    set(s => ({ board: touch({ ...s.board, cards: [...s.board.cards, card] }) }))
    return card
  },

  deleteCard: (id) => {
    snapshot()
    set(s => {
      const card = s.board.cards.find(c => c.id === id)
      if (!card) return s
      const cards = s.board.cards.filter(c => c.id !== id)
      const remainingInstances = cards.filter(c => c.entityId === card.entityId)
      const entities = remainingInstances.length === 0
        ? s.board.entities.filter(e => e.id !== card.entityId)
        : s.board.entities
      return { board: touch({ ...s.board, cards, entities }) }
    })
  },

  deleteCards: (ids) => {
    snapshot()
    const idSet = new Set(ids)
    set(s => {
      const cards = s.board.cards.filter(c => !idSet.has(c.id))
      const deletedEntityIds = [...new Set(s.board.cards.filter(c => idSet.has(c.id)).map(c => c.entityId))]
      const entities = s.board.entities.filter(e =>
        !deletedEntityIds.includes(e.id) || cards.some(c => c.entityId === e.id)
      )
      return { board: touch({ ...s.board, cards, entities }) }
    })
  },

  updateCardPosition: (id, position) =>
    set(s => ({ board: touch({ ...s.board, cards: s.board.cards.map(c => c.id === id ? { ...c, position } : c) }) })),

  updateCardPositions: (updates) => {
    const map = new Map(updates.map(u => [u.id, u.position]))
    set(s => ({ board: touch({ ...s.board, cards: s.board.cards.map(c => map.has(c.id) ? { ...c, position: map.get(c.id)! } : c) }) }))
  },

  updateCardContent: (id, patch) =>
    set(s => {
      const card = s.board.cards.find(c => c.id === id)
      if (!card) return s
      const cards = s.board.cards.map(c => c.id === id ? { ...c, ...patch } : c)
      let entities = s.board.entities
      if (patch.noteRaw !== undefined || patch.title !== undefined) {
        entities = entities.map(e => e.id === card.entityId ? {
          ...e,
          ...(patch.noteRaw !== undefined ? { noteRaw: patch.noteRaw } : {}),
          ...(patch.title   !== undefined ? { title:   patch.title   } : {}),
        } : e)
      }
      return { board: touch({ ...s.board, cards, entities }) }
    }),

  bringToFront: (id) =>
    set(s => ({ board: touch({ ...s.board, cards: s.board.cards.map(c => c.id === id ? { ...c, zIndex: maxZ(s.board.cards) + 1 } : c) }) })),

  updateEntityAttribute: (entityId, key, value) =>
    set(s => ({ board: touch({ ...s.board, entities: s.board.entities.map(e => e.id === entityId ? { ...e, attributes: { ...e.attributes, [key]: value } } : e) }) })),

  publishCard: (id) => set(s => s),   // no-op — cards always published
  publishCards: (ids) => set(s => s),
  publishAll: () => {},

  createBackdrop: (position, size, type, fromMenu = false) => {
    snapshot()
    const backdrop: Backdrop = {
      id: nanoid(), type, title: type, note: '',
      position,
      size: fromMenu ? { width: 600, height: 400 } : { width: Math.max(size.width, BACKDROP_MIN_W), height: Math.max(size.height, BACKDROP_MIN_H) },
      color: BACKDROP_SWATCH_DEFAULTS[type],
      zIndex: maxZ(get().board.backdrops) + 1, attributes: {},
    }
    set(s => ({ board: touch({ ...s.board, backdrops: [...s.board.backdrops, backdrop] }) }))
    return backdrop
  },

  duplicateBackdrop: (id) => {
    snapshot()
    set(s => {
      const source = s.board.backdrops.find(b => b.id === id)
      if (!source) return s
      const copy: Backdrop = { ...source, id: nanoid(), position: { x: source.position.x + 32, y: source.position.y + 32 }, zIndex: maxZ(s.board.backdrops) + 1 }
      return { board: touch({ ...s.board, backdrops: [...s.board.backdrops, copy] }) }
    })
  },

  updateBackdropPosition: (id, position) =>
    set(s => ({ board: touch({ ...s.board, backdrops: s.board.backdrops.map(b => b.id === id ? { ...b, position } : b) }) })),

  updateBackdropSize: (id, position, size) =>
    set(s => ({ board: touch({ ...s.board, backdrops: s.board.backdrops.map(b => b.id === id ? { ...b, position, size: { width: Math.max(size.width, BACKDROP_MIN_W), height: Math.max(size.height, BACKDROP_MIN_H) } } : b) }) })),

  updateBackdropContent: (id, patch) =>
    set(s => ({ board: touch({ ...s.board, backdrops: s.board.backdrops.map(b => b.id === id ? { ...b, ...patch } : b) }) })),

  updateBackdropType: (id, type) =>
    set(s => ({ board: touch({ ...s.board, backdrops: s.board.backdrops.map(b => b.id === id ? { ...b, type, color: BACKDROP_SWATCH_DEFAULTS[type], attributes: {} } : b) }) })),

  updateBackdropAttribute: (id, key, value) =>
    set(s => ({ board: touch({ ...s.board, backdrops: s.board.backdrops.map(b => b.id === id ? { ...b, attributes: { ...b.attributes, [key]: value } } : b) }) })),

  deleteBackdrop: (id) => {
    snapshot()
    set(s => ({ board: touch({ ...s.board, backdrops: s.board.backdrops.filter(b => b.id !== id) }) }))
  },

  moveBackdropWithCards: (id, backdropPos, cardUpdates, backdropUpdates) => {
    snapshot()
    const cardMap    = new Map(cardUpdates.map(u => [u.id, u.position]))
    const bdMap      = new Map(backdropUpdates.map(u => [u.id, u.position]))
    set(s => ({
      board: touch({
        ...s.board,
        backdrops: s.board.backdrops.map(b =>
          b.id === id ? { ...b, position: backdropPos }
          : bdMap.has(b.id) ? { ...b, position: bdMap.get(b.id)! }
          : b
        ),
        cards: s.board.cards.map(c => cardMap.has(c.id) ? { ...c, position: cardMap.get(c.id)! } : c),
      }),
    }))
  },

  loadBoard: (board) => set({ board: { ...board, backdrops: (board.backdrops ?? []).map(b => ({ note: '', ...b })) } }),

  undo: () => {
    const prev = useHistoryStore.getState().undo(get().board)
    if (prev) set({ board: prev })
  },

  redo: () => {
    const next = useHistoryStore.getState().redo(get().board)
    if (next) set({ board: next })
  },
}))
