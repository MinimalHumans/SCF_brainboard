import { create } from 'zustand'

/*
 * editorSignalStore
 * -----------------
 * A lightweight signal bus. Canvas increments closeSignal when the user
 * clicks empty canvas. Card and Backdrop components useEffect on this
 * value and call setIsEditing(false) when it changes.
 */
interface EditorSignalStore {
  closeSignal: number
  requestCloseAll: () => void
}

export const useEditorSignalStore = create<EditorSignalStore>(set => ({
  closeSignal:     0,
  requestCloseAll: () => set(s => ({ closeSignal: s.closeSignal + 1 })),
}))
