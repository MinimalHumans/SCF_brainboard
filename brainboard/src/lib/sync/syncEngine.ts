import type { Board } from '@/types/board'
import { hashContent } from './hash'
import type { ConflictSummary, DeletionSummary, ProviderSyncState, SyncProvider } from './types'

function parseBoard(content: string): Board | null {
  try {
    const parsed = JSON.parse(content) as Board
    if (parsed.schemaVersion === 1 && Array.isArray(parsed.cards)) return parsed
    return null
  } catch {
    return null
  }
}

/*
 * syncableContent — the JSON used for change detection (hashing), as opposed
 * to what's actually written to disk/uploaded. `viewport` is per-device pan/
 * zoom state, not board content: panning or zooming alone must never look
 * like a change worth pushing, and must never turn an otherwise-clean pull
 * into a false conflict. The full board (viewport included) is still what
 * gets pushed to remote — it's a useful hint for a fresh device — it's just
 * excluded from the hash that decides whether a sync action is needed.
 */
export function syncableContent(board: Board): string {
  return JSON.stringify(board, (key, value) => (key === 'viewport' ? undefined : value))
}

// Applies a pulled/overwritten remote board without yanking the user's
// current view out from under them — everything except viewport comes from
// remote; viewport stays whatever this device currently has.
function withLocalViewport(remoteBoard: Board, localBoard: Board): Board {
  return { ...remoteBoard, viewport: localBoard.viewport }
}

export type ReconcileResult =
  | { kind: 'noop' }
  | { kind: 'pushed'; newState: ProviderSyncState }
  | { kind: 'pulled'; board: Board; newState: ProviderSyncState }
  | { kind: 'conflict'; summary: ConflictSummary }
  | { kind: 'deletion-conflict'; summary: DeletionSummary }
  | { kind: 'error'; message: string }

/*
 * reconcile — provider-agnostic three-way diff against the last known-good
 * baseline (hash + remote modifiedTime as of the last successful sync).
 * Requires state.remoteFileId to already be set; the initial find-or-create
 * on first link is handled by the caller before this is ever invoked.
 */
export async function reconcile(
  provider: SyncProvider,
  localBoard: Board,
  state: ProviderSyncState,
): Promise<ReconcileResult> {
  if (!state.remoteFileId) return { kind: 'error', message: 'No remote file bound yet' }

  const localContent = JSON.stringify(localBoard)

  let localHash: string
  let remoteModifiedTime: string | null
  try {
    localHash = await hashContent(syncableContent(localBoard))
    remoteModifiedTime = await provider.getRemoteModifiedTime(state.remoteFileId)
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'Sync check failed' }
  }

  if (remoteModifiedTime === null) {
    return {
      kind: 'deletion-conflict',
      summary: {
        provider: provider.id,
        lastSyncedAt: state.lastSyncedAt,
        localDirty: localHash !== state.baselineHash,
      },
    }
  }

  const remoteUnchanged = remoteModifiedTime === state.baselineRemoteModifiedTime
  const localUnchanged  = localHash === state.baselineHash

  if (remoteUnchanged && localUnchanged) {
    return { kind: 'noop' }
  }

  if (remoteUnchanged && !localUnchanged) {
    try {
      const { modifiedTime } = await provider.updateRemote(state.remoteFileId, localContent)
      return {
        kind: 'pushed',
        newState: {
          ...state,
          baselineHash: localHash,
          baselineRemoteModifiedTime: modifiedTime,
          lastSyncedAt: new Date().toISOString(),
          lastStatus: 'synced',
          lastError: null,
        },
      }
    } catch (err) {
      return { kind: 'error', message: err instanceof Error ? err.message : 'Push failed' }
    }
  }

  if (!remoteUnchanged && localUnchanged) {
    try {
      const remote = await provider.fetchRemote(state.remoteFileId)
      if (!remote) {
        return {
          kind: 'deletion-conflict',
          summary: { provider: provider.id, lastSyncedAt: state.lastSyncedAt, localDirty: false },
        }
      }
      const remoteBoard = parseBoard(remote.content)
      if (!remoteBoard) return { kind: 'error', message: 'Remote board content is invalid' }
      const remoteHash = await hashContent(syncableContent(remoteBoard))
      return {
        kind: 'pulled',
        board: withLocalViewport(remoteBoard, localBoard),
        newState: {
          ...state,
          baselineHash: remoteHash,
          baselineRemoteModifiedTime: remote.modifiedTime,
          lastSyncedAt: new Date().toISOString(),
          lastStatus: 'synced',
          lastError: null,
        },
      }
    } catch (err) {
      return { kind: 'error', message: err instanceof Error ? err.message : 'Pull failed' }
    }
  }

  // Both sides changed since the baseline — genuine conflict, ask the user.
  try {
    const remote = await provider.fetchRemote(state.remoteFileId)
    if (!remote) {
      return {
        kind: 'deletion-conflict',
        summary: { provider: provider.id, lastSyncedAt: state.lastSyncedAt, localDirty: true },
      }
    }
    const remoteBoard = parseBoard(remote.content)
    if (!remoteBoard) return { kind: 'error', message: 'Remote board content is invalid' }
    return {
      kind: 'conflict',
      summary: {
        provider: provider.id,
        local:  { name: localBoard.name, updatedAt: localBoard.updatedAt },
        remote: { name: remoteBoard.name, updatedAt: remoteBoard.updatedAt, content: remote.content },
      },
    }
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'Conflict check failed' }
  }
}

