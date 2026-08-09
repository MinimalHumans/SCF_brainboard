export interface RemoteFile {
  content:      string
  modifiedTime: string
}

/*
 * SyncProvider — everything the sync engine needs from a cloud backend.
 * Google Drive is the first implementation; a future OneDrive provider (or
 * any backend offering an equivalent hidden app-folder) implements the same
 * shape and the engine below needs no changes.
 */
export interface SyncProvider {
  id: string
  isLinked():        boolean
  link():             Promise<void>
  unlink():           Promise<void>
  fetchRemote(fileId: string):        Promise<RemoteFile | null>
  // name lets callers avoid colliding with the canonical 'board.json' name
  // when spinning off a conflict copy or a re-upload after a remote deletion.
  createRemote(content: string, name?: string): Promise<{ fileId: string; modifiedTime: string }>
  updateRemote(fileId: string, content: string): Promise<{ modifiedTime: string }>
  getRemoteModifiedTime(fileId: string): Promise<string | null>
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'conflict' | 'deleted-remote' | 'error'

export interface ProviderSyncState {
  linked:                      boolean
  remoteFileId:                string | null
  baselineHash:                string | null
  baselineRemoteModifiedTime:  string | null
  lastSyncedAt:                string | null
  lastStatus:                  SyncStatus
  lastError:                   string | null
}

export function makeInitialProviderState(): ProviderSyncState {
  return {
    linked: false,
    remoteFileId: null,
    baselineHash: null,
    baselineRemoteModifiedTime: null,
    lastSyncedAt: null,
    lastStatus: 'idle',
    lastError: null,
  }
}

export interface ConflictSummary {
  provider:  string
  local:     { name: string; updatedAt: string }
  remote:    { name: string; updatedAt: string; content: string }
}

export interface DeletionSummary {
  provider:     string
  lastSyncedAt: string | null
  localDirty:   boolean
}
