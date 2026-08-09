import { create } from 'zustand'
import { readSyncStateFile, writeSyncStateFile } from '@/lib/opfs/opfsStorage'
import { makeInitialProviderState } from '@/lib/sync/types'
import type { ConflictSummary, DeletionSummary, ProviderSyncState } from '@/lib/sync/types'

interface PersistedSyncState {
  schemaVersion: 1
  providers: Record<string, ProviderSyncState>
}

interface SyncStore {
  providers:        Record<string, ProviderSyncState>
  conflict:         ConflictSummary | null
  deletionConflict: DeletionSummary | null
  hydrated:         boolean
  hydrate:          () => Promise<void>
  setProviderState: (id: string, state: ProviderSyncState) => void
  setConflict:      (c: ConflictSummary | null) => void
  setDeletionConflict: (d: DeletionSummary | null) => void
}

function persist(providers: Record<string, ProviderSyncState>) {
  const payload: PersistedSyncState = { schemaVersion: 1, providers }
  // Sync-state is bookkeeping, not board content — a lost write here means
  // one extra conflict prompt next sync, not lost work, so no verified write.
  writeSyncStateFile(JSON.stringify(payload)).catch(err => console.error('Failed to persist sync state', err))
}

export const useSyncStore = create<SyncStore>((set) => ({
  providers: {},
  conflict: null,
  deletionConflict: null,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await readSyncStateFile()
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedSyncState
        if (parsed.schemaVersion === 1) {
          set({ providers: parsed.providers, hydrated: true })
          return
        }
      }
    } catch (err) {
      console.error('Failed to read sync state', err)
    }
    set({ hydrated: true })
  },

  setProviderState: (id, state) => {
    set(s => {
      const providers = { ...s.providers, [id]: state }
      persist(providers)
      return { providers }
    })
  },

  setConflict:         (c) => set({ conflict: c }),
  setDeletionConflict: (d) => set({ deletionConflict: d }),
}))

export function getProviderState(id: string): ProviderSyncState {
  return useSyncStore.getState().providers[id] ?? makeInitialProviderState()
}