/* ── Conflict resolutions ─────────────────────────────────────────────── */

export function resolveConflictOverwriteLocal(remoteContent: string, localBoard: Board, state: ProviderSyncState) {
  const remoteBoard = parseBoard(remoteContent)
  if (!remoteBoard) throw new Error('Remote board content is invalid')
  return hashContent(syncableContent(remoteBoard)).then(remoteHash => ({
    board: withLocalViewport(remoteBoard, localBoard),
    newState: {
      ...state,
      baselineHash: remoteHash,
      lastSyncedAt: new Date().toISOString(),
      lastStatus: 'synced' as const,
      lastError: null,
    },
  }))
}

export async function resolveConflictKeepLocalAsCopy(
  provider: SyncProvider,
  localBoard: Board,
  state: ProviderSyncState,
): Promise<ProviderSyncState> {
  const localContent = JSON.stringify(localBoard)
  const copyName = `board-copy-${Date.now()}.json`
  const { fileId, modifiedTime } = await provider.createRemote(localContent, copyName)
  const localHash = await hashContent(syncableContent(localBoard))
  return {
    ...state,
    remoteFileId: fileId,
    baselineHash: localHash,
    baselineRemoteModifiedTime: modifiedTime,
    lastSyncedAt: new Date().toISOString(),
    lastStatus: 'synced',
    lastError: null,
  }
}

export function resolveConflictCancel(state: ProviderSyncState): ProviderSyncState {
  return { ...state, lastStatus: 'conflict' }
}

/* ── Deletion resolutions ─────────────────────────────────────────────── */

export function resolveDeletionIgnore(state: ProviderSyncState): ProviderSyncState {
  return {
    ...state,
    remoteFileId: null,
    baselineHash: null,
    baselineRemoteModifiedTime: null,
    lastStatus: 'idle',
    lastError: null,
  }
}

export async function resolveDeletionReupload(
  provider: SyncProvider,
  localBoard: Board,
  state: ProviderSyncState,
): Promise<ProviderSyncState> {
  const localContent = JSON.stringify(localBoard)
  const reuploadName = `board-restored-${Date.now()}.json`
  const { fileId, modifiedTime } = await provider.createRemote(localContent, reuploadName)
  const localHash = await hashContent(syncableContent(localBoard))
  return {
    ...state,
    remoteFileId: fileId,
    baselineHash: localHash,
    baselineRemoteModifiedTime: modifiedTime,
    lastSyncedAt: new Date().toISOString(),
    lastStatus: 'synced',
    lastError: null,
  }
}
