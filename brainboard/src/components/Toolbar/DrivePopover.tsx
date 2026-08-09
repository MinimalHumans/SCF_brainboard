import React, { useRef, useState, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import type { ProviderSyncState } from '@/lib/sync/types'
import { formatRelativeTime } from '@/lib/sync/formatTime'
import styles from './DrivePopover.module.css'

interface DrivePopoverProps {
  anchorRef:   React.RefObject<HTMLElement>
  driveState:  ProviderSyncState
  onLink:      () => void
  onUnlink:    () => void
  onCheckNow:  () => Promise<void>
  onClose:     () => void
}

const STATUS_LABEL: Record<ProviderSyncState['lastStatus'], string> = {
  idle:            'Not synced yet',
  syncing:         'Syncing…',
  synced:          'Synced',
  conflict:        'Sync conflict — needs your input',
  'deleted-remote':'Drive backup missing — needs your input',
  error:           'Sync error',
}

export function DrivePopover({ anchorRef, driveState, onLink, onUnlink, onCheckNow, onClose }: DrivePopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 52, left: 0 })
  const [checking, setChecking] = useState(false)

  const needsAttention = driveState.lastStatus === 'conflict' || driveState.lastStatus === 'deleted-remote'
  const checkLabel = checking
    ? 'Checking…'
    : driveState.lastStatus === 'conflict'        ? 'Review conflict'
    : driveState.lastStatus === 'deleted-remote'   ? 'Review missing backup'
    : 'Sync now'

  const handleCheckNow = async () => {
    setChecking(true)
    try { await onCheckNow() } finally { setChecking(false) }
  }

  useLayoutEffect(() => {
    const el = anchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const PAD = 8
    const W   = 280
    const left = Math.max(PAD, Math.min(rect.right - W, window.innerWidth - W - PAD))
    setPos({ top: rect.bottom + 4, left })
  }, [anchorRef])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    document.addEventListener('keydown',     onKeyDown,     { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
      document.removeEventListener('keydown',     onKeyDown,     { capture: true })
    }
  }, [onClose])

  return createPortal(
    <div
      ref={popoverRef}
      className={styles.popover}
      style={{ top: pos.top, left: pos.left }}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div className={styles.title}>Google Drive</div>

      {!driveState.linked ? (
        <>
          <p className={styles.note}>
            Back up your board to your Google Drive so it follows you across
            devices. Your board stays local first — Drive is a backup, not a
            requirement.
          </p>
          <button type="button" className={styles.connectBtn} onClick={onLink}>
            Connect Drive
          </button>
        </>
      ) : (
        <>
          <div className={styles.statusRow}>
            <span className={`${styles.dot} ${styles[driveState.lastStatus]}`} aria-hidden="true" />
            <span className={styles.statusText}>{STATUS_LABEL[driveState.lastStatus]}</span>
          </div>
          {driveState.lastSyncedAt && (
            <p className={styles.note}>Last synced {formatRelativeTime(driveState.lastSyncedAt)}.</p>
          )}
          {driveState.lastStatus === 'error' && driveState.lastError && (
            <p className={styles.errorNote}>{driveState.lastError}</p>
          )}
          <p className={styles.note}>
            Stored in your Drive's hidden app-data area — it won't show up in
            your regular Drive file list.
          </p>
          <button
            type="button"
            className={needsAttention ? styles.connectBtn : styles.unlinkBtn}
            onClick={handleCheckNow}
            disabled={checking}
          >
            {checkLabel}
          </button>
          <button type="button" className={styles.unlinkBtn} onClick={onUnlink}>
            Unlink Drive
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
