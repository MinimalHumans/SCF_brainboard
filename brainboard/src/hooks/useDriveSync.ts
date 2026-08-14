import { useCallback, useEffect, useRef } from 'react'
import { useBoardStore, makeBoard } from '@/store/boardStore'
import { useLibraryStore } from '@/store/libraryStore'
import { getProviderState, isAccountLinked, useSyncStore } from '@/store/syncStore'
import { toast } from '@/store/toastStore'
import type { Board } from '@/types/board'
import { googleDriveProvider } from '@/lib/sync/googleDriveProvider'
import { deleteFile, findFileByName } from '@/lib/sync/googleDriveApi'
import { clearCachedToken, getValidAccessToken, requestAccessToken, revokeToken } from '@/lib/sync/googleAuth'
import {
  reconcile,
  resolveConflictCancel,
  resolveConflictKeepLocalAsCopy,
  resolveConflictOverwriteLocal,
  resolveDeletionIgnore,
  resolveDeletionReupload,
  syncableContent,
  type ReconcileResult,
} from '@/lib/sync/syncEngine'
import { hashContent } from '@/lib/sync/hash'
import { makeInitialProviderState } from '@/lib/sync/types'
import {
  fetchAllManifests, mergeManifests, removeOwnManifestEntry, upsertOwnManifestEntry,
  type DriveManifestEntry,
} from '@/lib/sync/driveManifest'
import { getClientId, getClientLabel } from '@/lib/sync/clientIdentity'
import { reconcileTrashSettings } from '@/lib/sync/trashSettingsSync'
import { useTrashStore } from '@/store/trashStore'
import { readBoardFileById, writeBoardFileById } from '@/lib/opfs/opfsStorage'

const PROVIDER_ID = 'google-drive'
const PUSH_DEBOUNCE_MS = 3000

function summaryOf(board: Board) {
  // Carries `kind` through so a template pulled/pushed via Drive sync stays
  // tagged as a template locally too (see types/board.ts) — otherwise it'd
  // resurface in the Saved Boards list instead of Templates. Same for the
  // trashed flags: a board trashed on another device must land here already
  // hidden, not pop back into the Saved Boards list.
  return {
    boardId: board.boardId, name: board.name, createdAt: board.createdAt, updatedAt: board.updatedAt,
    kind: board.kind, trashed: board.trashed, trashedAt: board.trashedAt,
  }
}

/*
 * useDriveSync — board-aware Google Drive sync.
 *
 * Splits two concerns that used to be conflated in the single-board era:
 *  - Account-level: is this browser authorized against a Google account at
 *    all (`accountLinked` / connectAccount / disconnectAccount).
 *  - Board-level: is a *specific* board's file linked+syncing
 *    (`linkBoard(boardId)` / `unlinkBoard(boardId)`), independent of other
 *    boards and independent of the account being connected right now.
 *
 * Sync is a background service, not a manual per-board toggle: once the
 * account is connected, `syncAllBoards()` links/reconciles every local
 * board and pulls in anything discovered via another client's manifest —
 * triggered on connect, once per session on mount, and whenever the Boards
 * modal opens. The *active* board additionally gets live push-on-change
 * (debounced) and focus/visibility-triggered checks, since it's the one
 * board actually being edited right now.
 */
