import { useCallback, useEffect, useRef } from 'react'
import { nanoid } from 'nanoid'
import { useBoardStore, WORLD_CENTER } from '@/store/boardStore'
import { getProviderState, useSyncStore } from '@/store/syncStore'
import { toast } from '@/store/toastStore'
import { googleDriveProvider } from '@/lib/sync/googleDriveProvider'
import { findAppDataFile } from '@/lib/sync/googleDriveApi'
import { getValidAccessToken, requestAccessToken } from '@/lib/sync/googleAuth'
import {
  reconcile,
  resolveConflictCancel,
  resolveConflictKeepLocalAsCopy,
  resolveConflictOverwriteLocal,
  resolveDeletionIgnore,
  resolveDeletionReupload,
  syncableContent,
} from '@/lib/sync/syncEngine'
import { hashContent } from '@/lib/sync/hash'
import { makeInitialProviderState } from '@/lib/sync/types'

const PROVIDER_ID = 'google-drive'
const PUSH_DEBOUNCE_MS = 3000

/*
 * boardLoaded — true once usePersistence has actually loaded the real board
 * (from OPFS or localStorage) into the store. The initial reconcile pass
 * must wait for this: it runs in a separate effect from usePersistence's
 * own load, and without this gate it can race ahead and reconcile against
 * the store's blank just-initialized board, misreading "haven't loaded yet"
 * as "the user emptied their board."
 */
