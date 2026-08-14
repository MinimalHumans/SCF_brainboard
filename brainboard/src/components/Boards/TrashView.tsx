import { useState } from 'react'
import { useLibraryStore } from '@/store/libraryStore'
import { useTrashStore } from '@/store/trashStore'
import { trashedItemsOf } from '@/lib/boardSummary'
import { formatRelativeTime } from '@/lib/sync/formatTime'
import { HoldToConfirmButton } from '@/components/common/HoldToConfirmButton'
import { toast } from '@/store/toastStore'
import type { useBoardLibrary } from '@/hooks/useBoardLibrary'
import type { useDriveSync } from '@/hooks/useDriveSync'
import type { BoardSummary } from '@/lib/opfs/opfsStorage'
import styles from './BoardsModal.module.css'

// Deletions inside the trash view charge faster than the app-wide default
// hold — the user is already in an explicitly destructive context, so the
// confirmation should feel snappier, not ceremonial.
const TRASH_HOLD_MS = 450

interface TrashViewProps {
  /** Which trash this is — boards' or templates'. Parallel systems, same UI. */
  kind:    'board' | 'template'
  library: ReturnType<typeof useBoardLibrary>
  drive:   ReturnType<typeof useDriveSync>
  onBack:  () => void
}

/*
 * TrashView — rendered inside the Boards modal in place of the normal list
 * (no standalone trash page). Hosts the only two irreversible actions in
 * the app — per-row "Delete forever" and "Delete all now" — both behind
 * hold-to-confirm, plus individual restore and the single global retention
 * setting. Restores and permanent deletes go through the exact same
 * library/drive calls the main list uses.
 */
export function TrashView({ kind, library, drive, onBack }: TrashViewProps) {
  const boards = useLibraryStore(s => s.boards)
  const items  = trashedItemsOf(boards, kind)

  const retentionDays    = useTrashStore(s => s.retentionDays)
  const setRetentionDays = useTrashStore(s => s.setRetentionDays)
  // null = not being edited: the input shows the store value directly, so
  // outside changes (hydration finishing, the Drive mirror adopting another
  // device's value) flow straight through without an effect.
  const [retentionDraft, setRetentionDraft] = useState<string | null>(null)
  const retentionInput = retentionDraft ?? String(retentionDays)

  const commitRetention = () => {
    const days = Number(retentionInput)
    setRetentionDraft(null)
    if (Number.isFinite(days) && days >= 1) {
      setRetentionDays(days)
      // Mirror the change to Drive promptly rather than waiting for the
      // next full sync sweep.
      drive.syncTrashSettingsNow()
    }
  }

  const noun = kind === 'template' ? 'template' : 'board'

  const handleRestore = async (b: BoardSummary) => {
    await library.restoreBoard(b.boardId)
    drive.syncNowForBoard(b.boardId)
    toast.success(`Restored "${b.name}".`)
  }

  const destroyOne = async (b: BoardSummary) => {
    await drive.deleteRemoteForBoard(b.boardId)
    await library.deleteBoard(b.boardId)
  }

  const handleDestroy = async (b: BoardSummary) => {
    await destroyOne(b)
    toast.success(`Permanently deleted "${b.name}".`)
  }

  const handleDestroyAll = async () => {
    for (const b of items) await destroyOne(b)
    toast.success(items.length === 1
      ? `Permanently deleted 1 ${noun}.`
      : `Permanently deleted ${items.length} ${noun}s.`)
  }

  return (
    <div className={styles.body}>
      <div className={styles.trashControls}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          ← {kind === 'template' ? 'Templates' : 'Boards'}
        </button>
        <label className={styles.retentionLabel}>
          Auto-delete after
          <input
            className={styles.retentionInput}
            type="number"
            min={1}
            max={365}
            value={retentionInput}
            onChange={e => setRetentionDraft(e.target.value)}
            onBlur={commitRetention}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          />
          days
        </label>
        <div className={styles.tabFlex} />
        <HoldToConfirmButton
          duration={TRASH_HOLD_MS}
          disabled={items.length === 0}
          onConfirm={handleDestroyAll}
          title="Hold to permanently delete everything in the trash"
        >
          Delete all now
        </HoldToConfirmButton>
      </div>

      {items.length === 0 ? (
        <div className={styles.empty}>
          <p>The trash is empty.</p>
          <p className={styles.emptyHint}>Deleted {noun}s wait here for {retentionDays} days before being removed for good.</p>
        </div>
      ) : (
        <div className={styles.listScroll}>
          <ul className={styles.boardList}>
            {items.map(b => (
              <li key={b.boardId} className={`${styles.row} ${styles.trashRow}`}>
                <div className={styles.rowMain}>
                  <span className={styles.rowName}>{b.name}</span>
                  <span className={styles.rowMeta}>
                    <span>{b.cardCount ?? 0} card{(b.cardCount ?? 0) !== 1 ? 's' : ''}</span>
                    {(b.backdropCount ?? 0) > 0 && <span>{b.backdropCount} backdrop{b.backdropCount !== 1 ? 's' : ''}</span>}
                    {b.trashedAt && <span>Trashed {formatRelativeTime(b.trashedAt)}</span>}
                  </span>
                </div>
                <div className={styles.rowRight}>
                  <button
                    type="button"
                    className={styles.restoreBtn}
                    onClick={() => handleRestore(b)}
                    title={`Restore this ${noun}`}
                  >
                    Restore
                  </button>
                  <HoldToConfirmButton
                    duration={TRASH_HOLD_MS}
                    onConfirm={() => handleDestroy(b)}
                    title={`Hold to permanently delete this ${noun}`}
                  >
                    Delete forever
                  </HoldToConfirmButton>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
