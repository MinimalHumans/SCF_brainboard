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
          set({ accounts: parsed.accounts, boards: parsed.boards, hydrated: true })
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
