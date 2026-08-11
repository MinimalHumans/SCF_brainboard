import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLibraryStore } from '@/store/libraryStore'
import { useSyncStore, getProviderState } from '@/store/syncStore'
import { SYNC_STATUS_LABEL } from '@/lib/sync/statusLabels'
import { formatRelativeTime } from '@/lib/sync/formatTime'
import { ContextMenu } from '@/components/ContextMenu/ContextMenu'
import type { ContextMenuItem } from '@/components/ContextMenu/ContextMenu'
import type { useBoardLibrary } from '@/hooks/useBoardLibrary'
import type { useDriveSync } from '@/hooks/useDriveSync'
import type { BoardSummary } from '@/lib/opfs/opfsStorage'
import type { ProviderSyncState } from '@/lib/sync/types'
import styles from './BoardsModal.module.css'

const PROVIDER_ID = 'google-drive'

interface BoardsModalProps {
  onClose: () => void
  library: ReturnType<typeof useBoardLibrary>
  drive:   ReturnType<typeof useDriveSync>
}

/*
 * BoardsModal — the "Boards" menu's home. One unified list of every local
 * board; Google Drive is a background service layered on top (once
 * connected, boards link/sync/discover automatically — see
 * useDriveSync.syncAllBoards), not a per-board toggle. Clicking a row loads
 * that board; everything else (rename/duplicate/export/delete) lives behind
 * the row's ⋮ menu so the list reads as a picker, not a button grid.
 */
