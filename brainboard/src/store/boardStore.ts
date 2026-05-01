import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type {
  Board, Card, Entity, Backdrop, EntityType, BackdropType, Position, Size, Viewport, ProjectInfo
} from '@/types/board'
import {
  TYPE_SWATCH_DEFAULTS, BACKDROP_SWATCH_DEFAULTS,
  getContainedCardIds, getContainedBackdropIds,
  BACKDROP_Z_LAYERS, CARD_Z_BASE,
} from '@/types/board'
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
    projectInfo: {},
  }
}

function touch<T extends { updatedAt: string }>(obj: T): T {
  return { ...obj, updatedAt: new Date().toISOString() }
}

function maxCardZ(cards: { zIndex: number }[]): number {
  return cards.length === 0 ? CARD_Z_BASE : Math.max(CARD_Z_BASE, ...cards.map(c => c.zIndex))
}

// Internal: push a snapshot to history before a mutation.
function snapshot() {
  useHistoryStore.getState().push(useBoardStore.getState().board)
}

/*
 * snapshotBoard — exported so components can call it from onFocus handlers.
 *
 * Pattern for text fields:
 *   <input onFocus={() => snapshotBoard()} onChange={e => updateSomething(e.target.value)} />
 *
 * This captures the pre-edit state exactly once when the user enters the
 * field. All keystrokes after that are free updates. Undo restores the
 * state from before the user started typing — one step per field session,
 * not one step per keystroke.
 *
 * Discrete actions (swatch clicks, type dropdowns) call snapshotBoard()
 * immediately before applying their change so each one is independently
 * undoable.
 */
export function snapshotBoard() {
  snapshot()
}

/*
 * Normalize a loaded board's backdrop z-indices to the hierarchy system.
 * This fixes boards saved before the hierarchy was introduced.
 */
function normalizeBackdrops(backdrops: Backdrop[]): Backdrop[] {
  return backdrops.map(b => ({
    note: '',
    ...b,
    zIndex: BACKDROP_Z_LAYERS[b.type] ?? 50,
  }))
}

/*
 * migrateEntities — migrate any entity with status: 'Archived' to 'Cut'.
 * Only runs in-memory; the file on disk updates only when the user saves.
 */
function migrateEntities(entities: Entity[]): Entity[] {
  return entities.map(e => {
    if (e.attributes?.['status'] === 'Archived') {
      return { ...e, attributes: { ...e.attributes, status: 'Cut' } }
    }
    return e
  })
}

/*
 * migrateBackdropAttrs — migrate any backdrop with status: 'Archived' to 'Cut'.
 */
function migrateBackdropAttrs(backdrops: Backdrop[]): Backdrop[] {
  return backdrops.map(b => {
    if (b.attributes?.['status'] === 'Archived') {
      return { ...b, attributes: { ...b.attributes, status: 'Cut' } }
    }
    return b
  })
}

interface BoardStore {
  board: Board
  setBoardName:                 (name: string) => void
  updateProjectInfo:            (patch: Partial<ProjectInfo>) => void
  setViewport:                  (viewport: Viewport) => void
  createCard:                   (position: Position, type?: EntityType) => Card
  duplicateCard:                (id: string) => Card | null
  createInstance:               (id: string, position: Position) => Card | null
  deleteCard:                   (id: string) => void
  deleteCards:                  (ids: string[]) => void
  updateCardPosition:           (id: string, position: Position) => void
  updateCardPositions:          (updates: { id: string; position: Position }[]) => void
  updateCardContent:            (id: string, patch: Partial<Pick<Card, 'title' | 'noteRaw' | 'instanceNote' | 'color' | 'type'>>) => void
  bringToFront:                 (id: string) => void
  updateEntityAttribute:        (entityId: string, key: string, value: string | string[]) => void
  publishCard:                  (id: string) => void
  publishCards:                 (ids: string[]) => void
  publishAll:                   () => void
  createBackdrop:               (position: Position, size: Size, type: BackdropType, fromMenu?: boolean) => Backdrop
  duplicateBackdrop:            (id: string) => void
  duplicateBackdropWithContents:(id: string) => void
  updateBackdropPosition:       (id: string, position: Position) => void
  updateBackdropSize:           (id: string, position: Position, size: Size) => void
  updateBackdropContent:        (id: string, patch: Partial<Pick<Backdrop, 'title' | 'color' | 'note'>>) => void
  updateBackdropType:           (id: string, type: BackdropType) => void
  updateBackdropAttribute:      (id: string, key: string, value: string) => void
  deleteBackdrop:               (id: string) => void
  moveBackdropWithCards:        (id: string, backdropPos: Position, cardUpdates: { id: string; position: Position }[], backdropUpdates: { id: string; position: Position }[]) => void
  loadBoard:                    (board: Board) => void
  undo:                         () => void
  redo:                         () => void
}

