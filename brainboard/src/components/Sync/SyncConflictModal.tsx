import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ConflictSummary } from '@/lib/sync/types'
import { formatDateTime } from '@/lib/sync/formatTime'
import styles from './SyncModal.module.css'

interface SyncConflictModalProps {
  conflict: ConflictSummary
  onResolve: (action: 'overwrite-local' | 'keep-local-copy' | 'cancel') => void
}

export function SyncConflictModal({ conflict, onResolve }: SyncConflictModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onResolve('cancel') }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onResolve])

  return createPortal(
    <div className={styles.overlay} onClick={() => onResolve('cancel')}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-label="Drive sync conflict">
        <div className={styles.title}>Drive sync conflict</div>
        <p className={styles.body}>
          This board changed on this device and in Google Drive since the last
          sync. Choose which version to keep — nothing is deleted either way.
        </p>

        <div className={styles.comparison}>
          <div className={styles.side}>
            <div className={styles.sideLabel}>This device</div>
            <div className={styles.sideName}>{conflict.local.name}</div>
            <div className={styles.sideMeta}>Updated {formatDateTime(conflict.local.updatedAt)}</div>
          </div>
          <div className={styles.side}>
            <div className={styles.sideLabel}>Google Drive</div>
            <div className={styles.sideName}>{conflict.remote.name}</div>
            <div className={styles.sideMeta}>Updated {formatDateTime(conflict.remote.updatedAt)}</div>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => onResolve('overwrite-local')}>
            Use Drive's version — replace this device's board
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => onResolve('keep-local-copy')}>
            Keep this device's version — save as a separate Drive backup
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => onResolve('cancel')}>
            Decide later
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