export function useDriveSync(boardLoaded: boolean) {
  const board             = useBoardStore(s => s.board)
  const loadBoard         = useBoardStore(s => s.loadBoard)
  const hydrate           = useSyncStore(s => s.hydrate)
  const hydrated          = useSyncStore(s => s.hydrated)
  const providers         = useSyncStore(s => s.providers)
  const setProviderState  = useSyncStore(s => s.setProviderState)
  const conflict          = useSyncStore(s => s.conflict)
  const deletionConflict  = useSyncStore(s => s.deletionConflict)
  const setConflict       = useSyncStore(s => s.setConflict)
  const setDeletionConflict = useSyncStore(s => s.setDeletionConflict)

  const providerState = providers[PROVIDER_ID] ?? makeInitialProviderState()

  const inFlightRef = useRef(false)
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didInitialCheckRef = useRef(false)

  // Hydrate persisted sync bookkeeping from OPFS once on mount.
  useEffect(() => { hydrate() }, [hydrate])

  const runCheck = useCallback(async () => {
    const state = getProviderState(PROVIDER_ID)
    if (!state.linked || inFlightRef.current) return
    inFlightRef.current = true
    // Visible immediately — without this, a background push is silent until
    // the popover is reopened, which reads as "nothing happened."
    setProviderState(PROVIDER_ID, { ...state, lastStatus: 'syncing' })
    try {
      const currentBoard = useBoardStore.getState().board
      const result = await reconcile(googleDriveProvider, currentBoard, state)
      switch (result.kind) {
        case 'noop':
          setProviderState(PROVIDER_ID, { ...state, lastStatus: 'synced' })
          break
        case 'pushed':
        case 'pulled':
          if (result.kind === 'pulled') loadBoard(result.board)
          setProviderState(PROVIDER_ID, result.newState)
          break
        case 'conflict':
          setConflict(result.summary)
          setProviderState(PROVIDER_ID, { ...state, lastStatus: 'conflict' })
          break
        case 'deletion-conflict':
          setDeletionConflict(result.summary)
          setProviderState(PROVIDER_ID, { ...state, lastStatus: 'deleted-remote' })
          break
        case 'error':
          setProviderState(PROVIDER_ID, { ...state, lastStatus: 'error', lastError: result.message })
          toast.error(`Drive sync error: ${result.message}`)
          break
      }
    } finally {
      inFlightRef.current = false
    }
  }, [loadBoard, setConflict, setDeletionConflict, setProviderState])

  // Mount: if already linked, silently reacquire a token and reconcile once.
  // Gated on boardLoaded too — see the boardLoaded doc comment above.
  useEffect(() => {
    if (!hydrated || !boardLoaded || didInitialCheckRef.current) return
    didInitialCheckRef.current = true
    const state = getProviderState(PROVIDER_ID)
    if (!state.linked) return
    ;(async () => {
      try {
        await getValidAccessToken()
        await runCheck()
      } catch (err) {
        console.error('Silent Drive reauth failed', err)
        setProviderState(PROVIDER_ID, {
          ...state,
          lastStatus: 'error',
          lastError: err instanceof Error ? err.message : 'Reauthentication failed',
        })
      }
    })()
  }, [hydrated, boardLoaded, runCheck, setProviderState])

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

  const link = useCallback(async () => {
    try {
      await requestAccessToken({ prompt: 'consent' })
      const token = await getValidAccessToken()
      const existing = await findAppDataFile(token)
      const currentBoard = useBoardStore.getState().board

      if (existing) {
        setProviderState(PROVIDER_ID, {
          ...makeInitialProviderState(),
          linked: true,
          remoteFileId: existing.fileId,
        })
        toast.success('Connected to Google Drive.')
        await runCheck()
      } else {
        const content = JSON.stringify(currentBoard)
        const created = await googleDriveProvider.createRemote(content)
        const hash = await hashContent(syncableContent(currentBoard))
        setProviderState(PROVIDER_ID, {
          linked: true,
          remoteFileId: created.fileId,
          baselineHash: hash,
          baselineRemoteModifiedTime: created.modifiedTime,
          lastSyncedAt: new Date().toISOString(),
          lastStatus: 'synced',
          lastError: null,
        })
        toast.success('Connected to Google Drive.')
      }
    } catch (err) {
      console.error('Drive link failed', err)
      toast.error(err instanceof Error ? `Couldn't connect Google Drive: ${err.message}` : "Couldn't connect Google Drive.")
    }
  }, [runCheck, setProviderState])

  const unlink = useCallback(async () => {
    try {
      await googleDriveProvider.unlink()
    } catch (err) {
      console.error('Drive unlink/token revoke failed', err)
    }
    setProviderState(PROVIDER_ID, makeInitialProviderState())
    toast.info('Disconnected from Google Drive.')
  }, [setProviderState])

  const resolveConflict = useCallback(async (action: 'overwrite-local' | 'keep-local-copy' | 'cancel') => {
    const state = getProviderState(PROVIDER_ID)
    const summary = useSyncStore.getState().conflict
    if (!summary) return
    try {
      if (action === 'overwrite-local') {
        const { board: remoteBoard, newState } = await resolveConflictOverwriteLocal(
          summary.remote.content,
          useBoardStore.getState().board,
          state,
        )
        loadBoard(remoteBoard)
        setProviderState(PROVIDER_ID, newState)
      } else if (action === 'keep-local-copy') {
        const newState = await resolveConflictKeepLocalAsCopy(googleDriveProvider, useBoardStore.getState().board, state)
        setProviderState(PROVIDER_ID, newState)
      } else {
        setProviderState(PROVIDER_ID, resolveConflictCancel(state))
      }
    } catch (err) {
      console.error('Conflict resolution failed', err)
      toast.error("Couldn't resolve the sync conflict — try again.")
    } finally {
      setConflict(null)
    }
  }, [loadBoard, setConflict, setProviderState])

  const resolveDeletion = useCallback(async (action: 'delete-local' | 'ignore' | 'reupload') => {
    const state = getProviderState(PROVIDER_ID)
    try {
      if (action === 'delete-local') {
        loadBoard({
          schemaVersion: 1, boardId: nanoid(), name: 'Untitled Board',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          viewport: { x: WORLD_CENTER, y: WORLD_CENTER, zoom: 1 },
          cards: [], entities: [], backdrops: [],
        })
        setProviderState(PROVIDER_ID, makeInitialProviderState())
      } else if (action === 'ignore') {
        setProviderState(PROVIDER_ID, resolveDeletionIgnore(state))
      } else {
        const newState = await resolveDeletionReupload(googleDriveProvider, useBoardStore.getState().board, state)
        setProviderState(PROVIDER_ID, newState)
      }
    } catch (err) {
      console.error('Deletion resolution failed', err)
      toast.error("Couldn't resolve the missing Drive file — try again.")
    } finally {
      setDeletionConflict(null)
    }
  }, [loadBoard, setDeletionConflict, setProviderState])

  // Exposed as a manual "Sync now" action, and — critically — as the only way
  // to recover once a conflict/deletion modal has been dismissed: dismissing
  // it clears the summary but leaves the underlying divergence (and
  // lastStatus) unresolved, so the baseline is never updated and ordinary
  // edits keep landing back on the same unresolved conflict instead of ever
  // reaching a push. Calling this re-runs reconcile, which re-surfaces the
  // same modal with fresh data if it's still unresolved.
  const checkNow = runCheck

  return { providerState, conflict, deletionConflict, link, unlink, resolveConflict, resolveDeletion, checkNow }
}