export const useBoardStore = create<BoardStore>((set, get) => ({
  board: makeBoard(),

  setBoardName: (name) => { snapshot(); set(s => ({ board: touch({ ...s.board, name }) })) },

  // Shallow-merge patch into board.projectInfo; creates the object if absent.
  // NO snapshot — callers follow the text-field pattern (snapshotBoard on focus).
  updateProjectInfo: (patch) =>
    set(s => ({
      board: touch({
        ...s.board,
        projectInfo: { ...(s.board.projectInfo ?? {}), ...patch },
      }),
    })),

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
      zIndex: maxCardZ(get().board.cards) + 1,
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
    const card: Card = { ...source, id: nanoid(), entityId, position: { x: source.position.x + 24, y: source.position.y + 24 }, zIndex: maxCardZ(get().board.cards) + 1, instanceNote: '' }
    set(s => ({ board: touch({ ...s.board, cards: [...s.board.cards, card], entities: [...s.board.entities, entity] }) }))
    return card
  },

  createInstance: (id, position) => {
    snapshot()
    const source = get().board.cards.find(c => c.id === id)
    if (!source) return null
    const card: Card = { ...source, id: nanoid(), position, zIndex: maxCardZ(get().board.cards) + 1, instanceNote: '', isFlipped: false }
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

  // Snapshot is taken once on pointerup (end of drag), not on every
  // pointermove frame. One undo step per drag gesture.
  updateCardPosition: (id, position) => {
    snapshot()
    set(s => ({ board: touch({ ...s.board, cards: s.board.cards.map(c => c.id === id ? { ...c, position } : c) }) }))
  },

  updateCardPositions: (updates) => {
    snapshot()
    const map = new Map(updates.map(u => [u.id, u.position]))
    set(s => ({ board: touch({ ...s.board, cards: s.board.cards.map(c => map.has(c.id) ? { ...c, position: map.get(c.id)! } : c) }) }))
  },

  // NO snapshot here — text fields call snapshotBoard() on onFocus so the
  // snapshot is taken once when the user enters the field. Discrete patches
  // (color, type) call snapshotBoard() in the component before invoking this.
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
    set(s => ({ board: touch({ ...s.board, cards: s.board.cards.map(c => c.id === id ? { ...c, zIndex: maxCardZ(s.board.cards) + 1 } : c) }) })),

  // NO snapshot — attribute text fields call snapshotBoard() on onFocus;
  // attribute selects call snapshotBoard() before invoking this.
  updateEntityAttribute: (entityId, key, value) =>
    set(s => ({ board: touch({ ...s.board, entities: s.board.entities.map(e => e.id === entityId ? { ...e, attributes: { ...e.attributes, [key]: value } } : e) }) })),

  publishCard:  (_id) => set(s => s),
  publishCards: (_ids) => set(s => s),
  publishAll:   () => {},

  createBackdrop: (position, size, type, fromMenu = false) => {
    snapshot()
    const backdrop: Backdrop = {
      id: nanoid(), type, title: type, note: '',
      position,
      size: fromMenu
        ? { width: 600, height: 400 }
        : { width: Math.max(size.width, BACKDROP_MIN_W), height: Math.max(size.height, BACKDROP_MIN_H) },
      color: BACKDROP_SWATCH_DEFAULTS[type],
      zIndex: BACKDROP_Z_LAYERS[type],
      attributes: {},
    }
    set(s => ({ board: touch({ ...s.board, backdrops: [...s.board.backdrops, backdrop] }) }))
    return backdrop
  },

  duplicateBackdrop: (id) => {
    snapshot()
    set(s => {
      const source = s.board.backdrops.find(b => b.id === id)
      if (!source) return s
      const copy: Backdrop = {
        ...source,
        id:       nanoid(),
        position: { x: source.position.x + source.size.width + 40, y: source.position.y },
        zIndex:   BACKDROP_Z_LAYERS[source.type] ?? 50,
      }
      return { board: touch({ ...s.board, backdrops: [...s.board.backdrops, copy] }) }
    })
  },

  duplicateBackdropWithContents: (id) => {
    snapshot()
    set(s => {
      const source = s.board.backdrops.find(b => b.id === id)
      if (!source) return s

      const dx = source.size.width + 40
      const dy = 0

      const newBackdrop: Backdrop = {
        ...source,
        id:       nanoid(),
        position: { x: source.position.x + dx, y: source.position.y + dy },
        zIndex:   BACKDROP_Z_LAYERS[source.type] ?? 50,
      }

      const containedCardIds = getContainedCardIds(source, s.board.cards, CARD_W, CARD_H)
      const newCards:    Card[]   = []
      const newEntities: Entity[] = []

      let runningZ = maxCardZ(s.board.cards)
      for (const cardId of containedCardIds) {
        const card = s.board.cards.find(c => c.id === cardId)
        if (!card) continue
        const srcEntity = s.board.entities.find(e => e.id === card.entityId)
        const newEntityId = nanoid()
        const newEntity: Entity = {
          id:         newEntityId,
          type:       card.type,
          title:      srcEntity?.title  ?? card.title,
          noteRaw:    srcEntity?.noteRaw ?? card.noteRaw,
          attributes: { ...(srcEntity?.attributes ?? {}) },
        }
        runningZ += 1
        const newCard: Card = {
          ...card,
          id:       nanoid(),
          entityId: newEntityId,
          position: { x: card.position.x + dx, y: card.position.y + dy },
          zIndex:   runningZ,
        }
        newCards.push(newCard)
        newEntities.push(newEntity)
      }

      const containedBdIds = getContainedBackdropIds(source, s.board.backdrops)
      const newSubBackdrops: Backdrop[] = containedBdIds.map(bdId => {
        const bd = s.board.backdrops.find(b => b.id === bdId)!
        return {
          ...bd,
          id:       nanoid(),
          position: { x: bd.position.x + dx, y: bd.position.y + dy },
          zIndex:   BACKDROP_Z_LAYERS[bd.type] ?? 50,
        }
      })

      return {
        board: touch({
          ...s.board,
          backdrops: [...s.board.backdrops, newBackdrop, ...newSubBackdrops],
          cards:     [...s.board.cards, ...newCards],
          entities:  [...s.board.entities, ...newEntities],
        }),
      }
    })
  },

  updateBackdropPosition: (id, position) =>
    set(s => ({ board: touch({ ...s.board, backdrops: s.board.backdrops.map(b => b.id === id ? { ...b, position } : b) }) })),

  // Snapshot here: resize commits once on pointerup, one undo step per resize gesture.
  updateBackdropSize: (id, position, size) => {
    snapshot()
    set(s => ({ board: touch({ ...s.board, backdrops: s.board.backdrops.map(b => b.id === id ? { ...b, position, size: { width: Math.max(size.width, BACKDROP_MIN_W), height: Math.max(size.height, BACKDROP_MIN_H) } } : b) }) }))
  },

  // NO snapshot — title/note fields call snapshotBoard() on onFocus;
  // color (swatch) calls snapshotBoard() in the component before invoking this.
  updateBackdropContent: (id, patch) =>
    set(s => ({ board: touch({ ...s.board, backdrops: s.board.backdrops.map(b => b.id === id ? { ...b, ...patch } : b) }) })),

  // Snapshot here: changing type is a discrete action (dropdown select),
  // one undo step per change.
  updateBackdropType: (id, type) => {
    snapshot()
    set(s => ({ board: touch({ ...s.board, backdrops: s.board.backdrops.map(b => b.id === id ? { ...b, type, color: BACKDROP_SWATCH_DEFAULTS[type], zIndex: BACKDROP_Z_LAYERS[type], attributes: {} } : b) }) }))
  },

  // NO snapshot — attribute text/textarea fields call snapshotBoard() on
  // onFocus; attribute selects call snapshotBoard() before invoking this.
  updateBackdropAttribute: (id, key, value) =>
    set(s => ({ board: touch({ ...s.board, backdrops: s.board.backdrops.map(b => b.id === id ? { ...b, attributes: { ...b.attributes, [key]: value } } : b) }) })),

  deleteBackdrop: (id) => {
    snapshot()
    set(s => ({ board: touch({ ...s.board, backdrops: s.board.backdrops.filter(b => b.id !== id) }) }))
  },

  moveBackdropWithCards: (id, backdropPos, cardUpdates, backdropUpdates) => {
    snapshot()
    const cardMap = new Map(cardUpdates.map(u => [u.id, u.position]))
    const bdMap   = new Map(backdropUpdates.map(u => [u.id, u.position]))
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

  /*
   * loadBoard — centralises all migration logic for boards coming from
   * localStorage, JSON import, and template load/merge.
   *
   * Migrations:
   *  1. normalizeBackdrops — fix z-index layers (pre-hierarchy boards)
   *  2. migrateEntities    — 'Archived' status → 'Cut' (standardized set)
   *  3. migrateBackdropAttrs — same for backdrop attributes
   *  4. projectInfo absent → {}
   */
  loadBoard: (board) => set({
    board: {
      ...board,
      projectInfo: board.projectInfo ?? {},
      entities:  migrateEntities(board.entities ?? []),
      backdrops: migrateBackdropAttrs(normalizeBackdrops(board.backdrops ?? [])),
    },
  }),

  undo: () => {
    const prev = useHistoryStore.getState().undo(get().board)
    if (prev) set({ board: prev })
  },

  redo: () => {
    const next = useHistoryStore.getState().redo(get().board)
    if (next) set({ board: next })
  },
}))
