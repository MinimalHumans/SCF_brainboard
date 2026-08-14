import { useEffect, useRef, useCallback, useState } from 'react'
import { nanoid } from 'nanoid'
import { useBoardStore, makeBoard, touch } from '@/store/boardStore'
import { useLibraryStore, getStoredActiveBoardId, type BoardSummary } from '@/store/libraryStore'
import { getClientId, getClientLabel } from '@/lib/sync/clientIdentity'
import { toast } from '@/store/toastStore'
import { summaryOf } from '@/lib/boardSummary'
import { confirmDiscardIfDraft } from '@/lib/boardDraft'
import type { Board } from '@/types/board'
import {
  isOpfsSupported,
  readLegacyBoardFile,
  readBoardFileById, writeBoardFileById, writeBoardFileByIdVerified, deleteBoardFileById,
  readBoardIndex, writeBoardIndex, writeBoardIndexVerified,
} from '@/lib/opfs/opfsStorage'

// Pre-multi-board single-board key (still the no-OPFS fallback today).
const LEGACY_STORAGE_KEY = 'brainboard_v1'
const MIGRATED_KEY       = 'brainboard_migrated_v1'
const AUTOSAVE_DELAY     = 500

function parseBoard(raw: string): Board | null {
  try {
    const parsed = JSON.parse(raw) as Board
    if (parsed.schemaVersion === 1 && Array.isArray(parsed.cards)) return parsed
    return null
  } catch {
    return null
  }
}