export function useDriveSync(boardLoaded: boolean) {
  const board          = useBoardStore(s => s.board)
  const loadBoard       = useBoardStore(s => s.loadBoard)
  const activeBoardId   = useLibraryStore(s => s.activeBoardId)

  const hydrate          = useSyncStore(s => s.hydrate)
  const syncHydrated     = useSyncStore(s => s.hydrated)
  const setAccountLinked = useSyncStore(s => s.setAccountLinked)
  const setProviderState = useSyncStore(s => s.setProviderState)
  const setConflict          = useSyncStore(s => s.setConflict)
  const setDeletionConflict  = useSyncStore(s => s.setDeletionConflict)

  const accountLinked = useSyncStore(s => s.accounts[PROVIDER_ID] === true)
  // Selector returns a stable reference (the stored object, or undefined) —
  // the makeInitialProviderState() fallback happens outside the selector so
  // it doesn't mint a fresh object every call (that broke useSyncExternalStore's
  // equality check and caused an infinite render loop).
  const rawProviderState = useSyncStore(s => (activeBoardId ? s.boards[activeBoardId]?.[PROVIDER_ID] : undefined))
  const providerState = rawProviderState ?? makeInitialProviderState()
  const conflict = useSyncStore(s => (activeBoardId ? s.conflicts[activeBoardId] : undefined) ?? null)
  const deletionConflict = useSyncStore(s => (activeBoardId ? s.deletionConflicts[activeBoardId] : undefined) ?? null)
  // Total boards currently flagged, active or not — lets the conflict modal
  // offer "apply to all N" instead of forcing one-at-a-time resolution.
  const conflictCount = useSyncStore(s => Object.keys(s.conflicts).length)

  const inFlightRef  = useRef(false)
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncAllInFlightRef = useRef(false)
  const didAutoSyncAllRef  = useRef(false)

  // Hydrate persisted sync bookkeeping from OPFS once the board library has
  // finished loading/migrating (it determines the boardId a pre-multi-board
  // sync-state file should attach to — reading before that would race it).
  useEffect(() => {
    if (!boardLoaded || !activeBoardId) return
    hydrate(activeBoardId)
  }, [boardLoaded, activeBoardId, hydrate])

  // Startup sanitization for the offline permanent-deletion log: entries are
  // only legitimate while the account stays linked (queued during a passive
  // outage). If we come up disconnected, anything still queued references a
  // severed account — replaying it on a future reconnect would delete Drive
  // copies the reconnect is supposed to restore. Active disconnect already
  // clears the queue; this catches states persisted around that (or by
  // older builds).
  const trashHydrated = useTrashStore(s => s.hydrated)
  useEffect(() => {
    if (!syncHydrated || !trashHydrated) return
    if (!isAccountLinked(PROVIDER_ID)) useTrashStore.getState().clearPendingRemoteDeletions()
  }, [syncHydrated, trashHydrated])

  const upsertManifestForBoard = useCallback(async (boardId: string, b: Board, remoteFileId: string) => {
    try {
      const token = await getValidAccessToken()
      await upsertOwnManifestEntry(token, getClientId(), getClientLabel(), {
        boardId, name: b.name, fileId: remoteFileId, updatedAt: b.updatedAt, version: b.syncMeta?.version ?? null,
      })
    } catch (err) {
      // Non-fatal — discovery on other devices just won't see this board
      // from this client until the next successful push.
      console.error('Failed to update Drive manifest', err)
    }
  }, [])

  // Applies a reconcile() outcome. `applyToStore` is true only for the
  // active board (whose content lives in useBoardStore); other boards get
  // written straight to their OPFS file instead.
  const handleReconcileResult = useCallback(async (
    boardId: string, b: Board, result: ReconcileResult, applyToStore: boolean,
  ) => {
    switch (result.kind) {
      case 'noop':
        setProviderState(boardId, PROVIDER_ID, { ...getProviderState(boardId, PROVIDER_ID), lastStatus: 'synced' })
        break
      case 'pushed':
        setProviderState(boardId, PROVIDER_ID, result.newState)
        if (result.newState.remoteFileId) await upsertManifestForBoard(boardId, b, result.newState.remoteFileId)
        break
      case 'reconciled':
        // Looked like a conflict, turned out to be identical content —
        // adopt the new baseline silently, no board content changes and no
        // prompt needed.
        setProviderState(boardId, PROVIDER_ID, result.newState)
        break
      case 'pulled':
        setProviderState(boardId, PROVIDER_ID, result.newState)
        if (applyToStore) {
          loadBoard(result.board)
        } else {
          await writeBoardFileById(boardId, JSON.stringify(result.board))
          useLibraryStore.getState().upsertSummary(summaryOf(result.board))
        }
        if (result.newState.remoteFileId) await upsertManifestForBoard(boardId, result.board, result.newState.remoteFileId)
        break
      case 'conflict':
        setConflict(boardId, result.summary)
        setProviderState(boardId, PROVIDER_ID, { ...getProviderState(boardId, PROVIDER_ID), lastStatus: 'conflict' })
        break
      case 'deletion-conflict':
        setDeletionConflict(boardId, result.summary)
        setProviderState(boardId, PROVIDER_ID, { ...getProviderState(boardId, PROVIDER_ID), lastStatus: 'deleted-remote' })
        break
      case 'error':
        setProviderState(boardId, PROVIDER_ID, { ...getProviderState(boardId, PROVIDER_ID), lastStatus: 'error', lastError: result.message })
        toast.error(`Drive sync error: ${result.message}`)
        break
    }
  }, [loadBoard, setConflict, setDeletionConflict, setProviderState, upsertManifestForBoard])

  // Reconciles the active board against the live in-memory store.
  const runCheck = useCallback(async () => {
    if (!activeBoardId || inFlightRef.current) return
    // Must check the *account*, not just this board's `linked` flag, so a
    // focus/visibility/push-debounce trigger can never try to reacquire a
    // token while the account isn't connected, popping the Google auth
    // prompt unprompted. (An active disconnect also purges every board's
    // state — see disconnectAccount — making the board check redundant
    // there, but the account check stands on its own.)
    if (!isAccountLinked(PROVIDER_ID)) return
    const state = getProviderState(activeBoardId, PROVIDER_ID)
    if (!state.linked) return
    inFlightRef.current = true
    // Visible immediately — without this, a background push is silent until
    // the popover is reopened, which reads as "nothing happened."
    setProviderState(activeBoardId, PROVIDER_ID, { ...state, lastStatus: 'syncing' })
    try {
      const currentBoard = useBoardStore.getState().board
      const result = await reconcile(googleDriveProvider, currentBoard, state)
      await handleReconcileResult(activeBoardId, currentBoard, result, true)
    } finally {
      inFlightRef.current = false
    }
  }, [activeBoardId, handleReconcileResult, setProviderState])

  // Manual "Sync now" for any board — active or not. Non-active boards are
  // read from/written to their OPFS file directly rather than the editor.
  const syncNowForBoard = useCallback(async (boardId: string) => {
    if (boardId === activeBoardId) { await runCheck(); return }
    if (!isAccountLinked(PROVIDER_ID)) return
    const state = getProviderState(boardId, PROVIDER_ID)
    if (!state.linked) return
    setProviderState(boardId, PROVIDER_ID, { ...state, lastStatus: 'syncing' })
    try {
      const raw = await readBoardFileById(boardId)
      if (!raw) {
        setProviderState(boardId, PROVIDER_ID, { ...state, lastStatus: 'error', lastError: 'Board file is missing locally' })
        return
      }
      const b = JSON.parse(raw) as Board
      const result = await reconcile(googleDriveProvider, b, state)
      await handleReconcileResult(boardId, b, result, false)
    } catch (err) {
      setProviderState(boardId, PROVIDER_ID, { ...state, lastStatus: 'error', lastError: err instanceof Error ? err.message : 'Sync failed' })
    }
  }, [activeBoardId, runCheck, handleReconcileResult, setProviderState])

  // On mount, and on every board switch: if the (now) active board is
  // linked, silently reacquire a token and reconcile it once.
  useEffect(() => {
    if (!syncHydrated || !boardLoaded || !activeBoardId) return
    if (!isAccountLinked(PROVIDER_ID)) return
    const state = getProviderState(activeBoardId, PROVIDER_ID)
    if (!state.linked) return
    ;(async () => {
      try {
        await getValidAccessToken()
        await runCheck()
      } catch (err) {
        console.error('Silent Drive reauth failed', err)
        setProviderState(activeBoardId, PROVIDER_ID, {
          ...state,
          lastStatus: 'error',
          lastError: err instanceof Error ? err.message : 'Reauthentication failed',
        })
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncHydrated, boardLoaded, activeBoardId])

  // Foreground triggers — "advantageous checks", no polling.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') runCheck() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', runCheck)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', runCheck)
    }
  }, [runCheck])

  // Push on change — debounced independently from the OPFS autosave.
  useEffect(() => {
    if (!providerState.linked) return
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current)
    pushTimerRef.current = setTimeout(() => { runCheck() }, PUSH_DEBOUNCE_MS)
    return () => { if (pushTimerRef.current) clearTimeout(pushTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, providerState.linked])

  /* ── Account-level ──────────────────────────────────────────────────── */

  /*
   * disconnectAccount — an ACTIVE, user-initiated disconnect is a full
   * sever, not a pause: every board's per-provider sync state
   * (remoteFileId, baselines) is purged along with the account flag, and
   * any queued offline remote-deletions are dropped (they reference an
   * account this device no longer syncs with). Without the purge, a later
   * local deletion would still try to delete from the disconnected Drive
   * account. Reconnecting relinks every board from scratch via
   * find-by-name/manifest discovery, so no data is lost.
   *
   * (A PASSIVE disconnect — simply being offline — goes nowhere near this;
   * sync state stays put and reconcile just fails until connectivity is
   * back.)
   */
  const disconnectAccount = useCallback(async () => {
    try {
      await revokeToken()
    } catch (err) {
      console.error('Drive token revoke failed', err)
    }
    clearCachedToken()
    useSyncStore.getState().clearProvider(PROVIDER_ID)
    useTrashStore.getState().clearPendingRemoteDeletions()
    toast.info('Disconnected from Google Drive.')
  }, [])

  const ensureAccountConnected = useCallback(async () => {
    if (isAccountLinked(PROVIDER_ID)) {
      try {
        await getValidAccessToken()
        return
      } catch {
        // Silent reacquire failed — fall through to an interactive prompt.
      }
    }
    await requestAccessToken({ prompt: 'consent' })
    setAccountLinked(PROVIDER_ID, true)
  }, [setAccountLinked])

  /* ── Board-level ─────────────────────────────────────────────────────── */

  const linkBoard = useCallback(async (boardId: string) => {
    try {
      await ensureAccountConnected()
      const token = await getValidAccessToken()
      const isActive = boardId === activeBoardId
      const raw = isActive ? JSON.stringify(useBoardStore.getState().board) : await readBoardFileById(boardId)
      if (!raw) { toast.error("Couldn't link — board file is missing."); return }
      const b = JSON.parse(raw) as Board
      const name = `${boardId}.json`
      const existing = await findFileByName(token, name)

      if (existing) {
        setProviderState(boardId, PROVIDER_ID, { ...makeInitialProviderState(), linked: true, remoteFileId: existing.fileId })
        toast.success('Connected to Google Drive.')
        await syncNowForBoard(boardId)
      } else {
        const created = await googleDriveProvider.createRemote(raw, name)
        const hash = await hashContent(syncableContent(b))
        setProviderState(boardId, PROVIDER_ID, {
          linked: true,
          remoteFileId: created.fileId,
          baselineHash: hash,
          baselineRemoteModifiedTime: created.modifiedTime,
          baselineVersion: b.syncMeta?.version ?? null,
          lastSyncedAt: new Date().toISOString(),
          lastStatus: 'synced',
          lastError: null,
        })
        await upsertManifestForBoard(boardId, b, created.fileId)
        toast.success('Connected to Google Drive.')
      }
    } catch (err) {
      console.error('Drive link failed', err)
      toast.error(err instanceof Error ? `Couldn't connect Google Drive: ${err.message}` : "Couldn't connect Google Drive.")
    }
  }, [activeBoardId, ensureAccountConnected, setProviderState, syncNowForBoard, upsertManifestForBoard])

  const unlinkBoard = useCallback((boardId: string) => {
    setProviderState(boardId, PROVIDER_ID, makeInitialProviderState())
    toast.info('This board no longer syncs to Google Drive.')
  }, [setProviderState])

  // Deletes the board's Drive file + this client's manifest entry for it,
  // then drops its sync-state bookkeeping. If Drive is unreachable (offline
  // permanent-delete), the remote deletion is queued in the trash store's
  // offline log and replayed by the next syncAllBoards sweep — drive.appdata
  // is invisible in Drive's own UI, so an orphaned remote copy could never
  // be cleaned up by hand.
  //
  // The account gate matters: only a PASSIVELY unreachable but still-linked
  // account gets the delete/queue treatment. If the account itself is
  // disconnected, a lingering per-board link (however it survived — see
  // the hydrate sanitization in syncStore) must not reach for a token here:
  // that pops the Google auth prompt out of nowhere, and worse, a deletion
  // queued while severed would be replayed against the account on a future
  // reconnect — destroying the very Drive copies a reconnect is supposed to
  // restore.
  const deleteRemoteForBoard = useCallback(async (boardId: string) => {
    const state = getProviderState(boardId, PROVIDER_ID)
    if (isAccountLinked(PROVIDER_ID) && state.linked && state.remoteFileId) {
      try {
        const token = await getValidAccessToken()
        await deleteFile(token, state.remoteFileId)
        await removeOwnManifestEntry(token, getClientId(), getClientLabel(), boardId)
      } catch (err) {
        console.error('Failed to delete Drive file, queueing for retry', err)
        useTrashStore.getState().enqueuePendingRemoteDeletion({
          boardId, fileId: state.remoteFileId, queuedAt: new Date().toISOString(),
        })
      }
    }
    useSyncStore.getState().removeBoard(boardId)
  }, [])

  // Replays the offline permanent-deletion log (see trashStore) — each
  // entry is a Drive file a permanent delete couldn't remove at the time.
  // deleteFile treats 404 as success, so entries another device already
  // cleaned up just drain silently.
  const replayPendingRemoteDeletions = useCallback(async (token: string) => {
    for (const p of useTrashStore.getState().pendingRemoteDeletions) {
      try {
        await deleteFile(token, p.fileId)
        await removeOwnManifestEntry(token, getClientId(), getClientLabel(), p.boardId)
        useTrashStore.getState().removePendingRemoteDeletion(p.boardId)
      } catch (err) {
        console.error('Deferred Drive deletion still failing, keeping it queued', err)
      }
    }
  }, [])

  /* ── Full-library sync ─────────────────────────────────────────────────
   * Sync is a background service, not a per-board toggle: once the account
   * is connected, every local board should end up linked and reconciled,
   * and every remote-only board (found via another client's manifest)
   * should be pulled in automatically. No manual "Sync to Drive" / "Add to
   * this device" affordances — this is the only entry point for all of it.
   * Sequential (not parallel) to stay gentle on the Drive API. */

  const pullBoardFromDrive = useCallback(async (entry: DriveManifestEntry): Promise<string | null> => {
    try {
      const remote = await googleDriveProvider.fetchRemote(entry.fileId)
      if (!remote) return null
      const b = JSON.parse(remote.content) as Board
      await writeBoardFileById(b.boardId, remote.content)
      useLibraryStore.getState().upsertSummary(summaryOf(b))
      const hash = await hashContent(syncableContent(b))
      setProviderState(b.boardId, PROVIDER_ID, {
        linked: true,
        remoteFileId: entry.fileId,
        baselineHash: hash,
        baselineRemoteModifiedTime: remote.modifiedTime,
        baselineVersion: b.syncMeta?.version ?? null,
        lastSyncedAt: new Date().toISOString(),
        lastStatus: 'synced',
        lastError: null,
      })
      return b.name
    } catch (err) {
      console.error('Failed to pull board from Drive', err)
      return null
    }
  }, [setProviderState])

  const syncAllBoards = useCallback(async () => {
    if (!isAccountLinked(PROVIDER_ID) || syncAllInFlightRef.current) return
    syncAllInFlightRef.current = true
    try {
      // 0. Settle trash bookkeeping first: replay any permanent deletions
      //    performed while offline, and reconcile the global retention
      //    setting's Drive mirror. Both non-fatal.
      try {
        const token = await getValidAccessToken()
        await replayPendingRemoteDeletions(token)
        await reconcileTrashSettings(token)
      } catch (err) {
        console.error('Trash bookkeeping sync failed', err)
      }

      // 1. Pull in anything another client has pushed that we don't have
      //    yet. "Don't have" includes one deliberate special case: a local
      //    board that sits in the trash with NO provider link. That's a
      //    board trashed/deleted while this device was severed from the
      //    account (an active disconnect purges every link) — a local-only
      //    decision made against a de-linked copy. On reconnect the Drive
      //    copy is authoritative and gets pulled back over it, which is
      //    what "reconnect brings my boards back" means. A trashed board
      //    WITH a live link is the normal synced-trash flow and is left to
      //    reconcile below. Without this, reconnecting after a local wipe
      //    restores nothing, and the resulting conflicts would attach to
      //    trashed rows no list ever shows.
      try {
        const token = await getValidAccessToken()
        const merged = mergeManifests(await fetchAllManifests(token))
        const localBoards = useLibraryStore.getState().boards
        const missing = [...merged.values()].filter(e => {
          const local = localBoards.find(b => b.boardId === e.boardId)
          if (!local) return true
          return local.trashed === true && !getProviderState(e.boardId, PROVIDER_ID).linked
        })
        const pulledNames = (await Promise.all(missing.map(pullBoardFromDrive))).filter((n): n is string => n !== null)
        if (pulledNames.length > 0) {
          toast.success(pulledNames.length === 1
            ? `Added "${pulledNames[0]}" from Drive.`
            : `Added ${pulledNames.length} boards from Drive.`)
        }
      } catch (err) {
        console.error('Failed to check Drive for boards', err)
      }

      // 2. Link anything not yet linked, reconcile everything else.
      for (const b of useLibraryStore.getState().boards) {
        const state = getProviderState(b.boardId, PROVIDER_ID)
        if (!state.linked) {
          await linkBoard(b.boardId)
        } else {
          await syncNowForBoard(b.boardId)
        }
      }
    } finally {
      syncAllInFlightRef.current = false
    }
  }, [linkBoard, syncNowForBoard, pullBoardFromDrive, replayPendingRemoteDeletions])

  // Fire-and-forget mirror push after the user edits the retention setting
  // in the Trash view — syncAllBoards also reconciles it, but that only
  // runs on connect/mount/modal-open, which could be a whole session away.
  const syncTrashSettingsNow = useCallback(async () => {
    if (!isAccountLinked(PROVIDER_ID)) return
    try {
      await reconcileTrashSettings(await getValidAccessToken())
    } catch (err) {
      console.error('Trash settings sync failed', err)
    }
  }, [])

  const connectAccount = useCallback(async () => {
    try {
      await requestAccessToken({ prompt: 'consent' })
      setAccountLinked(PROVIDER_ID, true)
      toast.success('Connected to Google Drive.')
      await syncAllBoards()
    } catch (err) {
      console.error('Drive connect failed', err)
      toast.error(err instanceof Error ? `Couldn't connect Google Drive: ${err.message}` : "Couldn't connect Google Drive.")
    }
  }, [setAccountLinked, syncAllBoards])

  // If the account was already connected from a previous session, sweep
  // once on mount so boards linked/pushed elsewhere show up without the
  // user having to do anything.
  useEffect(() => {
    if (!syncHydrated || !boardLoaded || didAutoSyncAllRef.current) return
    if (!isAccountLinked(PROVIDER_ID)) return
    didAutoSyncAllRef.current = true
    syncAllBoards()
  }, [syncHydrated, boardLoaded, syncAllBoards])

  /* ── Conflict / deletion resolution ───────────────────────────────────
   * A conflict modal is only ever *shown* for the active board, but the
   * store can hold one per board (any board syncAllBoards touched while
   * you were looking at something else). resolveOneConflict works against
   * any boardId — active boards go through the live editor store, others
   * read/write their OPFS file directly, mirroring syncNowForBoard. */

  const resolveOneConflict = useCallback(async (boardId: string, action: 'overwrite-local' | 'keep-local-copy' | 'cancel') => {
    const state = getProviderState(boardId, PROVIDER_ID)
    const summary = useSyncStore.getState().conflicts[boardId]
    if (!summary) return
    const isActive = boardId === activeBoardId
    try {
      if (action === 'overwrite-local') {
        const localRaw = isActive ? JSON.stringify(useBoardStore.getState().board) : await readBoardFileById(boardId)
        if (!localRaw) throw new Error('Board file is missing locally')
        const localBoard = JSON.parse(localRaw) as Board
        const { board: remoteBoard, newState } = await resolveConflictOverwriteLocal(summary.remote.content, localBoard, state)
        if (isActive) {
          loadBoard(remoteBoard)
        } else {
          await writeBoardFileById(boardId, JSON.stringify(remoteBoard))
          useLibraryStore.getState().upsertSummary(summaryOf(remoteBoard))
        }
        setProviderState(boardId, PROVIDER_ID, newState)
      } else if (action === 'keep-local-copy') {
        const localRaw = isActive ? JSON.stringify(useBoardStore.getState().board) : await readBoardFileById(boardId)
        if (!localRaw) throw new Error('Board file is missing locally')
        const localBoard = JSON.parse(localRaw) as Board
        const newState = await resolveConflictKeepLocalAsCopy(googleDriveProvider, localBoard, state)
        setProviderState(boardId, PROVIDER_ID, newState)
        if (newState.remoteFileId) await upsertManifestForBoard(boardId, localBoard, newState.remoteFileId)
      } else {
        setProviderState(boardId, PROVIDER_ID, resolveConflictCancel(state))
      }
    } catch (err) {
      console.error('Conflict resolution failed', err)
      toast.error("Couldn't resolve the sync conflict — try again.")
    } finally {
      setConflict(boardId, null)
    }
  }, [activeBoardId, loadBoard, setConflict, setProviderState, upsertManifestForBoard])

  const resolveConflict = useCallback(async (
    action: 'overwrite-local' | 'keep-local-copy' | 'cancel', applyToAll = false,
  ) => {
    if (applyToAll) {
      const ids = Object.keys(useSyncStore.getState().conflicts)
      for (const id of ids) await resolveOneConflict(id, action)
      if (action !== 'cancel' && ids.length > 1) toast.success(`Resolved ${ids.length} conflicts.`)
      return
    }
    if (!activeBoardId) return
    await resolveOneConflict(activeBoardId, action)
  }, [activeBoardId, resolveOneConflict])

  const resolveDeletion = useCallback(async (action: 'delete-local' | 'ignore' | 'reupload') => {
    if (!activeBoardId) return
    const state = getProviderState(activeBoardId, PROVIDER_ID)
    try {
      if (action === 'delete-local') {
        loadBoard(makeBoard())
        setProviderState(activeBoardId, PROVIDER_ID, makeInitialProviderState())
      } else if (action === 'ignore') {
        setProviderState(activeBoardId, PROVIDER_ID, resolveDeletionIgnore(state))
      } else {
        const newState = await resolveDeletionReupload(googleDriveProvider, useBoardStore.getState().board, state)
        setProviderState(activeBoardId, PROVIDER_ID, newState)
        if (newState.remoteFileId) await upsertManifestForBoard(activeBoardId, useBoardStore.getState().board, newState.remoteFileId)
      }
    } catch (err) {
      console.error('Deletion resolution failed', err)
      toast.error("Couldn't resolve the missing Drive file — try again.")
    } finally {
      setDeletionConflict(activeBoardId, null)
    }
  }, [activeBoardId, loadBoard, setDeletionConflict, setProviderState, upsertManifestForBoard])

  return {
    accountLinked,
    connectAccount,
    disconnectAccount,
    providerState,
    conflict,
    conflictCount,
    deletionConflict,
    linkBoard,
    unlinkBoard,
    deleteRemoteForBoard,
    syncNowForBoard,
    syncAllBoards,
    syncTrashSettingsNow,
    resolveConflict,
    resolveDeletion,
  }
}
