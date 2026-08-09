import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { DeletionSummary } from '@/lib/sync/types'
import { formatDateTime } from '@/lib/sync/formatTime'
import styles from './SyncModal.module.css'

interface SyncDeletionModalProps {
  deletion: DeletionSummary
  onResolve: (action: 'delete-local' | 'ignore' | 'reupload') => void
}

export function SyncDeletionModal({ deletion, onResolve }: SyncDeletionModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onResolve('ignore') }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onResolve])

  return createPortal(
    <div className={styles.overlay} onClick={() => onResolve('ignore')}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-label="Drive backup missing">
        <div className={styles.title}>Drive backup missing</div>
        <p className={styles.body}>
          {deletion.lastSyncedAt
            ? `This board's Drive backup (last synced ${formatDateTime(deletion.lastSyncedAt)}) is no longer in your Drive. It may have been removed from another device or manually deleted.`
            : "This board's Drive backup is no longer in your Drive. It may have been removed from another device or manually deleted."}
          {deletion.localDirty && ' Your local board has changes since that last sync.'}
        </p>

        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => onResolve('reupload')}>
            Re-upload this device's board as a new Drive backup
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => onResolve('ignore')}>
            Keep working locally — stop syncing this file
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => onResolve('delete-local')}>
            Delete this device's board
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
