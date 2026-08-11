import { useBoardStore } from '@/store/boardStore'
import { useLibraryStore } from '@/store/libraryStore'
import { writeBoardFileById } from '@/lib/opfs/opfsStorage'
import { summaryOf } from '@/lib/boardSummary'
import { toast } from '@/store/toastStore'

/*
 * boardDraft — the save/guard logic for "fresh" boards (a blank New Board,
 * or a template loaded as a new board) that haven't been written to disk
 * yet. Plain functions rather than hook state so any component can call
 * them directly (ProjectInfoPopover's name field, the unsaved-changes
 * modal) without threading useBoardLibrary's instance through props —
 * everything they need is already in useBoardStore/useLibraryStore.
 *
 * "Has this draft actually changed" is read off board.syncMeta.version
 * rather than tracked separately: every board-mutating store action calls
 * touch() (see boardStore.ts) except setViewport, so panning/zooming a
 * fresh board never counts as a change, while adding/moving/renaming a
 * card, backdrop, or the board's own name does — a fresh board always
 * starts at version 0 (see loadBoard), so "changed" is just version > 0.
 */
function hasDraftChanges(): boolean {
  const board = useBoardStore.getState().board
  return (board.syncMeta?.version ?? 0) > 0
}

// Writes the current draft board to disk for the first time and registers
// it in the library index. No-ops (returns false) if there's no draft, or
// the draft hasn't actually changed yet — callers don't need to check
// either condition themselves first. Never throws — a write failure leaves
// isDraft untouched (so the board stays a recoverable draft, and callers
// awaiting this in a promise chain, e.g. the unsaved-changes modal, always
// get to move on rather than hang).
export async function attemptSaveDraft(): Promise<boolean> {
  const lib = useLibraryStore.getState()
  if (!lib.isDraft || !hasDraftChanges()) return false

  const board = useBoardStore.getState().board
  try {
    await writeBoardFileById(board.boardId, JSON.stringify(board))
  } catch (err) {
    console.error('Failed to save new board', err)
    toast.error("Couldn't save this board locally.")
    return false
  }
  lib.upsertSummary(summaryOf(board))
  lib.setActiveBoardId(board.boardId)
  lib.setIsDraft(false)
  toast.success(`New board saved: ${board.name}`)
  return true
}

// Call before any action that would replace the currently loaded board
// (create/switch/adopt-template/import). Resolves 'proceed' immediately
// when there's nothing at risk (not a draft, or a draft with no changes
// yet); otherwise shows the unsaved-changes modal and waits for the user.
export function confirmDiscardIfDraft(): Promise<'proceed' | 'cancel'> {
  const lib = useLibraryStore.getState()
  if (!lib.isDraft || !hasDraftChanges()) return Promise.resolve('proceed')

  const board = useBoardStore.getState().board

  return new Promise(resolve => {
    useLibraryStore.getState().setUnsavedGuard({
      boardName:     board.name,
      cardCount:     board.cards?.length ?? 0,
      backdropCount: board.backdrops?.length ?? 0,
      onSave: async (name: string) => {
        useBoardStore.getState().setBoardName(name)
        const ok = await attemptSaveDraft()
        // A write failure already showed its own toast — leave the modal
        // open so the user can retry rather than silently discarding.
        if (!ok) return
        useLibraryStore.getState().setUnsavedGuard(null)
        resolve('proceed')
      },
      // Deliberately does NOT touch isDraft — leaving it true means the
      // caller's own flushSave() (which skips drafts) won't persist the
      // content the user just chose to throw away. Whatever loads next
      // (loadBoard for a real board, or a fresh draft) replaces it and
      // sets isDraft correctly on its own.
      onDiscard: () => {
        useLibraryStore.getState().setUnsavedGuard(null)
        resolve('proceed')
      },
      onCancel: () => {
        useLibraryStore.getState().setUnsavedGuard(null)
        resolve('cancel')
      },
    })
  })
}
