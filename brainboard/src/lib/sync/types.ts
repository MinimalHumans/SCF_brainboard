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
  // name is the Drive app-data file name — callers pass a boardId-derived
  // name so each board gets its own file (or a conflict-copy/re-upload name
  // when spinning off a variant of an existing board's file).
  createRemote(content: string, name: string): Promise<{ fileId: string; modifiedTime: string }>
  updateRemote(fileId: string, content: string): Promise<{ modifiedTime: string }>
  getRemoteModifiedTime(fileId: string): Promise<string | null>
  deleteRemote(fileId: string): Promise<void>
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'conflict' | 'deleted-remote' | 'error'

export interface ProviderSyncState {
  linked:                      boolean
  remoteFileId:                string | null
  baselineHash:                string | null
  baselineRemoteModifiedTime:  string | null
  // syncMeta.version as of the last successful sync — informational only,
  // shown in the Boards modal/conflict UI; never used by reconcile()'s diff.
  baselineVersion:             number | null
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
    baselineVersion: null,
    lastSyncedAt: null,
    lastStatus: 'idle',
    lastError: null,
  }
}

interface SyncSide {
  name:        string
  updatedAt:   string
  version:     number | null
  clientLabel: string | null
}

export interface ConflictSummary {
  provider: string
  boardId:  string
  local:    SyncSide
  remote:   SyncSide & { content: string }
}

export interface DeletionSummary {
  provider:     string
  boardId:      string
  boardName:    string
  localVersion: number | null
  localClientLabel: string | null
  lastSyncedAt: string | null
  localDirty:   boolean
}
