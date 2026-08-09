import React from 'react'
import { useBoardStore } from '@/store/boardStore'
import { useSelectionStore } from '@/store/selectionStore'
import type { ProviderSyncState } from '@/lib/sync/types'
import { formatRelativeTime } from '@/lib/sync/formatTime'
import styles from './StatusBar.module.css'

interface StatusBarProps {
  driveState?: ProviderSyncState
}

const SYNC_LABEL: Record<ProviderSyncState['lastStatus'], string> = {
  idle:             'Not synced yet',
  syncing:          'Syncing…',
  synced:           'Synced',
  conflict:         'Sync conflict',
  'deleted-remote': 'Drive backup missing',
  error:            'Sync error',
}

export function StatusBar({ driveState }: StatusBarProps) {
  const cards      = useBoardStore(s => s.board.cards)
  const entities   = useBoardStore(s => s.board.entities)
  const backdrops  = useBoardStore(s => s.board.backdrops)
  const selectedIds = useSelectionStore(s => s.selectedIds)

  const total    = cards.length
  const published = cards.filter(c => c.entityId !== null).length
  const drafts   = total - published
  const selected = selectedIds.size

  return (
    <footer className={styles.bar}>
      <div className={styles.left}>
        {selected > 0 ? (
          <span className={styles.selection}>
            {selected} card{selected !== 1 ? 's' : ''} selected
          </span>
        ) : (
          <span className={styles.hint}>
            Double-click to add a card · Right-click for backdrops and more options
          </span>
        )}
      </div>
      <div className={styles.right}>
        {driveState?.linked && (
          <>
            <span className={styles.syncIndicator}>
              <span className={`${styles.syncDot} ${styles[driveState.lastStatus]}`} aria-hidden="true" />
              {SYNC_LABEL[driveState.lastStatus]}
              {driveState.lastStatus === 'synced' && driveState.lastSyncedAt && ` ${formatRelativeTime(driveState.lastSyncedAt)}`}
            </span>
            <span className={styles.sep} />
          </>
        )}
        {backdrops.length > 0 && (
          <>
            <Stat label="Backdrops" value={backdrops.length} />
            <span className={styles.sep} />
          </>
        )}
        {total > 0 && (
          <>
            <Stat label="Cards"    value={total} />
            <span className={styles.sep} />
            <Stat label="Entities" value={entities.length} />
            {drafts > 0 && (
              <>
                <span className={styles.sep} />
                <Stat label="Drafts" value={drafts} muted />
              </>
            )}
          </>
        )}
      </div>
    </footer>
  )
}

function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <span className={`${styles.stat} ${muted ? styles.muted : ''}`}>
      <span className={styles.statVal}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </span>
  )
}
