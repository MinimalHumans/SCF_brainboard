import { create } from 'zustand'
import type { Board } from '@/types/board'

/*
 * historyStore — undo/redo via board snapshots.
 * Limit: 50 entries. Viewport changes are not tracked.
 */
const MAX_HISTORY = 50

interface HistoryStore {
  past:   Board[]
  future: Board[]
  push:   (board: Board) => void
  undo:   (current: Board) => Board | null
  redo:   (current: Board) => Board | null
  canUndo: () => boolean
  canRedo: () => boolean
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  past:   [],
  future: [],

  push: (board) => set(s => ({
    past:   [...s.past.slice(-(MAX_HISTORY - 1)), board],
    future: [],
  })),

  undo: (current) => {
    const { past } = get()
    if (past.length === 0) return null
    const prev = past[past.length - 1]
    set(s => ({
      past:   s.past.slice(0, -1),
      future: [current, ...s.future.slice(0, MAX_HISTORY - 1)],
    }))
    return prev
  },

  redo: (current) => {
    const { future } = get()
    if (future.length === 0) return null
    const next = future[0]
    set(s => ({
      past:   [...s.past.slice(-(MAX_HISTORY - 1)), current],
      future: s.future.slice(1),
    }))
    return next
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}))
