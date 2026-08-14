import { create } from 'zustand'
import { readSyncStateFile, writeSyncStateFile } from '@/lib/opfs/opfsStorage'
import { makeInitialProviderState } from '@/lib/sync/types'
import type { ConflictSummary, DeletionSummary, ProviderSyncState } from '@/lib/sync/types'

type ProvidersForBoard = Record<string, ProviderSyncState>

// v2: keyed by boardId, since multiple boards can each be linked
// independently, plus a separate account-level `accounts` map (was
// implicit in v1 — a board being linked meant the account was connected;
// now that's no longer 1:1). v1 (pre-multi-board) was a single flat
// `providers` map for the one board that existed at the time.
interface PersistedSyncStateV2 {
  schemaVersion: 2
  accounts: Record<string, boolean>
  boards:   Record<string, ProvidersForBoard>
}
interface PersistedSyncStateV1 {
  schemaVersion: 1
  providers: ProvidersForBoard
}

interface SyncStore {
  // accounts[providerId] — is the provider *account* connected (independent
  // of any specific board's link state).
  accounts:         Record<string, boolean>
  // boards[boardId][providerId]
  boards:           Record<string, ProvidersForBoard>
  conflicts:        Record<string, ConflictSummary>
  deletionConflicts: Record<string, DeletionSummary>
  hydrated:         boolean
  // legacyBoardId — the boardId the (still single-board, at migration time)
  // v1 state should be attached to if the persisted file turns out to still
  // be in the old shape. Callers pass this once they know which board the
  // pre-multi-board OPFS data migrated into (see useBoardLibrary).
  hydrate:          (legacyBoardId?: string) => Promise<void>
  setAccountLinked: (providerId: string, linked: boolean) => void
  setProviderState: (boardId: string, providerId: string, state: ProviderSyncState) => void
  // Full sever for an active, user-initiated provider disconnect: drops the
  // account flag AND every board's per-provider state (remoteFileId,
  // baselines, statuses) plus any conflicts. Without this purge, a later
  // local deletion would still "know" about a Drive file on an account this
  // device no longer syncs with and try to delete it there. Reconnecting
  // relinks from scratch via find-by-name/manifest discovery, so nothing of
  // value is lost by purging.
  clearProvider:    (providerId: string) => void
  removeBoard:      (boardId: string) => void
  setConflict:      (boardId: string, c: ConflictSummary | null) => void
  setDeletionConflict: (boardId: string, d: DeletionSummary | null) => void
}

function persist(accounts: Record<string, boolean>, boards: Record<string, ProvidersForBoard>) {
  const payload: PersistedSyncStateV2 = { schemaVersion: 2, accounts, boards }
  // Sync-state is bookkeeping, not board content — a lost write here means
  // one extra conflict prompt next sync, not lost work, so no verified write.
  writeSyncStateFile(JSON.stringify(payload)).catch(err => console.error('Failed to persist sync state', err))
}

/*
 * Self-heal on hydrate: a board must never carry a link to a provider whose
 * *account* isn't connected — "account disconnected" means fully severed
 * (see useDriveSync.disconnectAccount). Persisted states that violate this
 * do exist in the wild: anything written before disconnect purged per-board
 * state, or a disconnect whose fire-and-forget persist lost the race with a
 * reload. Left in place, those stale links make later local deletions reach
 * for a token on a severed account (surprise auth prompt) and can queue
 * remote deletions that a future reconnect would wrongly replay.
 */
function stripUnlinkedProviders(
  accounts: Record<string, boolean>,
  boards:   Record<string, ProvidersForBoard>,
): { boards: Record<string, ProvidersForBoard>; changed: boolean } {
  let changed = false
  const cleaned: Record<string, ProvidersForBoard> = {}
  for (const [boardId, providers] of Object.entries(boards)) {
    const kept: ProvidersForBoard = {}
    for (const [providerId, state] of Object.entries(providers)) {
      if (accounts[providerId] === true) kept[providerId] = state
      else changed = true
    }
    if (Object.keys(kept).length > 0) cleaned[boardId] = kept
  }
  return { boards: cleaned, changed }
}

export const useSyncStore = create<SyncStore>((set) => ({
  accounts: {},
  boards: {},
  conflicts: {},
  deletionConflicts: {},
  hydrated: false,

  hydrate: async (legacyBoardId) => {
    try {
      const raw = await readSyncStateFile()
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedSyncStateV1 | PersistedSyncStateV2
        if (parsed.schemaVersion === 2) {
          const { boards, changed } = stripUnlinkedProviders(parsed.accounts, parsed.boards)
          if (changed) persist(parsed.accounts, boards)
          set({ accounts: parsed.accounts, boards, hydrated: true })
          return
        }
        if (parsed.schemaVersion === 1 && legacyBoardId) {
          const boards = { [legacyBoardId]: parsed.providers }
          const accounts: Record<string, boolean> = {}
          for (const [providerId, state] of Object.entries(parsed.providers)) {
            if (state.linked) accounts[providerId] = true
          }
          persist(accounts, boards)
          set({ accounts, boards, hydrated: true })
          return
        }
      }
    } catch (err) {
      console.error('Failed to read sync state', err)
    }
    set({ hydrated: true })
  },

  setAccountLinked: (providerId, linked) => {
    set(s => {
      const accounts = { ...s.accounts, [providerId]: linked }
      persist(accounts, s.boards)
      return { accounts }
    })
  },

  setProviderState: (boardId, providerId, state) => {
    set(s => {
      const boards = { ...s.boards, [boardId]: { ...s.boards[boardId], [providerId]: state } }
      persist(s.accounts, boards)
      return { boards }
    })
  },

  clearProvider: (providerId) => {
    set(s => {
      const accounts = { ...s.accounts }
      delete accounts[providerId]
      const boards: Record<string, ProvidersForBoard> = {}
      for (const [boardId, providers] of Object.entries(s.boards)) {
        const rest = { ...providers }
        delete rest[providerId]
        if (Object.keys(rest).length > 0) boards[boardId] = rest
      }
      persist(accounts, boards)
      // Conflicts/deletion prompts all reference remote state that no longer
      // applies once the provider is severed.
      return { accounts, boards, conflicts: {}, deletionConflicts: {} }
    })
  },

  removeBoard: (boardId) => {
    set(s => {
      if (!(boardId in s.boards)) return s
      const boards = { ...s.boards }
      delete boards[boardId]
      persist(s.accounts, boards)
      const conflicts = { ...s.conflicts }
      delete conflicts[boardId]
      const deletionConflicts = { ...s.deletionConflicts }
      delete deletionConflicts[boardId]
      return { boards, conflicts, deletionConflicts }
    })
  },

  setConflict: (boardId, c) =>
    set(s => {
      const conflicts = { ...s.conflicts }
      if (c) conflicts[boardId] = c; else delete conflicts[boardId]
      return { conflicts }
    }),

  setDeletionConflict: (boardId, d) =>
    set(s => {
      const deletionConflicts = { ...s.deletionConflicts }
      if (d) deletionConflicts[boardId] = d; else delete deletionConflicts[boardId]
      return { deletionConflicts }
    }),
}))

export function isAccountLinked(providerId: string): boolean {
  return useSyncStore.getState().accounts[providerId] === true
}

export function getProviderState(boardId: string, providerId: string): ProviderSyncState {
  return useSyncStore.getState().boards[boardId]?.[providerId] ?? makeInitialProviderState()
}