export function BoardsModal({ onClose, library, drive }: BoardsModalProps) {
  const boards        = useLibraryStore(s => s.boards)
  const activeBoardId = useLibraryStore(s => s.activeBoardId)
  // Subscribe so per-board Drive badges update live (getProviderState alone
  // is a point-in-time read, not reactive).
  const syncBoards = useSyncStore(s => s.boards)

  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [rowMenu, setRowMenu] = useState<{ boardId: string; x: number; y: number } | null>(null)

  // Opening the modal is a natural "check in" moment — sweep once so
  // anything linked/pushed from another device shows up without the user
  // having to do anything. Depends on the function itself (stable across
  // re-renders), not the whole `drive` object (a fresh object every render,
  // which would re-fire this on every keystroke/re-render).
  const syncAllBoards = drive.syncAllBoards
  useEffect(() => { syncAllBoards() }, [syncAllBoards])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editingId && !rowMenu) onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, editingId, rowMenu])

  const sorted = [...boards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const startRename = (b: BoardSummary) => {
    setEditingId(b.boardId)
    setEditingValue(b.name)
  }
  const commitRename = (boardId: string) => {
    const name = editingValue.trim()
    setEditingId(null)
    if (name) library.renameBoard(boardId, name)
  }

  const handleSelect = (b: BoardSummary) => {
    if (b.boardId !== activeBoardId) library.switchBoard(b.boardId)
    onClose()
  }

  const handleResolve = (b: BoardSummary) => {
    // Closes the picker and switches to the board — switching re-runs
    // reconcile for the now-active board, which re-surfaces the
    // conflict/deletion modal App.tsx already renders for it.
    onClose()
    if (b.boardId !== activeBoardId) library.switchBoard(b.boardId)
  }

  const handleDelete = async (b: BoardSummary) => {
    const state = getProviderState(b.boardId, PROVIDER_ID)
    const driveNote = state.linked ? ' Its Google Drive backup will be removed too.' : ''
    const ok = window.confirm(`Delete "${b.name}"? This can't be undone.${driveNote}`)
    if (!ok) return
    await drive.deleteRemoteForBoard(b.boardId)
    await library.deleteBoard(b.boardId)
  }

  const rowMenuItems = (b: BoardSummary): ContextMenuItem[] => [
    { label: 'Rename',    onClick: () => startRename(b) },
    { label: 'Duplicate', onClick: () => library.duplicateBoard(b.boardId) },
    { label: 'Export',    onClick: () => library.exportBoardById(b.boardId) },
    { label: 'Delete', divider: true, danger: true, onClick: () => handleDelete(b) },
  ]

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-label="Boards">
        <div className={styles.header}>
          <h2 className={styles.title}>Boards</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.body}>
          {/* Board list — the primary content. Local (OPFS) boards always
              work regardless of any cloud provider; sync is layered on top,
              not a prerequisite. New/Import are the same "add a board to the
              list" action from the user's perspective, so they share a row. */}
          <div className={styles.listHeader}>
            <button type="button" className={styles.newBtn} onClick={() => library.createBoard()}>+ New Board</button>
            <button type="button" className={styles.importBtn} onClick={library.importBoard}>Import…</button>
          </div>

          {/* Only this list scrolls — New/Import above and the cloud-sync
              line below stay put no matter how many boards there are. */}
          <div className={styles.listScroll}>
          <ul className={styles.boardList}>
            {sorted.map(b => {
              const driveState: ProviderSyncState = syncBoards[b.boardId]?.[PROVIDER_ID] ?? getProviderState(b.boardId, PROVIDER_ID)
              const isActive = b.boardId === activeBoardId
              return (
                <li
                  key={b.boardId}
                  className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
                  onClick={() => handleSelect(b)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') handleSelect(b) }}
                >
                  <div className={styles.rowMain}>
                    {editingId === b.boardId ? (
                      <input
                        className={styles.nameInput}
                        value={editingValue}
                        autoFocus
                        onClick={e => e.stopPropagation()}
                        onChange={e => setEditingValue(e.target.value)}
                        onBlur={() => commitRename(b.boardId)}
                        onKeyDown={e => {
                          // Must not bubble to the row's own onKeyDown
                          // (Enter there means "select this board") — without
                          // this, committing a rename also fired handleSelect,
                          // racing switchBoard's file read against the
                          // rename's write and closing the modal mid-edit.
                          e.stopPropagation()
                          if (e.key === 'Enter') commitRename(b.boardId)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                    ) : (
                      <span
                        className={styles.rowName}
                        onClick={e => { e.stopPropagation(); startRename(b) }}
                        title="Click to rename"
                      >
                        {b.name}
                      </span>
                    )}
                    <span className={styles.rowMeta}>Edited {formatRelativeTime(b.updatedAt)}</span>
                  </div>

                  <div className={styles.rowRight}>
                    <SyncIndicator
                      driveState={driveState}
                      accountLinked={drive.accountLinked}
                      onResolve={() => handleResolve(b)}
                    />
                    <button
                      type="button"
                      className={styles.kebabBtn}
                      aria-label="Board options"
                      onClick={e => {
                        e.stopPropagation()
                        const r = e.currentTarget.getBoundingClientRect()
                        setRowMenu({ boardId: b.boardId, x: r.left, y: r.bottom + 4 })
                      }}
                    >
                      ⋮
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          </div>

          {!library.canManageMultipleBoards && (
            <p className={styles.note}>
              Multiple boards need a browser with local file-system storage (OPFS) support.
            </p>
          )}

          {/* Cloud sync — secondary to local storage: a quiet line, not a
              full-width card, no divider setting it apart from the list
              above it. Status (left) and the connect/disconnect action
              (right) are separate elements — a single button that was both
              the status display and the toggle read as passive rather than
              interactive. Room for more provider rows to join later; Google
              Drive is just the first. */}
          <div className={styles.cloudSyncRow}>
            <span className={styles.cloudSyncStatus}>
              <GoogleDriveIcon />
              {drive.accountLinked ? (
                <>
                  <span className={styles.statusDot} aria-hidden="true" />
                  <span className={styles.cloudSyncText}>Connected to Google Drive</span>
                </>
              ) : (
                <span className={styles.cloudSyncTextMuted}>Google Drive Cloud Backup</span>
              )}
            </span>
            {drive.accountLinked ? (
              <button type="button" className={styles.disconnectBtn} onClick={drive.disconnectAccount}>
                Disconnect
              </button>
            ) : (
              <button type="button" className={styles.connectGhostBtn} onClick={drive.connectAccount}>
                Connect
              </button>
            )}
          </div>
        </div>
      </div>

      {rowMenu && (() => {
        const b = boards.find(x => x.boardId === rowMenu.boardId)
        if (!b) return null
        return (
          <ContextMenu
            x={rowMenu.x}
            y={rowMenu.y}
            items={rowMenuItems(b)}
            onClose={() => setRowMenu(null)}
          />
        )
      })()}
    </div>,
    document.body,
  )
}

/*
 * SyncIndicator — passive per-row Drive status. No icon at all when Drive
 * isn't connected or this board hasn't linked yet (nothing to show, nothing
 * to do). Conflict/deletion/error states are clickable — they hand off to
 * the same conflict/deletion modal App.tsx already renders for the active
 * board, by switching to this one.
 */
function SyncIndicator({ driveState, accountLinked, onResolve }: {
  driveState:     ProviderSyncState
  accountLinked:  boolean
  onResolve:      () => void
}) {
  if (!accountLinked || !driveState.linked) return null

  switch (driveState.lastStatus) {
    case 'synced':
      return <span className={styles.syncDotSynced} title="Synced" aria-hidden="true" />
    case 'syncing':
      return <span className={styles.spinner} title="Syncing…" aria-hidden="true" />
    case 'conflict':
    case 'deleted-remote':
    case 'error': {
      const title = driveState.lastStatus === 'error'
        ? (driveState.lastError ?? SYNC_STATUS_LABEL.error)
        : SYNC_STATUS_LABEL[driveState.lastStatus]
      return (
        <button
          type="button"
          className={styles.syncIconWarning}
          title={`${title} — click to resolve`}
          onClick={e => { e.stopPropagation(); onResolve() }}
        >
          ⚠
        </button>
      )
    }
    default:
      return null
  }
}

/*
 * GoogleDriveIcon — a simplified, stylized triangle mark (not a scan of the
 * official asset) that reads as "Drive" at a glance, matching how
 * ScriptyardIcon is its own custom illustration rather than an imported
 * brand file. Colours are intrinsic to the mark and intentionally fixed.
 */
function GoogleDriveIcon() {
  return (
    <svg width="15" height="14" viewBox="0 0 24 22" aria-hidden="true">
      <polygon points="12,2 7,10.5 12,13.3 17,10.5" fill="#FFC107" />
      <polygon points="7,10.5 2,19 12,19 12,13.3" fill="#1A73E8" />
      <polygon points="17,10.5 12,13.3 12,19 22,19" fill="#34A853" />
    </svg>
  )
}