function mostRecentlyUpdated(summaries: BoardSummary[]): BoardSummary {
  return [...summaries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

// The boards that are valid to auto-open/switch to: not a template, not in
// the trash. Everything that picks a board on the user's behalf (startup
// target, "next board" after a delete/trash) must go through this filter.
function selectableBoards(summaries: BoardSummary[]): BoardSummary[] {
  return summaries.filter(b => b.kind !== 'template' && !b.trashed)
}

/*
 * useBoardLibrary — owns loading/saving/switching between multiple boards.
 *
 * Multi-board support requires OPFS (one file per board under boards/, plus
 * an index.json cache of name/timestamps for the Boards modal list). If OPFS
 * isn't available in this browser, this hook falls back to exactly the old
 * single-board localStorage behaviour and reports
 * `canManageMultipleBoards: false` so the UI can hide/disable the actions
 * that don't apply (switch/create/duplicate/import/delete).
 *
 * Google Drive sync-state (per board, per provider) is a separate concern
 * owned by useDriveSync/syncStore — this hook only ever touches board
 * content and the local library index.
 */
export function useBoardLibrary() {
  const board     = useBoardStore(s => s.board)
  const loadBoard = useBoardStore(s => s.loadBoard)

  const setBoards       = useLibraryStore(s => s.setBoards)
  const upsertSummary   = useLibraryStore(s => s.upsertSummary)
  const removeSummary   = useLibraryStore(s => s.removeSummary)
  const activeBoardId   = useLibraryStore(s => s.activeBoardId)
  const setActiveBoardId = useLibraryStore(s => s.setActiveBoardId)
  const isDraft         = useLibraryStore(s => s.isDraft)
  const setIsDraft      = useLibraryStore(s => s.setIsDraft)

  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLoadedRef = useRef(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [canManageMultipleBoards, setCanManageMultipleBoards] = useState(true)
  // 'opfs' | 'localStorage' — which backend autosave/actions target. Starts
  // pointed at localStorage so an autosave firing before load-on-mount
  // resolves can't be lost.
  const backendRef = useRef<'opfs' | 'localStorage'>('localStorage')
  // Latest board, read synchronously by flushSave so a switch/delete right
  // after an edit doesn't race the debounce and lose that edit.
  const boardRef = useRef(board)
  boardRef.current = board

  const save = useCallback(async (b: Board) => {
    const json = JSON.stringify(b)
    try {
      if (backendRef.current === 'opfs') {
        await writeBoardFileById(b.boardId, json)
        upsertSummary(summaryOf(b))
      } else {
        localStorage.setItem(LEGACY_STORAGE_KEY, json)
      }
    } catch (err) {
      console.error('Autosave failed', err)
      toast.error("Couldn't save your board locally.")
    }
  }, [upsertSummary])

  const flushSave = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    // Drafts are never auto-persisted — only an explicit save (name field
    // blur, or the unsaved-changes modal) writes them. Without this guard,
    // switching away from a draft the user chose to discard would still
    // write it to disk right here, defeating "discard".
    if (useLibraryStore.getState().isDraft) return
    await save(boardRef.current)
  }, [save])

  // One-time self-heal for summaries persisted before cardCount/backdropCount
  // existed on BoardSummary — every returning user's existing boards have
  // this gap until each board is individually reopened/edited (autosave
  // recomputes the summary then). Refreshing them here means the Boards
  // list shows real counts immediately rather than a stale "0 cards" for
  // whichever boards nobody happens to revisit. Runs in the background,
  // after the initial load, so it never delays startup.
  const backfillMissingStats = useCallback((summaries: BoardSummary[]) => {
    const stale = summaries.filter(s => s.cardCount === undefined || s.backdropCount === undefined)
    if (stale.length === 0) return
    ;(async () => {
      for (const s of stale) {
        try {
          const raw = await readBoardFileById(s.boardId)
          const parsed = raw ? parseBoard(raw) : null
          if (parsed) upsertSummary(summaryOf(parsed))
        } catch (err) {
          console.error(`Failed to backfill stats for board "${s.boardId}"`, err)
        }
      }
    })()
  }, [upsertSummary])

  /* ── One-time migration into boards/{id}.json + index.json ────────────── */
  const migrateToMultiBoard = useCallback(async () => {
    const adopt = async (b: Board, raw: string, verified: boolean) => {
      if (verified) {
        await writeBoardFileByIdVerified(b.boardId, raw)
        await writeBoardIndexVerified([summaryOf(b)])
      } else {
        await writeBoardFileById(b.boardId, raw)
        await writeBoardIndex([summaryOf(b)])
      }
      setBoards([summaryOf(b)])
      setActiveBoardId(b.boardId)
      loadBoard(b)
    }

    // (a) legacy OPFS board.json — already durable storage, no read-back needed.
    const legacyOpfsRaw = await readLegacyBoardFile()
    const legacyOpfsBoard = legacyOpfsRaw ? parseBoard(legacyOpfsRaw) : null
    if (legacyOpfsBoard) {
      await adopt(legacyOpfsBoard, legacyOpfsRaw!, false)
      return
    }

    // (b) legacy pre-OPFS localStorage board — a silent failure moving this
    // would look like the user's board vanished, so this write is verified.
    const legacyLsRaw = localStorage.getItem(LEGACY_STORAGE_KEY)
    const legacyLsBoard = legacyLsRaw ? parseBoard(legacyLsRaw) : null
    if (legacyLsBoard) {
      try {
        await adopt(legacyLsBoard, legacyLsRaw!, true)
        localStorage.setItem(MIGRATED_KEY, 'true')
        // Deliberately NOT removing LEGACY_STORAGE_KEY — it stays in place
        // indefinitely as a passive backup.
      } catch (err) {
        console.error('OPFS migration failed, staying on localStorage', err)
        toast.error("Couldn't move your board to the new storage — still using the old one.")
        loadBoard(legacyLsBoard)
        setBoards([summaryOf(legacyLsBoard)])
        setActiveBoardId(legacyLsBoard.boardId)
        backendRef.current = 'localStorage'
        setCanManageMultipleBoards(false)
      }
      return
    }

    // (c) fresh install — nothing to migrate.
    const fresh = makeBoard()
    await adopt(fresh, JSON.stringify(fresh), false)
  }, [loadBoard, setBoards, setActiveBoardId])

  // Load on mount.
  useEffect(() => {
    (async () => {
      if (!isOpfsSupported()) {
        const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
        const parsed = raw ? parseBoard(raw) : null
        const b = parsed ?? makeBoard()
        loadBoard(b)
        setBoards([summaryOf(b)])
        setActiveBoardId(b.boardId)
        backendRef.current = 'localStorage'
        setCanManageMultipleBoards(false)
        isLoadedRef.current = true
        setIsLoaded(true)
        return
      }

      try {
        const index = await readBoardIndex()
        if (index && index.length > 0) {
          setBoards(index)
          backfillMissingStats(index)
          const selectable = selectableBoards(index)
          const stored = getStoredActiveBoardId()
          // Never auto-open a trashed board (nor a template) — if the last
          // active board got trashed (possibly from another device), fall
          // back to the most recent live one; if *everything* is trashed or
          // a template, start a fresh board rather than resurrecting one.
          const target = selectable.length > 0
            ? (stored && selectable.find(b => b.boardId === stored)) ?? mostRecentlyUpdated(selectable)
            : null
          const raw = target ? await readBoardFileById(target.boardId) : null
          const parsed = raw ? parseBoard(raw) : null
          if (target && parsed) {
            loadBoard(parsed)
            setActiveBoardId(target.boardId)
          } else {
            if (target) {
              // Index says this board exists but its file is missing/corrupt.
              console.error(`Board file for "${target.boardId}" is missing or corrupt — dropping it from the library`)
              removeSummary(target.boardId)
            }
            // Start a fresh *draft*, not a written board — persisting an
            // untouched "Untitled Board" would add a junk entry on every
            // launch while the library has nothing openable (e.g.
            // everything sits in the trash). See activateNextBoard.
            const fresh = makeBoard()
            setActiveBoardId(fresh.boardId)
            loadBoard(fresh)
            setIsDraft(true)
          }
          backendRef.current = 'opfs'
        } else {
          await migrateToMultiBoard()
          backendRef.current = 'opfs'
        }
      } catch (err) {
        console.error('OPFS board load failed, falling back to localStorage', err)
        const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
        const parsed = raw ? parseBoard(raw) : null
        const b = parsed ?? makeBoard()
        loadBoard(b)
        setBoards([summaryOf(b)])
        setActiveBoardId(b.boardId)
        backendRef.current = 'localStorage'
        setCanManageMultipleBoards(false)
      } finally {
        isLoadedRef.current = true
        setIsLoaded(true)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autosave. Suppressed entirely while the active board is a draft — see
  // flushSave above for why (the debounce timer would otherwise silently
  // persist a board the user hasn't earned a name/save for yet).
  useEffect(() => {
    if (!isLoadedRef.current || isDraft) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { save(board) }, AUTOSAVE_DELAY)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [board, save, isDraft])

  /* ── Library actions (no-ops with a toast if OPFS isn't available) ────── */

  const requireMultiBoard = useCallback((): boolean => {
    if (backendRef.current === 'opfs') return true
    toast.error('Multiple boards need a browser with local file-system storage (OPFS) support.')
    return false
  }, [])

  const switchBoard = useCallback(async (targetId: string): Promise<boolean> => {
    if (targetId === activeBoardId || !requireMultiBoard()) return false
    if (await confirmDiscardIfDraft() === 'cancel') return false
    await flushSave()
    const raw = await readBoardFileById(targetId)
    const parsed = raw ? parseBoard(raw) : null
    if (!parsed) { toast.error("Couldn't open that board — its file is missing or corrupt."); return false }
    loadBoard(parsed)
    setActiveBoardId(targetId)
    setIsDraft(false)
    return true
  }, [activeBoardId, requireMultiBoard, flushSave, loadBoard, setActiveBoardId, setIsDraft])

  /*
   * createBoard — starts a blank board as a draft: loaded into the editor
   * and made active, but not written to disk or added to the Boards list
   * yet. It only becomes a real file once it has actual changes AND the
   * user has set/confirmed a name (see src/lib/boardDraft.ts) — an
   * untouched "Untitled Board" someone opened and immediately abandoned
   * should never leave a phantom entry behind.
   */
  const createBoard = useCallback(async (): Promise<boolean> => {
    if (!requireMultiBoard()) return false
    if (await confirmDiscardIfDraft() === 'cancel') return false
    await flushSave()
    const fresh = makeBoard()
    loadBoard(fresh)
    setActiveBoardId(fresh.boardId)
    setIsDraft(true)
    return true
  }, [requireMultiBoard, flushSave, setActiveBoardId, loadBoard, setIsDraft])

  /*
   * adoptBoard — used whenever some other flow (templates today) hands us a
   * fully-formed Board with its own fresh boardId and wants it to become the
   * new active board. Anything that swaps useBoardStore's board out for one
   * with a different boardId MUST go through here (or createBoard/switchBoard)
   * rather than calling loadBoard() directly — loadBoard() alone updates the
   * live editor but leaves libraryStore.activeBoardId pointing at the old
   * board, so the Boards modal's "current" tag and this board's autosave
   * target drift out of sync with what's actually on screen.
   *
   * Like createBoard, this starts the adopted board as an unsaved draft —
   * see the comment there. Callers (template "New board") are expected to
   * have already reset the board's syncMeta so it starts at version 0.
   */
  const adoptBoard = useCallback(async (board: Board): Promise<boolean> => {
    if (!requireMultiBoard()) return false
    if (await confirmDiscardIfDraft() === 'cancel') return false
    await flushSave()
    loadBoard(board)
    setActiveBoardId(board.boardId)
    setIsDraft(true)
    return true
  }, [requireMultiBoard, flushSave, setActiveBoardId, loadBoard, setIsDraft])

  const duplicateBoard = useCallback(async (boardId: string) => {
    if (!requireMultiBoard()) return
    const isActive = boardId === activeBoardId
    if (isActive) await flushSave()
    const raw = isActive ? JSON.stringify(boardRef.current) : await readBoardFileById(boardId)
    const source = raw ? parseBoard(raw) : null
    if (!source) { toast.error("Couldn't duplicate — board file is missing or corrupt."); return }
    const now = new Date().toISOString()
    // Fresh boardId + reset syncMeta/no linkage: a duplicate is a new,
    // independent file that must never silently write into the source's
    // Drive file.
    const copy: Board = {
      ...source,
      boardId: nanoid(),
      name: `${source.name} copy`,
      createdAt: now,
      updatedAt: now,
      syncMeta: { version: 1, clientId: getClientId(), clientLabel: getClientLabel(), updatedAt: now },
    }
    await writeBoardFileById(copy.boardId, JSON.stringify(copy))
    upsertSummary(summaryOf(copy))
    toast.success(`Duplicated "${source.name}".`)
  }, [activeBoardId, requireMultiBoard, flushSave, upsertSummary])

  // saveAsTemplate — snapshots the *currently active* board into a new
  // boardId tagged kind:'template'. It's a real board on disk (so it links
  // and syncs to Drive through the exact same pipeline as everything else in
  // the library — see useDriveSync.syncAllBoards, which just iterates every
  // summary regardless of kind), but the Boards modal filters it out of the
  // Saved Boards list and into the Templates tab by that tag.
  const saveAsTemplate = useCallback(async (name: string): Promise<boolean> => {
    if (!requireMultiBoard()) return false
    const now = new Date().toISOString()
    const template: Board = {
      ...boardRef.current,
      boardId:   nanoid(),
      name,
      kind:      'template',
      createdAt: now,
      updatedAt: now,
      syncMeta:  { version: 1, clientId: getClientId(), clientLabel: getClientLabel(), updatedAt: now },
    }
    await writeBoardFileById(template.boardId, JSON.stringify(template))
    upsertSummary(summaryOf(template))
    return true
  }, [requireMultiBoard, upsertSummary])

  const renameBoard = useCallback(async (boardId: string, name: string) => {
    if (boardId === activeBoardId) {
      useBoardStore.getState().setBoardName(name)
      return
    }
    if (!requireMultiBoard()) return
    const raw = await readBoardFileById(boardId)
    const parsed = raw ? parseBoard(raw) : null
    if (!parsed) { toast.error("Couldn't rename — board file is missing or corrupt."); return }
    const updated = { ...parsed, name, updatedAt: new Date().toISOString() }
    await writeBoardFileById(boardId, JSON.stringify(updated))
    upsertSummary(summaryOf(updated))
  }, [activeBoardId, requireMultiBoard, upsertSummary])

  // Loads the most recently updated live (non-trashed, non-template) board,
  // excluding `excludeId`, or a fresh board if none remain — shared by
  // deleteBoard/trashBoard when they displace the active board, and by the
  // trashed-active-board effect below.
  const activateNextBoard = useCallback(async (excludeId: string) => {
    const remaining = selectableBoards(useLibraryStore.getState().boards).filter(b => b.boardId !== excludeId)
    if (remaining.length > 0) {
      const next = mostRecentlyUpdated(remaining)
      const raw = await readBoardFileById(next.boardId)
      const parsed = raw ? parseBoard(raw) : null
      if (parsed) {
        loadBoard(parsed)
        setActiveBoardId(next.boardId)
        setIsDraft(false)
        return
      }
    }
    // No live boards left — start a fresh *draft* (like createBoard), not a
    // written board file. Persisting an untouched "Untitled Board" here
    // would mint a real, deletable row every time the last board is
    // trashed — an endless trash-the-replacement loop that fills the trash
    // with empty boards. As a draft it has no row and only becomes real
    // once the user actually changes and names it (see lib/boardDraft.ts).
    const fresh = makeBoard()
    loadBoard(fresh)
    setActiveBoardId(fresh.boardId)
    setIsDraft(true)
  }, [loadBoard, setActiveBoardId, setIsDraft])

  /*
   * trashBoard — the reversible "delete": flips trashed/trashedAt on the
   * board's own content (via touch(), so it version-bumps and syncs to
   * Drive like any other edit) and hides it from every normal list. No
   * confirmation needed anywhere that calls this — restore undoes it.
   */
  const trashBoard = useCallback(async (boardId: string) => {
    if (!requireMultiBoard()) return
    const wasActive = boardId === activeBoardId
    if (wasActive) await flushSave()
    const raw = wasActive ? JSON.stringify(boardRef.current) : await readBoardFileById(boardId)
    const parsed = raw ? parseBoard(raw) : null
    if (!parsed) { toast.error("Couldn't move that board to the trash — its file is missing or corrupt."); return }
    const updated = touch({ ...parsed, trashed: true, trashedAt: new Date().toISOString() })
    await writeBoardFileById(boardId, JSON.stringify(updated))
    upsertSummary(summaryOf(updated))
    if (wasActive) await activateNextBoard(boardId)
  }, [activeBoardId, requireMultiBoard, flushSave, upsertSummary, activateNextBoard])

  const restoreBoard = useCallback(async (boardId: string) => {
    if (!requireMultiBoard()) return
    const raw = await readBoardFileById(boardId)
    const parsed = raw ? parseBoard(raw) : null
    if (!parsed) { toast.error("Couldn't restore — board file is missing or corrupt."); return }
    // undefined (not false/'') so JSON.stringify drops the keys entirely —
    // a restored board is byte-identical to one that was never trashed.
    const updated = touch({ ...parsed, trashed: undefined, trashedAt: undefined })
    await writeBoardFileById(boardId, JSON.stringify(updated))
    upsertSummary(summaryOf(updated))
  }, [requireMultiBoard, upsertSummary])

  // Permanently deletes the local file + index entry — the only
  // irreversible action, reached from the Trash view ("delete forever" /
  // "delete all") and the retention sweep. Callers that also want the
  // linked Drive copy removed must additionally call useDriveSync's
  // deleteRemoteForBoard before/after this — this hook doesn't know about
  // sync providers.
  const deleteBoard = useCallback(async (boardId: string) => {
    if (!requireMultiBoard()) return
    const wasActive = boardId === activeBoardId
    await deleteBoardFileById(boardId)
    removeSummary(boardId)
    if (wasActive) await activateNextBoard(boardId)
  }, [activeBoardId, requireMultiBoard, removeSummary, activateNextBoard])

  // If the *active* board becomes trashed under us — a sync pull applied a
  // trash performed on another device — move the editor off it; the canvas
  // must never be showing a trashed board. flushSave first: a pull only
  // updates the in-memory store and relies on the debounced autosave to
  // persist, but switching boards cancels that timer — without the flush,
  // the trashed flag would never reach this device's file or index.
  const activeBoardTrashed = board.trashed === true
  useEffect(() => {
    if (!isLoaded || !activeBoardTrashed || backendRef.current !== 'opfs') return
    ;(async () => {
      await flushSave()
      await activateNextBoard(boardRef.current.boardId)
    })()
  }, [isLoaded, activeBoardTrashed, activateNextBoard, flushSave])

  // Shared by the file-picker (importBoard) and drag-and-drop import — both
  // just need to hand off a File, everything past that is identical.
  const importBoardFile = useCallback((file: File) => {
    if (!requireMultiBoard()) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as Board
        if (parsed.schemaVersion !== 1) {
          toast.error(`Unknown schema version: ${(parsed as { schemaVersion?: unknown }).schemaVersion}`)
          return
        }
        if (!Array.isArray(parsed.cards)) {
          toast.error('Invalid board file.')
          return
        }
        if (await confirmDiscardIfDraft() === 'cancel') return
        await flushSave()
        // Always a fresh boardId/entry — never overwrites an existing
        // library entry, even if it's an export of a board already here.
        const imported: Board = { ...parsed, boardId: nanoid() }
        await writeBoardFileById(imported.boardId, JSON.stringify(imported))
        upsertSummary(summaryOf(imported))
        setActiveBoardId(imported.boardId)
        setIsDraft(false)
        loadBoard(imported)
        toast.success(`Imported "${imported.name}"`)
      } catch {
        toast.error('Could not parse board file.')
      }
    }
    reader.readAsText(file)
  }, [requireMultiBoard, flushSave, upsertSummary, setActiveBoardId, setIsDraft, loadBoard])

  const importBoard = useCallback(() => {
    if (!requireMultiBoard()) return
    const input    = document.createElement('input')
    input.type     = 'file'
    input.accept   = '.json,.brainboard.json,.scriptyard.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) importBoardFile(file)
    }
    input.click()
  }, [requireMultiBoard, importBoardFile])

  // Reads a board's full content regardless of whether it's the active one —
  // used by the Export modal, which needs cards/backdrops/name upfront for
  // whichever board the user picked (not just the one currently loaded into
  // the editor).
  const getBoardData = useCallback(async (boardId: string): Promise<Board | null> => {
    if (boardId === activeBoardId) return boardRef.current
    const raw = await readBoardFileById(boardId)
    return raw ? parseBoard(raw) : null
  }, [activeBoardId])

  return {
    isLoaded,
    canManageMultipleBoards,
    getBoardData,
    importBoard,
    importBoardFile,
    switchBoard,
    createBoard,
    adoptBoard,
    duplicateBoard,
    saveAsTemplate,
    renameBoard,
    trashBoard,
    restoreBoard,
    deleteBoard,
  }
}
