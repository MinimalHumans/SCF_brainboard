import { create } from 'zustand'
import { readTrashStateFile, writeTrashStateFile } from '@/lib/opfs/opfsStorage'

export const DEFAULT_RETENTION_DAYS = 30

/*
 * trashStore — the two pieces of trash bookkeeping that live *outside* board
 * content (board files themselves only carry trashed/trashedAt — see
 * types/board.ts):
 *
 *  - retentionDays: the single app-wide auto-delete window. Deliberately one
 *    global setting, never per-file; each trashed board's eligibility is its
 *    own trashedAt measured against this. Mirrored to a small file in the
 *    Drive app-data folder (see lib/sync/trashSettingsSync.ts) so all of a
 *    user's devices agree on it — retentionUpdatedAt is the last-write-wins
 *    tiebreaker for that mirror, null until the user has ever changed it.
 *
 *  - pendingRemoteDeletions: the offline log for the ONE action that needs
 *    one. Trash moves/restores are plain field updates that resync normally,
 *    but a permanent deletion performed while Drive is unreachable would
 *    otherwise leave the remote copy orphaned forever (drive.appdata is
 *    hidden — the user can never see or clean it up from Drive's own UI).
 *    Each failed remote delete is queued here and replayed on the next
 *    successful sync sweep. An *active* user-initiated disconnect clears the
 *    queue instead — those entries reference an account this device no
 *    longer syncs with (see useDriveSync.disconnectAccount).
 */

export interface PendingRemoteDeletion {
  boardId:  string
  fileId:   string
  queuedAt: string
}

interface PersistedTrashStateV1 {
  schemaVersion:          1
  retentionDays:          number
  retentionUpdatedAt:     string | null
  pendingRemoteDeletions: PendingRemoteDeletion[]
}

interface TrashStore {
  retentionDays:          number
  retentionUpdatedAt:     string | null
  pendingRemoteDeletions: PendingRemoteDeletion[]
  hydrated:               boolean
  hydrate:                () => Promise<void>
  // User-initiated change — stamps retentionUpdatedAt so this value wins
  // the Drive mirror's last-write-wins comparison.
  setRetentionDays:       (days: number) => void
  // Adopting the Drive-side value — takes the remote timestamp as-is.
  adoptRemoteRetention:   (days: number, updatedAt: string | null) => void
  enqueuePendingRemoteDeletion: (entry: PendingRemoteDeletion) => void
  removePendingRemoteDeletion:  (boardId: string) => void
  clearPendingRemoteDeletions:  () => void
}

function persist(s: Pick<TrashStore, 'retentionDays' | 'retentionUpdatedAt' | 'pendingRemoteDeletions'>) {
  const payload: PersistedTrashStateV1 = {
    schemaVersion: 1,
    retentionDays: s.retentionDays,
    retentionUpdatedAt: s.retentionUpdatedAt,
    pendingRemoteDeletions: s.pendingRemoteDeletions,
  }
  writeTrashStateFile(JSON.stringify(payload)).catch(err => console.error('Failed to persist trash state', err))
}

export const useTrashStore = create<TrashStore>((set, get) => ({
  retentionDays: DEFAULT_RETENTION_DAYS,
  retentionUpdatedAt: null,
  pendingRemoteDeletions: [],
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await readTrashStateFile()
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedTrashStateV1
        if (parsed.schemaVersion === 1) {
          set({
            retentionDays: parsed.retentionDays > 0 ? parsed.retentionDays : DEFAULT_RETENTION_DAYS,
            retentionUpdatedAt: parsed.retentionUpdatedAt ?? null,
            pendingRemoteDeletions: Array.isArray(parsed.pendingRemoteDeletions) ? parsed.pendingRemoteDeletions : [],
            hydrated: true,
          })
          return
        }
      }
    } catch (err) {
      console.error('Failed to read trash state', err)
    }
    set({ hydrated: true })
  },

  setRetentionDays: (days) => {
    if (!Number.isFinite(days) || days < 1) return
    set(() => {
      const next = { retentionDays: Math.round(days), retentionUpdatedAt: new Date().toISOString() }
      persist({ ...next, pendingRemoteDeletions: get().pendingRemoteDeletions })
      return next
    })
  },

  adoptRemoteRetention: (days, updatedAt) => {
    if (!Number.isFinite(days) || days < 1) return
    set(() => {
      const next = { retentionDays: Math.round(days), retentionUpdatedAt: updatedAt }
      persist({ ...next, pendingRemoteDeletions: get().pendingRemoteDeletions })
      return next
    })
  },

  enqueuePendingRemoteDeletion: (entry) => {
    set(s => {
      const pendingRemoteDeletions = [
        ...s.pendingRemoteDeletions.filter(p => p.boardId !== entry.boardId),
        entry,
      ]
      persist({ retentionDays: s.retentionDays, retentionUpdatedAt: s.retentionUpdatedAt, pendingRemoteDeletions })
      return { pendingRemoteDeletions }
    })
  },

  removePendingRemoteDeletion: (boardId) => {
    set(s => {
      const pendingRemoteDeletions = s.pendingRemoteDeletions.filter(p => p.boardId !== boardId)
      persist({ retentionDays: s.retentionDays, retentionUpdatedAt: s.retentionUpdatedAt, pendingRemoteDeletions })
      return { pendingRemoteDeletions }
    })
  },

  clearPendingRemoteDeletions: () => {
    set(s => {
      if (s.pendingRemoteDeletions.length === 0) return s
      persist({ retentionDays: s.retentionDays, retentionUpdatedAt: s.retentionUpdatedAt, pendingRemoteDeletions: [] })
      return { pendingRemoteDeletions: [] }
    })
  },
}))
