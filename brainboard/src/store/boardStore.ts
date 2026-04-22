import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type {
  Board, Card, Entity, Backdrop,
  EntityType, BackdropType, Position, Size, Viewport,
} from '@/types/board'
import {
  TYPE_SWATCH_DEFAULTS, BACKDROP_SWATCH_DEFAULTS,
} from '@/types/board'

export const WORLD_SIZE   = 8000
export const WORLD_CENTER = WORLD_SIZE / 2
export const CARD_W       = 220
export const CARD_H       = 160
export const BACKDROP_MIN_W = 200
export const BACKDROP_MIN_H = 120

function makeBoard(): Board {
  return {
    schemaVersion: 1,
    boardId:       nanoid(),
    name:          'Untitled Board',
    createdAt:     new Date().toISOString(),
    updatedAt:     new Date().toISOString(),
    viewport:      { x: WORLD_CENTER, y: WORLD_CENTER, zoom: 1 },
    cards:         [],
    entities:      [],
    backdrops:     [],
  }
}

function touch<T extends { updatedAt: string }>(obj: T): T {
  return { ...obj, updatedAt: new Date().toISOString() }
}

function maxZ(items: { zIndex: number }[]): number {
  return items.length === 0 ? 0 : Math.max(...items.map(c => c.zIndex))
}

interface BoardStore {
  board: Board

  setBoardName:   (name: string) => void
  setViewport:    (viewport: Viewport) => void

  // Cards
  createCard:           (position: Position, type?: EntityType) => Card
  duplicateCard:        (id: string) => Card | null
  createInstance:       (id: string, position: Position) => Card | null
  deleteCard:           (id: string) => void
  deleteCards:          (ids: string[]) => void
  updateCardPosition:   (id: string, position: Position) => void
  updateCardPositions:  (updates: { id: string; position: Position }[]) => void
  updateCardContent:    (id: string, patch: Partial<Pick<Card, 'title' | 'noteRaw' | 'instanceNote' | 'isFlipped' | 'color' | 'type' | 'rotation'>>) => void
  bringToFront:         (id: string) => void
  updateEntityAttribute:(entityId: string, key: string, value: string | string[]) => void

  // Publish
  publishCard:   (id: string) => void
  publishCards:  (ids: string[]) => void
  publishAll:    () => void

  // Backdrops
  createBackdrop:         (position: Position, size: Size, type: BackdropType) => Backdrop
  updateBackdropPosition: (id: string, position: Position) => void
  updateBackdropSize:     (id: string, position: Position, size: Size) => void
  updateBackdropContent:  (id: string, patch: Partial<Pick<Backdrop, 'title' | 'color' | 'note'>>) => void
  updateBackdropAttribute:(id: string, key: string, value: string) => void
  deleteBackdrop:         (id: string) => void
  moveBackdropWithCards:  (id: string, backdropPos: Position, cardUpdates: { id: string; position: Position }[]) => void

  // Persistence
  loadBoard: (board: Board) => void
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  board: makeBoard(),

  setBoardName: (name) =>
    set(s => ({ board: touch({ ...s.board, name }) })),

  setViewport: (viewport) =>
    set(s => ({ board: { ...s.board, viewport } })),

  // ── Cards ────────────────────────────────────────────────────────────────

  createCard: (position, type: EntityType = 'Thought') => {
    const card: Card = {
      id:           nanoid(),
      entityId:     null,
      type,
      position,
      rotation:     0,
      color:        TYPE_SWATCH_DEFAULTS[type],
      zIndex:       maxZ(get().board.cards) + 1,
      noteRaw:      '',
      instanceNote: '',
      isFlipped:    false,
      title:        'New Card',
    }
    set(s => ({ board: touch({ ...s.board, cards: [...s.board.cards, card] }) }))
    return card
  },

