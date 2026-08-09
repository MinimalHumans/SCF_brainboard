import type { SyncStatus } from './types'

/*
 * Shared status copy for the sync badge, the Sync modal, and the status bar.
 * One source so wording doesn't drift as more providers are added.
 */
export const SYNC_STATUS_LABEL: Record<SyncStatus, string> = {
  idle:             'Not synced yet',
  syncing:          'Syncing…',
  synced:           'Synced',
  conflict:         'Sync conflict — needs your input',
  'deleted-remote': 'Backup missing — needs your input',
  error:            'Sync error',
}
