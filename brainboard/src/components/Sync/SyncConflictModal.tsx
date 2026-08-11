import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ConflictSummary } from '@/lib/sync/types'
import { formatDateTime } from '@/lib/sync/formatTime'
import styles from './SyncModal.module.css'

interface SyncConflictModalProps {
  conflict:      ConflictSummary
  conflictCount: number
  onResolve:     (action: 'overwrite-local' | 'keep-local-copy' | 'cancel', applyToAll?: boolean) => void
}

export function SyncConflictModal({ conflict, conflictCount, onResolve }: SyncConflictModalProps) {
  const [applyToAll, setApplyToAll] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onResolve('cancel') }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onResolve])

  const resolve = (action: 'overwrite-local' | 'keep-local-copy' | 'cancel') => onResolve(action, applyToAll)

  return createPortal(
    <div className={styles.overlay} onClick={() => resolve('cancel')}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-label="Drive sync conflict">
        <div className={styles.title}>Drive sync conflict — "{conflict.local.name}"</div>
        <p className={styles.body}>
          This board changed on this device and in Google Drive since the last
          sync. Choose which version to keep — nothing is deleted either way.
        </p>

        <div className={styles.comparison}>
          <div className={styles.side}>
            <div className={styles.sideLabel}>This device</div>
            <div className={styles.sideName}>{conflict.local.name}</div>
            <div className={styles.sideMeta}>Updated {formatDateTime(conflict.local.updatedAt)}</div>
            {(conflict.local.version !== null || conflict.local.clientLabel) && (
              <div className={styles.sideMeta}>
                {conflict.local.version !== null && `v${conflict.local.version}`}
                {conflict.local.version !== null && conflict.local.clientLabel && ' · '}
                {conflict.local.clientLabel}
              </div>
            )}
          </div>
          <div className={styles.side}>
            <div className={styles.sideLabel}>Google Drive</div>
            <div className={styles.sideName}>{conflict.remote.name}</div>
            <div className={styles.sideMeta}>Updated {formatDateTime(conflict.remote.updatedAt)}</div>
            {(conflict.remote.version !== null || conflict.remote.clientLabel) && (
              <div className={styles.sideMeta}>
                {conflict.remote.version !== null && `v${conflict.remote.version}`}
                {conflict.remote.version !== null && conflict.remote.clientLabel && ' · '}
                {conflict.remote.clientLabel}
              </div>
            )}
          </div>
        </div>

        {conflictCount > 1 && (
          <div className={styles.applyAllRow}>
            <label className={styles.applyAllLabel}>
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={e => setApplyToAll(e.target.checked)}
              />
              Apply to all {conflictCount} conflicts
            </label>
          </div>
        )}

        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => resolve('overwrite-local')}>
            Use Drive's version — replace this device's board
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => resolve('keep-local-copy')}>
            Keep this device's version — save as a separate Drive backup
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => resolve('cancel')}>
            Decide later
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