  duplicateCard: (id) => {
    const source = get().board.cards.find(c => c.id === id)
    if (!source) return null
    const card: Card = {
      ...source,
      id:           nanoid(),
      entityId:     null,
      position:     { x: source.position.x + 24, y: source.position.y + 24 },
      zIndex:       maxZ(get().board.cards) + 1,
      instanceNote: '',
    }
    set(s => ({ board: touch({ ...s.board, cards: [...s.board.cards, card] }) }))
    return card
  },

  createInstance: (id, position) => {
    const source = get().board.cards.find(c => c.id === id)
    if (!source || source.entityId === null) return null
    const card: Card = {
      ...source,
      id:           nanoid(),
      position,
      zIndex:       maxZ(get().board.cards) + 1,
      instanceNote: '',
      isFlipped:    false,
    }
    set(s => ({ board: touch({ ...s.board, cards: [...s.board.cards, card] }) }))
    return card
  },

  deleteCard: (id) =>
    set(s => {
      const card = s.board.cards.find(c => c.id === id)
      if (!card) return s
      let cards    = s.board.cards.filter(c => c.id !== id)
      let entities = s.board.entities
      if (card.entityId !== null && !cards.some(c => c.entityId === card.entityId)) {
        entities = entities.filter(e => e.id !== card.entityId)
      }
      return { board: touch({ ...s.board, cards, entities }) }
    }),

  deleteCards: (ids) =>
    set(s => {
      const idSet  = new Set(ids)
      let cards    = s.board.cards.filter(c => !idSet.has(c.id))
      let entities = s.board.entities
      const deletedEntityIds = s.board.cards
        .filter(c => idSet.has(c.id) && c.entityId !== null)
        .map(c => c.entityId!)
      for (const eid of deletedEntityIds) {
        if (!cards.some(c => c.entityId === eid)) {
          entities = entities.filter(e => e.id !== eid)
        }
      }
      return { board: touch({ ...s.board, cards, entities }) }
    }),

  updateCardPosition: (id, position) =>
    set(s => ({
      board: touch({
        ...s.board,
        cards: s.board.cards.map(c => c.id === id ? { ...c, position } : c),
      }),
    })),

  // Batch update for backdrop move + contained cards in one store write
  updateCardPositions: (updates) =>
    set(s => {
      const map = new Map(updates.map(u => [u.id, u.position]))
      return {
        board: touch({
          ...s.board,
          cards: s.board.cards.map(c => map.has(c.id) ? { ...c, position: map.get(c.id)! } : c),
        }),
      }
    }),

  updateCardContent: (id, patch) =>
    set(s => {
      const card = s.board.cards.find(c => c.id === id)
      if (!card) return s
      const updatedCards = s.board.cards.map(c => c.id === id ? { ...c, ...patch } : c)
      let updatedEntities = s.board.entities
      if (card.entityId && (patch.noteRaw !== undefined || patch.title !== undefined)) {
        updatedEntities = s.board.entities.map(e =>
          e.id === card.entityId ? {
            ...e,
            ...(patch.noteRaw !== undefined ? { noteRaw: patch.noteRaw } : {}),
            ...(patch.title   !== undefined ? { title:   patch.title   } : {}),
          } : e
        )
      }
      return { board: touch({ ...s.board, cards: updatedCards, entities: updatedEntities }) }
    }),

  bringToFront: (id) =>
    set(s => ({
      board: touch({
        ...s.board,
        cards: s.board.cards.map(c =>
          c.id === id ? { ...c, zIndex: maxZ(s.board.cards) + 1 } : c
        ),
      }),
    })),

  updateEntityAttribute: (entityId, key, value) =>
    set(s => ({
      board: touch({
        ...s.board,
        entities: s.board.entities.map(e =>
          e.id === entityId ? { ...e, attributes: { ...e.attributes, [key]: value } } : e
        ),
      }),
    })),

  // ── Publish ──────────────────────────────────────────────────────────────

