import { useEffect, useRef, useCallback, useState } from 'react'
import { nanoid } from 'nanoid'
import { useBoardStore, makeBoard } from '@/store/boardStore'
import { useLibraryStore, getStoredActiveBoardId, type BoardSummary } from '@/store/libraryStore'
import { getClientId, getClientLabel } from '@/lib/sync/clientIdentity'
import { toast } from '@/store/toastStore'
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

function summaryOf(board: Board): BoardSummary {
  return { boardId: board.boardId, name: board.name, createdAt: board.createdAt, updatedAt: board.updatedAt }
}

function mostRecentlyUpdated(summaries: BoardSummary[]): BoardSummary {
  return [...summaries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

function downloadBoardJson(board: Board): void {
  const json     = JSON.stringify(board, null, 2)
  const blob     = new Blob([json], { type: 'application/json' })
  const url      = URL.createObjectURL(blob)
  const a        = document.createElement('a')
  const safeName = board.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'board'
  a.href         = url
  a.download     = `${safeName}.scriptyard.json`
  a.click()
  URL.revokeObjectURL(url)
  toast.success(`Exported "${board.name}"`)
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
    await save(boardRef.current)
  }, [save])

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
          const stored = getStoredActiveBoardId()
          const target = (stored && index.find(b => b.boardId === stored)) ?? mostRecentlyUpdated(index)
          const raw = await readBoardFileById(target.boardId)
          const parsed = raw ? parseBoard(raw) : null
          if (parsed) {
            loadBoard(parsed)
            setActiveBoardId(target.boardId)
          } else {
            // Index says this board exists but its file is missing/corrupt.
            console.error(`Board file for "${target.boardId}" is missing or corrupt — dropping it from the library`)
            removeSummary(target.boardId)
            const fresh = makeBoard()
            await writeBoardFileById(fresh.boardId, JSON.stringify(fresh))
            upsertSummary(summaryOf(fresh))
            setActiveBoardId(fresh.boardId)
            loadBoard(fresh)
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

  // Autosave.
  useEffect(() => {
    if (!isLoadedRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { save(board) }, AUTOSAVE_DELAY)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [board, save])

  /* ── Library actions (no-ops with a toast if OPFS isn't available) ────── */

  const requireMultiBoard = useCallback((): boolean => {
    if (backendRef.current === 'opfs') return true
    toast.error('Multiple boards need a browser with local file-system storage (OPFS) support.')
    return false
  }, [])

  const switchBoard = useCallback(async (targetId: string) => {
    if (targetId === activeBoardId || !requireMultiBoard()) return
    await flushSave()
    const raw = await readBoardFileById(targetId)
    const parsed = raw ? parseBoard(raw) : null
    if (!parsed) { toast.error("Couldn't open that board — its file is missing or corrupt."); return }
    loadBoard(parsed)
    setActiveBoardId(targetId)
  }, [activeBoardId, requireMultiBoard, flushSave, loadBoard, setActiveBoardId])

  const createBoard = useCallback(async () => {
    if (!requireMultiBoard()) return
    await flushSave()
    const fresh = makeBoard()
    await writeBoardFileById(fresh.boardId, JSON.stringify(fresh))
    upsertSummary(summaryOf(fresh))
    setActiveBoardId(fresh.boardId)
    loadBoard(fresh)
    toast.success('New board created.')
  }, [requireMultiBoard, flushSave, upsertSummary, setActiveBoardId, loadBoard])

  /*
   * adoptBoard — used whenever some other flow (templates today) hands us a
   * fully-formed Board with its own fresh boardId and wants it to become the
   * new active board. Anything that swaps useBoardStore's board out for one
   * with a different boardId MUST go through here (or createBoard/switchBoard)
   * rather than calling loadBoard() directly — loadBoard() alone updates the
   * live editor but leaves libraryStore.activeBoardId pointing at the old
   * board, so the Boards modal's "current" tag and this board's autosave
   * target drift out of sync with what's actually on screen.
   */
  const adoptBoard = useCallback(async (board: Board) => {
    if (!requireMultiBoard()) return
    await flushSave()
    await writeBoardFileById(board.boardId, JSON.stringify(board))
    upsertSummary(summaryOf(board))
    setActiveBoardId(board.boardId)
    loadBoard(board)
  }, [requireMultiBoard, flushSave, upsertSummary, setActiveBoardId, loadBoard])

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

  // Deletes the local file + index entry only. Callers that also want the
  // linked Drive copy removed (per the "always delete both" policy) must
  // additionally call useDriveSync's per-board delete before/after this —
  // this hook doesn't know about sync providers.
  const deleteBoard = useCallback(async (boardId: string) => {
    if (!requireMultiBoard()) return
    const wasActive = boardId === activeBoardId
    await deleteBoardFileById(boardId)
    removeSummary(boardId)

    if (!wasActive) return

    const remaining = useLibraryStore.getState().boards.filter(b => b.boardId !== boardId)
    if (remaining.length > 0) {
      const next = mostRecentlyUpdated(remaining)
      const raw = await readBoardFileById(next.boardId)
      const parsed = raw ? parseBoard(raw) : null
      if (parsed) {
        loadBoard(parsed)
        setActiveBoardId(next.boardId)
        return
      }
    }
    const fresh = makeBoard()
    await writeBoardFileById(fresh.boardId, JSON.stringify(fresh))
    upsertSummary(summaryOf(fresh))
    setActiveBoardId(fresh.boardId)
    loadBoard(fresh)
  }, [activeBoardId, requireMultiBoard, removeSummary, loadBoard, setActiveBoardId, upsertSummary])

  const importBoard = useCallback(() => {
    if (!requireMultiBoard()) return
    const input    = document.createElement('input')
    input.type     = 'file'
    input.accept   = '.json,.brainboard.json,.scriptyard.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
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
          await flushSave()
          // Always a fresh boardId/entry — never overwrites an existing
          // library entry, even if it's an export of a board already here.
          const imported: Board = { ...parsed, boardId: nanoid() }
          await writeBoardFileById(imported.boardId, JSON.stringify(imported))
          upsertSummary(summaryOf(imported))
          setActiveBoardId(imported.boardId)
          loadBoard(imported)
          toast.success(`Imported "${imported.name}"`)
        } catch {
          toast.error('Could not parse board file.')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }, [requireMultiBoard, flushSave, upsertSummary, setActiveBoardId, loadBoard])

  const exportBoard = useCallback(() => {
    downloadBoardJson(board)
  }, [board])

  const exportBoardById = useCallback(async (boardId: string) => {
    if (boardId === activeBoardId) { exportBoard(); return }
    const raw = await readBoardFileById(boardId)
    const parsed = raw ? parseBoard(raw) : null
    if (!parsed) { toast.error("Couldn't export — board file is missing or corrupt."); return }
    downloadBoardJson(parsed)
  }, [activeBoardId, exportBoard])

  return {
    isLoaded,
    canManageMultipleBoards,
    exportBoard,
    exportBoardById,
    importBoard,
    switchBoard,
    createBoard,
    adoptBoard,
    duplicateBoard,
    renameBoard,
    deleteBoard,
  }
}
