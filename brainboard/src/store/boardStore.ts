import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type {
  Board,
  Card,
  Entity,
  EntityType,
  Position,
  Viewport,
} from '@/types/board'
import { TYPE_SWATCH_DEFAULTS } from '@/types/board'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// World is 8000×8000 world-pixels. Cards begin at center (4000, 4000) offset.
// If users hit the edge in practice, increase WORLD_SIZE or switch to true
// infinite mode in react-infinite-viewer. For the prototype this is ample.
export const WORLD_SIZE   = 8000
export const WORLD_CENTER = WORLD_SIZE / 2

// Default card dimensions (must match --card-width-default / --card-height-default in tokens.css)
export const CARD_W = 240
export const CARD_H = 180

const INITIAL_VIEWPORT: Viewport = {
  x:    WORLD_CENTER,
  y:    WORLD_CENTER,
  zoom: 1,
}

// ---------------------------------------------------------------------------
// Store helpers (pure functions, not exported — internal to store)
// ---------------------------------------------------------------------------

function makeBoard(): Board {
  return {
    schemaVersion: 1,
    boardId:       nanoid(),
    name:          'Untitled Board',
    createdAt:     new Date().toISOString(),
    updatedAt:     new Date().toISOString(),
    viewport:      INITIAL_VIEWPORT,
    cards:         [],
    entities:      [],
  }
}

// Touch updatedAt on any mutation.
function touch<T extends { updatedAt: string }>(obj: T): T {
  return { ...obj, updatedAt: new Date().toISOString() }
}

function maxZ(cards: Card[]): number {
  return cards.length === 0 ? 0 : Math.max(...cards.map(c => c.zIndex))
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface BoardStore {
  board: Board

  // Board metadata
  setBoardName: (name: string) => void
  setViewport:  (viewport: Viewport) => void

  // Card CRUD
  createCard:         (position: Position, type?: EntityType) => Card
  duplicateCard:      (id: string) => Card | null
  createInstance:     (id: string, position: Position) => Card | null
  deleteCard:         (id: string) => void
  updateCardPosition: (id: string, position: Position) => void
  updateCardContent:  (
    id: string,
    patch: Partial<Pick<Card, 'title' | 'noteRaw' | 'instanceNote' | 'isFlipped' | 'color' | 'type' | 'rotation'>>
  ) => void
  bringToFront: (id: string) => void

  // Publish flow
  // Phase 7 adds the warning / dependency-order UI on top of these.
  publishCard:  (id: string) => void
  publishCards: (ids: string[]) => void
  publishAll:   () => void

  // Persistence (Phase 9 implements; stubs here keep the interface stable)
  loadBoard: (board: Board) => void
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useBoardStore = create<BoardStore>((set, get) => ({
  board: makeBoard(),

  // --- Board metadata ---

  setBoardName: (name) =>
    set(s => ({ board: touch({ ...s.board, name }) })),

  setViewport: (viewport) =>
    // Deliberate: setViewport does NOT touch updatedAt.
    // Viewport is not part of the board's content state — it's ephemeral UI.
    set(s => ({ board: { ...s.board, viewport } })),

  // --- Card CRUD ---

  createCard: (position, type = 'Character') => {
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
      title:        `New ${type}`,
    }
    set(s => ({
      board: touch({ ...s.board, cards: [...s.board.cards, card] }),
    }))
    return card
  },

  duplicateCard: (id) => {
    const { board } = get()
    const source = board.cards.find(c => c.id === id)
    if (!source) return null

    // Duplicate is always an independent unpublished draft — not an instance.
    const card: Card = {
      ...source,
      id:           nanoid(),
      entityId:     null,
      position:     { x: source.position.x + 24, y: source.position.y + 24 },
      zIndex:       maxZ(board.cards) + 1,
      instanceNote: '',
    }
    set(s => ({
      board: touch({ ...s.board, cards: [...s.board.cards, card] }),
    }))
    return card
  },

  createInstance: (id, position) => {
    const { board } = get()
    const source = board.cards.find(c => c.id === id)

    // Can only create instances of published cards (entityId required).
    if (!source || source.entityId === null) return null

    const card: Card = {
      ...source,
      id:           nanoid(),
      position,
      zIndex:       maxZ(board.cards) + 1,
      instanceNote: '',
      isFlipped:    false,
    }
    set(s => ({
      board: touch({ ...s.board, cards: [...s.board.cards, card] }),
    }))
    return card
  },

  deleteCard: (id) =>
    set(s => ({
      board: touch({
        ...s.board,
        cards: s.board.cards.filter(c => c.id !== id),
      }),
    })),

  updateCardPosition: (id, position) =>
    set(s => ({
      board: touch({
        ...s.board,
        cards: s.board.cards.map(c => (c.id === id ? { ...c, position } : c)),
      }),
    })),

  updateCardContent: (id, patch) =>
    set(s => {
      const card = s.board.cards.find(c => c.id === id)
      if (!card) return s

      const updatedCards = s.board.cards.map(c =>
        c.id === id ? { ...c, ...patch } : c
      )

      // If noteRaw or title changed on a published card, sync to the entity.
      // This makes all instances reflect the change on their attribute sides.
      let updatedEntities = s.board.entities
      if (
        card.entityId !== null &&
        (patch.noteRaw !== undefined || patch.title !== undefined)
      ) {
        updatedEntities = s.board.entities.map(e =>
          e.id === card.entityId
            ? {
                ...e,
                ...(patch.noteRaw !== undefined ? { noteRaw: patch.noteRaw } : {}),
                ...(patch.title !== undefined ? { title: patch.title } : {}),
              }
            : e
        )
      }

      return {
        board: touch({
          ...s.board,
          cards:    updatedCards,
          entities: updatedEntities,
        }),
      }
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

  // --- Publish flow ---

  publishCard: (id) =>
    set(s => {
      const card = s.board.cards.find(c => c.id === id)
      if (!card || card.entityId !== null) return s  // no-op if already published

      const entityId = nanoid()
      const entity: Entity = {
        id:         entityId,
        type:       card.type,
        title:      card.title,
        noteRaw:    card.noteRaw,
        attributes: {},
      }

      return {
        board: touch({
          ...s.board,
          cards:    s.board.cards.map(c => (c.id === id ? { ...c, entityId } : c)),
          entities: [...s.board.entities, entity],
        }),
      }
    }),

  publishCards: (ids) =>
    set(s => {
      // Only process cards that are actually unpublished
      const targets = ids
        .map(id => s.board.cards.find(c => c.id === id))
        .filter((c): c is Card => c !== undefined && c.entityId === null)

      if (targets.length === 0) return s

      const newEntities: Entity[] = targets.map(card => ({
        id:         nanoid(),
        type:       card.type,
        title:      card.title,
        noteRaw:    card.noteRaw,
        attributes: {},
      }))

      // Map cardId → entityId
      const idMap = new Map(targets.map((card, i) => [card.id, newEntities[i].id]))

      return {
        board: touch({
          ...s.board,
          cards: s.board.cards.map(c =>
            idMap.has(c.id) ? { ...c, entityId: idMap.get(c.id)! } : c
          ),
          entities: [...s.board.entities, ...newEntities],
        }),
      }
    }),

  publishAll: () => {
    // TODO Phase 7: resolve dependency order; warn on orphaned cross-references.
    const unpublishedIds = get().board.cards
      .filter(c => c.entityId === null)
      .map(c => c.id)
    get().publishCards(unpublishedIds)
  },

  // --- Persistence ---

  loadBoard: (board) =>
    set({ board }),
}))
