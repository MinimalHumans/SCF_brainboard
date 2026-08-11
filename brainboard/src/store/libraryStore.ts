import { create } from 'zustand'
import { readBoardIndex, writeBoardIndex, type BoardSummary } from '@/lib/opfs/opfsStorage'

export type { BoardSummary }

const ACTIVE_BOARD_KEY = 'brainboard_active_board_id'

export function getStoredActiveBoardId(): string | null {
  return localStorage.getItem(ACTIVE_BOARD_KEY)
}

function persistActiveBoardId(id: string): void {
  localStorage.setItem(ACTIVE_BOARD_KEY, id)
}

// Shown when an unsaved draft board (see `isDraft`) would be discarded by
// switching away — createBoard/adoptBoard/switchBoard/importBoard populate
// this and await the user's choice before proceeding. The three callbacks
// are the modal's entire contract; nothing else reads/writes this shape.
export interface UnsavedGuardRequest {
  boardName:     string
  cardCount:     number
  backdropCount: number
  onSave:        (name: string) => void
  onDiscard:     () => void
  onCancel:      () => void
}

interface LibraryStore {
  boards:        BoardSummary[]
  activeBoardId: string | null
  hydrated:      boolean
  hydrate:       () => Promise<void>
  // Replaces the whole in-memory list (used after migration / repair scans)
  // and persists it as the index.
  setBoards:     (boards: BoardSummary[]) => void
  upsertSummary: (summary: BoardSummary) => void
  removeSummary: (boardId: string) => void
  setActiveBoardId: (id: string) => void
  // True while the active board is a fresh "New Board" / template-loaded
  // draft that has never been written to disk — see src/lib/boardDraft.ts,
  // which owns the actual save/guard logic gated on this flag.
  isDraft:       boolean
  setIsDraft:    (v: boolean) => void
  unsavedGuard:  UnsavedGuardRequest | null
  setUnsavedGuard: (v: UnsavedGuardRequest | null) => void
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  boards: [],
  activeBoardId: null,
  hydrated: false,
  isDraft: false,
  unsavedGuard: null,

  hydrate: async () => {
    try {
      const index = await readBoardIndex()
      set({ boards: index ?? [], hydrated: true })
    } catch (err) {
      console.error('Failed to read board index', err)
      set({ hydrated: true })
    }
  },

  setBoards: (boards) => {
    set({ boards })
    writeBoardIndex(boards).catch(err => console.error('Failed to persist board index', err))
  },

  upsertSummary: (summary) => {
    const boards = get().boards
    const idx = boards.findIndex(b => b.boardId === summary.boardId)
    const next = idx === -1
      ? [...boards, summary]
      : boards.map(b => b.boardId === summary.boardId ? summary : b)
    set({ boards: next })
    writeBoardIndex(next).catch(err => console.error('Failed to persist board index', err))
  },

  removeSummary: (boardId) => {
    const next = get().boards.filter(b => b.boardId !== boardId)
    set({ boards: next })
    writeBoardIndex(next).catch(err => console.error('Failed to persist board index', err))
  },

  setActiveBoardId: (id) => {
    persistActiveBoardId(id)
    set({ activeBoardId: id })
  },

  setIsDraft: (v) => set({ isDraft: v }),
  setUnsavedGuard: (v) => set({ unsavedGuard: v }),
}))
