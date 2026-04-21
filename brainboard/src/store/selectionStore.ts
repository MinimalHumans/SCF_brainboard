import { create } from 'zustand'

/*
 * Selection store — kept separate from boardStore deliberately.
 *
 * Selection is transient UI state: it never persists, doesn't belong in
 * the board file format, and changes at high frequency (every click).
 * Separating it means boardStore mutations don't trigger re-renders in
 * components that only care about selection, and vice versa.
 *
 * Phase 4 extends this store with:
 *   - rubber-band selection rect (react-selecto)
 *   - multi-drag coordinate tracking
 */

interface SelectionStore {
  selectedIds: ReadonlySet<string>

  // Replace selection with a single item
  select: (id: string) => void

  // Add/remove from existing selection (shift-click)
  addToSelection:      (id: string) => void
  removeFromSelection: (id: string) => void

  // Replace selection with multiple items (rubber-band result)
  selectMany: (ids: string[]) => void

  clearSelection: () => void
  isSelected:     (id: string) => boolean
}

export const useSelectionStore = create<SelectionStore>((set, get) => ({
  selectedIds: new Set<string>(),

  select: (id) =>
    set({ selectedIds: new Set([id]) }),

  addToSelection: (id) =>
    set(s => ({ selectedIds: new Set([...s.selectedIds, id]) })),

  removeFromSelection: (id) =>
    set(s => {
      const next = new Set(s.selectedIds)
      next.delete(id)
      return { selectedIds: next }
    }),

  selectMany: (ids) =>
    set({ selectedIds: new Set(ids) }),

  clearSelection: () =>
    set({ selectedIds: new Set<string>() }),

  isSelected: (id) =>
    get().selectedIds.has(id),
}))