  publishCard: (id) =>
    set(s => {
      const card = s.board.cards.find(c => c.id === id)
      if (!card || card.entityId !== null) return s
      const entityId = nanoid()
      return {
        board: touch({
          ...s.board,
          cards:    s.board.cards.map(c => c.id === id ? { ...c, entityId } : c),
          entities: [...s.board.entities, {
            id: entityId, type: card.type, title: card.title,
            noteRaw: card.noteRaw, attributes: {},
          }],
        }),
      }
    }),

  publishCards: (ids) =>
    set(s => {
      const targets = ids
        .map(id => s.board.cards.find(c => c.id === id))
        .filter((c): c is Card => !!c && c.entityId === null)
      if (targets.length === 0) return s
      const newEntities: Entity[] = targets.map(card => ({
        id: nanoid(), type: card.type, title: card.title,
        noteRaw: card.noteRaw, attributes: {},
      }))
      const idMap = new Map(targets.map((card, i) => [card.id, newEntities[i].id]))
      return {
        board: touch({
          ...s.board,
          cards:    s.board.cards.map(c => idMap.has(c.id) ? { ...c, entityId: idMap.get(c.id)! } : c),
          entities: [...s.board.entities, ...newEntities],
        }),
      }
    }),

  publishAll: () => {
    const ids = get().board.cards.filter(c => c.entityId === null).map(c => c.id)
    get().publishCards(ids)
  },

  // ── Backdrops ─────────────────────────────────────────────────────────────

  createBackdrop: (position, size, type) => {
    const backdrop: Backdrop = {
      id:         nanoid(),
      type,
      title:      type,
      note:       '',
      position,
      size: {
        width:  Math.max(size.width,  BACKDROP_MIN_W),
        height: Math.max(size.height, BACKDROP_MIN_H),
      },
      color:      BACKDROP_SWATCH_DEFAULTS[type],
      zIndex:     maxZ(get().board.backdrops) + 1,
      attributes: {},
    }
    set(s => ({ board: touch({ ...s.board, backdrops: [...s.board.backdrops, backdrop] }) }))
    return backdrop
  },

  updateBackdropPosition: (id, position) =>
    set(s => ({
      board: touch({
        ...s.board,
        backdrops: s.board.backdrops.map(b => b.id === id ? { ...b, position } : b),
      }),
    })),

  updateBackdropSize: (id, position, size) =>
    set(s => ({
      board: touch({
        ...s.board,
        backdrops: s.board.backdrops.map(b =>
          b.id === id ? {
            ...b,
            position,
            size: {
              width:  Math.max(size.width,  BACKDROP_MIN_W),
              height: Math.max(size.height, BACKDROP_MIN_H),
            },
          } : b
        ),
      }),
    })),

  updateBackdropContent: (id, patch) =>
    set(s => ({
      board: touch({
        ...s.board,
        backdrops: s.board.backdrops.map(b => b.id === id ? { ...b, ...patch } : b),
      }),
    })),

  updateBackdropAttribute: (id, key, value) =>
    set(s => ({
      board: touch({
        ...s.board,
        backdrops: s.board.backdrops.map(b =>
          b.id === id ? { ...b, attributes: { ...b.attributes, [key]: value } } : b
        ),
      }),
    })),

  deleteBackdrop: (id) =>
    set(s => ({
      board: touch({
        ...s.board,
        backdrops: s.board.backdrops.filter(b => b.id !== id),
      }),
    })),

  // Atomic move: backdrop position + all contained cards in one store write
  moveBackdropWithCards: (id, backdropPos, cardUpdates) =>
    set(s => {
      const map = new Map(cardUpdates.map(u => [u.id, u.position]))
      return {
        board: touch({
          ...s.board,
          backdrops: s.board.backdrops.map(b => b.id === id ? { ...b, position: backdropPos } : b),
          cards:     s.board.cards.map(c => map.has(c.id) ? { ...c, position: map.get(c.id)! } : c),
        }),
      }
    }),

  // ── Persistence ───────────────────────────────────────────────────────────

  loadBoard: (board) => set({
    board: {
      ...board,
      backdrops: (board.backdrops ?? []).map(b => ({ note: '', ...b })),
    },
  }),
}))
