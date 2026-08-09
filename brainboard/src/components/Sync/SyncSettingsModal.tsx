import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ProviderSyncState } from '@/lib/sync/types'
import { SYNC_STATUS_LABEL } from '@/lib/sync/statusLabels'
import { formatRelativeTime } from '@/lib/sync/formatTime'
import styles from './SyncSettingsModal.module.css'

interface SyncSettingsModalProps {
  driveState:  ProviderSyncState
  onLink:      () => void
  onUnlink:    () => void
  onCheckNow:  () => Promise<void>
  onClose:     () => void
}

/*
 * SyncSettingsModal — the "Sync" menu's home. Lists every sync provider (just
 * Google Drive today; the row layout is what lets a second provider slot in
 * later without restructuring). Centered-overlay modal rather than an
 * anchored popover so it matches every other Toolbar menu (Templates, Help,
 * Outline, Export) instead of being the one outlier.
 */
export function SyncSettingsModal({ driveState, onLink, onUnlink, onCheckNow, onClose }: SyncSettingsModalProps) {
  const [checking, setChecking] = useState(false)

  const needsAttention = driveState.lastStatus === 'conflict' || driveState.lastStatus === 'deleted-remote'
  const checkLabel = checking
    ? 'Checking…'
    : driveState.lastStatus === 'conflict'      ? 'Review conflict'
    : driveState.lastStatus === 'deleted-remote' ? 'Review missing backup'
    : 'Sync now'

  const handleCheckNow = async () => {
    setChecking(true)
    try { await onCheckNow() } finally { setChecking(false) }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-label="Sync">

        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Sync</h2>
            <p className={styles.subtitle}>
              Back up your board to a cloud provider so it follows you across devices.
            </p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.body}>
          <div className={styles.providerRow}>
            <div className={styles.providerInfo}>
              <div className={styles.providerName}>Google Drive</div>
              {driveState.linked ? (
                <div className={styles.statusRow}>
                  <span className={`${styles.dot} ${styles[driveState.lastStatus]}`} aria-hidden="true" />
                  <span className={styles.statusText}>{SYNC_STATUS_LABEL[driveState.lastStatus]}</span>
                  {driveState.lastStatus === 'synced' && driveState.lastSyncedAt && (
                    <span className={styles.statusTime}>· {formatRelativeTime(driveState.lastSyncedAt)}</span>
                  )}
                </div>
              ) : (
                <div className={styles.statusRow}>
                  <span className={`${styles.dot} ${styles.idle}`} aria-hidden="true" />
                  <span className={styles.statusText}>Not connected</span>
                </div>
              )}
            </div>

            <div className={styles.providerActions}>
              {!driveState.linked ? (
                <button type="button" className={styles.connectBtn} onClick={onLink}>
                  Connect
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={needsAttention ? styles.connectBtn : styles.unlinkBtn}
                    onClick={handleCheckNow}
                    disabled={checking}
                  >
                    {checkLabel}
                  </button>
                  <button type="button" className={styles.unlinkBtn} onClick={onUnlink}>
                    Unlink
                  </button>
                </>
              )}
            </div>
          </div>

          {driveState.lastStatus === 'error' && driveState.lastError && (
            <p className={styles.errorNote}>{driveState.lastError}</p>
          )}

          <p className={styles.note}>
            {driveState.linked
              ? "Stored in your Drive's hidden app-data area — it won't show up in your regular Drive file list."
              : 'Your board stays local first — Drive is a backup, not a requirement.'}
          </p>

          <p className={styles.comingSoon}>More providers coming soon.</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
