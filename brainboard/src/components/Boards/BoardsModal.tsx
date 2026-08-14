import React, { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { nanoid } from 'nanoid'
import { useLibraryStore } from '@/store/libraryStore'
import { useDevModeStore } from '@/store/devModeStore'
import { useSyncStore, getProviderState } from '@/store/syncStore'
import { useBoardStore, touch } from '@/store/boardStore'
import { useTemplates } from '@/hooks/useTemplates'
import { SYNC_STATUS_LABEL } from '@/lib/sync/statusLabels'
import { formatRelativeTime } from '@/lib/sync/formatTime'
import { ContextMenu } from '@/components/ContextMenu/ContextMenu'
import type { ContextMenuItem } from '@/components/ContextMenu/ContextMenu'
import { ExportModal } from './ExportModal'
import { TrashView } from './TrashView'
import { trashedItemsOf } from '@/lib/boardSummary'
import { toast } from '@/store/toastStore'
import type { useBoardLibrary } from '@/hooks/useBoardLibrary'
import type { useDriveSync } from '@/hooks/useDriveSync'
import type { BoardSummary } from '@/lib/opfs/opfsStorage'
import type { ProviderSyncState } from '@/lib/sync/types'
import type { Board, Card, Entity, Backdrop } from '@/types/board'
import styles from './BoardsModal.module.css'

const PROVIDER_ID = 'google-drive'

/* ── Merge helper — appends a template's cards/entities/backdrops into the
   current board, offset so they don't land on top of existing content. ──── */

function mergeBoard(current: Board, templateBoard: Board): Board {
  const OFFSET = 300
  const cardIdMap     = new Map<string, string>()
  const entityIdMap   = new Map<string, string>()
  const backdropIdMap = new Map<string, string>()
  templateBoard.cards.forEach(c    => cardIdMap.set(c.id, nanoid()))
  templateBoard.entities.forEach(e => entityIdMap.set(e.id, nanoid()))
  ;(templateBoard.backdrops ?? []).forEach(b => backdropIdMap.set(b.id, nanoid()))

  const remappedCards: Card[] = templateBoard.cards.map(c => ({
    ...c, id: cardIdMap.get(c.id)!,
    entityId: c.entityId ? entityIdMap.get(c.entityId) ?? null : null,
    position: { x: c.position.x + OFFSET, y: c.position.y + OFFSET },
  }))
  const remappedEntities: Entity[] = templateBoard.entities.map(e => ({
    ...e, id: entityIdMap.get(e.id)!,
  }))
  const remappedBackdrops: Backdrop[] = (templateBoard.backdrops ?? []).map(b => ({
    note: '', ...b, id: backdropIdMap.get(b.id)!,
    position: { x: b.position.x + OFFSET, y: b.position.y + OFFSET },
  }))

  // touch() (not a manual updatedAt) so this bumps syncMeta.version like any
  // other content mutation — that's what marks a draft board as changed
  // (see src/lib/boardDraft.ts) and what the normal autosave path already
  // relies on for every other edit.
  return touch({
    ...current,
    cards:     [...current.cards, ...remappedCards],
    entities:  [...current.entities, ...remappedEntities],
    backdrops: [...(current.backdrops ?? []), ...remappedBackdrops],
  })
}

interface BoardsModalProps {
  onClose: () => void
  library: ReturnType<typeof useBoardLibrary>
  drive:   ReturnType<typeof useDriveSync>
}

type OuterTab     = 'boards' | 'templates'
type TemplatesTab = 'default' | 'user'

/*
 * BoardsModal — unified file-management home: the "Boards" list (create,
 * import, switch, rename, duplicate, export, delete, Drive sync) and
 * "Templates" (built-in + user-saved starting points) as two tabs of one
 * modal, since both are really "what board am I looking at" pickers. Google
 * Drive is a background service layered on top of the Boards tab (once
 * connected, boards link/sync/discover automatically — see
 * useDriveSync.syncAllBoards), not a per-board toggle.
 */
export function BoardsModal({ onClose, library, drive }: BoardsModalProps) {
  const [outerTab, setOuterTab] = useState<OuterTab>('boards')
  // Non-null while the trash of the current tab is open in place of the
  // normal list — no standalone trash page, it lives inside this modal.
  const [trashKind, setTrashKind] = useState<'board' | 'template' | null>(null)

  /* ── Boards tab state ───────────────────────────────────────────────── */

  const boards        = useLibraryStore(s => s.boards)
  const activeBoardId = useLibraryStore(s => s.activeBoardId)
  // Subscribe so per-board Drive badges update live (getProviderState alone
  // is a point-in-time read, not reactive).
  const syncBoards = useSyncStore(s => s.boards)
  // Google Drive isn't Google-approved yet — hide the connect entry point
  // from everyone except accounts that already linked it (so existing
  // connections keep working) or devMode testers (see AboutPopover.tsx).
  const devModeEnabled = useDevModeStore(s => s.enabled)
  const showDriveRow   = drive.accountLinked || devModeEnabled

  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [rowMenu, setRowMenu] = useState<{ boardId: string; x: number; y: number } | null>(null)
  const [exportTarget, setExportTarget] = useState<Board | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  /* ── Templates tab state ────────────────────────────────────────────── */

  const [templatesTab, setTemplatesTab] = useState<TemplatesTab>('default')
  // "My Templates" are just boards tagged kind:'template' — they live in the
  // same OPFS/library/Drive-sync pipeline as every other board (see
  // types/board.ts, useBoardLibrary.saveAsTemplate), so they sync for free.
  // Split out of the unified `boards` list by that tag rather than tracked
  // separately.
  const userTemplates = boards.filter(b => b.kind === 'template' && !b.trashed)
  const defaultTemplates = useTemplates()
  const board     = useBoardStore(s => s.board)
  const loadBoard = useBoardStore(s => s.loadBoard)

  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [editingTemplateValue, setEditingTemplateValue] = useState('')
  const [templateMenu, setTemplateMenu] = useState<{ boardId: string; x: number; y: number } | null>(null)

  // Opening the modal is a natural "check in" moment — sweep once so
  // anything linked/pushed from another device shows up without the user
  // having to do anything. Depends on the function itself (stable across
  // re-renders), not the whole `drive` object (a fresh object every render,
  // which would re-fire this on every keystroke/re-render).
  const syncAllBoards = drive.syncAllBoards
  useEffect(() => { syncAllBoards() }, [syncAllBoards])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || editingId || rowMenu || editingTemplateId || templateMenu || exportTarget) return
      // Escape backs out of the trash view first; a second Escape closes.
      if (trashKind) setTrashKind(null)
      else onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, editingId, rowMenu, editingTemplateId, templateMenu, exportTarget, trashKind])

  const sorted = boards
    .filter(b => b.kind !== 'template' && !b.trashed)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const trashedBoardCount    = trashedItemsOf(boards, 'board').length
  const trashedTemplateCount = trashedItemsOf(boards, 'template').length

  const startRename = (b: BoardSummary) => {
    setEditingId(b.boardId)
    setEditingValue(b.name)
  }
  const commitRename = (boardId: string) => {
    const name = editingValue.trim()
    setEditingId(null)
    if (name) library.renameBoard(boardId, name)
  }

  const handleSelect = async (b: BoardSummary) => {
    if (b.boardId === activeBoardId) { onClose(); return }
    // switchBoard may prompt to save/discard an unsaved draft first — only
    // close the picker if the switch actually went through.
    if (await library.switchBoard(b.boardId)) onClose()
  }

  const handleResolve = async (b: BoardSummary) => {
    // Switches to the board — switching re-runs reconcile for the now-active
    // board, which re-surfaces the conflict/deletion modal App.tsx already
    // renders for it. Closes the picker only once that switch has actually
    // happened (see handleSelect).
    if (b.boardId === activeBoardId) { onClose(); return }
    if (await library.switchBoard(b.boardId)) onClose()
  }

  // Deleting is an instant, unconfirmed move to the trash — it's reversible
  // (restore from the trash view), so no popup stands in the way. The Drive
  // copy isn't touched: the trashed flag is board content and syncs over,
  // hiding it on every device. Permanent deletion only ever happens from
  // the trash view or the retention sweep.
  const handleDelete = async (b: BoardSummary) => {
    await library.trashBoard(b.boardId)
    drive.syncNowForBoard(b.boardId)
    toast.success(`Moved "${b.name}" to the trash.`)
  }

  const handleExportRow = async (b: BoardSummary) => {
    const data = await library.getBoardData(b.boardId)
    if (!data) { toast.error("Couldn't export — board file is missing or corrupt."); return }
    setExportTarget(data)
  }

  /* ── File-drop import — drop a board JSON file anywhere on the modal to
     import it, same as the Import… button. dragCounter tracks nested
     enter/leave events (every child fires its own dragenter/dragleave as the
     pointer crosses it) so the overlay doesn't flicker while dragging over
     rows/cards inside the modal. ─────────────────────────────────────────── */
  const dragCounter = React.useRef(0)

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    if (!e.dataTransfer.types.includes('Files')) return
    dragCounter.current += 1
    setIsDragOver(true)
  }
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setIsDragOver(false)
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) library.importBoardFile(file)
  }

  const rowMenuItems = (b: BoardSummary): ContextMenuItem[] => [
    { label: 'Rename',    onClick: () => startRename(b) },
    { label: 'Duplicate', onClick: () => library.duplicateBoard(b.boardId) },
    { label: 'Export…',   onClick: () => handleExportRow(b) },
    { label: 'Move to Trash', divider: true, danger: true, onClick: () => handleDelete(b) },
  ]

  /* ── Default template actions ─────────────────────────────────────────── */

  const handleNewBoard = useCallback(async (templateBoard: Board) => {
    const fresh: Board = {
      ...templateBoard,
      boardId:   nanoid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      backdrops: (templateBoard.backdrops ?? []).map(b => ({ note: '', ...b })),
      // Loaded as a fresh draft (see adoptBoard) — must start at
      // syncMeta.version 0 so it reads as "unchanged" until the user
      // actually edits it, even if the template file itself carries
      // syncMeta from whatever board it was originally exported from.
      syncMeta: undefined,
      // A board created *from* a template is a normal board, not itself a
      // template — templateBoard may carry kind:'template' (My Templates
      // now are real boards under the hood), so this must be cleared
      // explicitly rather than inherited via the spread above.
      kind: undefined,
    }
    if (await library.adoptBoard(fresh)) {
      toast.success(`Loaded template "${templateBoard.name}"`)
      onClose()
    }
  }, [library, onClose])

  const handleMerge = useCallback((templateBoard: Board) => {
    loadBoard(mergeBoard(board, templateBoard))
    toast.success(`Merged "${templateBoard.name}" into current board`)
    onClose()
  }, [board, loadBoard, onClose])

  /* ── User template actions — "My Templates" are boards tagged
     kind:'template' (see useBoardLibrary.saveAsTemplate), so they sync to
     Drive through the normal board pipeline and these actions mostly just
     delegate to the same `library`/`drive` calls the Saved Boards tab uses. ── */

  const handleSaveCurrent = useCallback(async () => {
    const name = window.prompt('Name for this template:', board.name)
    if (!name || !name.trim()) return
    if (await library.saveAsTemplate(name.trim())) {
      toast.success(`Saved "${name.trim()}" to My Templates`)
      setTemplatesTab('user')
    }
  }, [board, library])

  const startTemplateRename = (t: BoardSummary) => {
    setEditingTemplateId(t.boardId)
    setEditingTemplateValue(t.name)
  }
  const commitTemplateRename = (boardId: string) => {
    const name = editingTemplateValue.trim()
    setEditingTemplateId(null)
    if (name) library.renameBoard(boardId, name)
  }

  // Same instant-trash as boards — templates get their own parallel trash
  // (separate entry point/count below), but the mechanics are identical.
  const handleDeleteUserTemplate = useCallback(async (boardId: string, name: string) => {
    await library.trashBoard(boardId)
    drive.syncNowForBoard(boardId)
    toast.success(`Moved template "${name}" to the trash.`)
  }, [drive, library])

  const templateMenuItems = (t: BoardSummary): ContextMenuItem[] => [
    { label: 'Rename', onClick: () => startTemplateRename(t) },
    { label: 'Move to Trash', divider: true, danger: true, onClick: () => handleDeleteUserTemplate(t.boardId, t.name) },
  ]

  // "New board" / "Merge" need the template's full content (cards/entities/
  // backdrops), not just the summary shown in the list — fetched on demand
  // via the same getBoardData the Export flow uses.
  const handleUserNewBoard = useCallback(async (t: BoardSummary) => {
    const data = await library.getBoardData(t.boardId)
    if (!data) { toast.error("Couldn't load template — its file is missing or corrupt."); return }
    handleNewBoard(data)
  }, [library, handleNewBoard])

  const handleUserMerge = useCallback(async (t: BoardSummary) => {
    const data = await library.getBoardData(t.boardId)
    if (!data) { toast.error("Couldn't load template — its file is missing or corrupt."); return }
    handleMerge(data)
  }, [library, handleMerge])

  /* ── Render ───────────────────────────────────────────────────────────── */

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Boards"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className={styles.dropOverlay}>
            <p>Drop board file to import</p>
          </div>
        )}
        <div className={styles.header}>
          <h2 className={styles.title}>
            {trashKind ? 'Trash' : outerTab === 'boards' ? 'Saved Boards' : 'Templates'}
          </h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.tabBar}>
          <button
            className={`${styles.tab} ${outerTab === 'boards' && !trashKind ? styles.tabActive : ''}`}
            onClick={() => { setOuterTab('boards'); setTrashKind(null) }}
          >
            Saved Boards
            <span className={styles.tabBadge}>{sorted.length}</span>
          </button>
          <button
            className={`${styles.tab} ${outerTab === 'templates' && !trashKind ? styles.tabActive : ''}`}
            onClick={() => { setOuterTab('templates'); setTrashKind(null) }}
          >
            Templates
            <span className={styles.tabBadge}>{defaultTemplates.length + userTemplates.length}</span>
          </button>
        </div>

        {trashKind ? (
          <TrashView kind={trashKind} library={library} drive={drive} onBack={() => setTrashKind(null)} />
        ) : outerTab === 'boards' ? (
          <div className={styles.body}>
            {/* Board list — the primary content. Local (OPFS) boards always
                work regardless of any cloud provider; sync is layered on top,
                not a prerequisite. New/Import are the same "add a board to the
                list" action from the user's perspective, so they share a row. */}
            <div className={styles.listHeader}>
              <button type="button" className={styles.newBtn} onClick={async () => { if (await library.createBoard()) onClose() }}>+ New Board</button>
              <button type="button" className={styles.importBtn} onClick={library.importBoard}>Import…</button>
              <button type="button" className={styles.importBtn} onClick={() => setExportTarget(board)} title="Export the current board">Export…</button>
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
                      <span className={styles.rowMeta}>
                        <span>{b.cardCount ?? 0} card{(b.cardCount ?? 0) !== 1 ? 's' : ''}</span>
                        {(b.backdropCount ?? 0) > 0 && <span>{b.backdropCount} backdrop{b.backdropCount !== 1 ? 's' : ''}</span>}
                        <span>Edited {formatRelativeTime(b.updatedAt)}</span>
                      </span>
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
                Drive is just the first. Hidden entirely for unlinked accounts
                outside devMode — see showDriveRow above. */}
            {showDriveRow && (
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
            )}

            {/* Trash entry point — a fixed-height footer whose link only
                appears when there's something in the trash, so the modal
                never jumps at the 0→1 transition. */}
            <div className={styles.trashFooter}>
              {trashedBoardCount > 0 && (
                <button type="button" className={styles.trashLink} onClick={() => setTrashKind('board')}>
                  {trashedBoardCount} item{trashedBoardCount !== 1 ? 's' : ''} in trash
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.templatesBody}>
            <div className={styles.subTabBar}>
              <button
                className={`${styles.subTab} ${templatesTab === 'default' ? styles.subTabActive : ''}`}
                onClick={() => setTemplatesTab('default')}
              >
                Built-in
                <span className={styles.tabBadge}>{defaultTemplates.length}</span>
              </button>
              <button
                className={`${styles.subTab} ${templatesTab === 'user' ? styles.subTabActive : ''}`}
                onClick={() => setTemplatesTab('user')}
              >
                My Templates
                <span className={styles.tabBadge}>{userTemplates.length}</span>
              </button>
              <div className={styles.tabFlex} />
              <button className={styles.saveBtn} onClick={handleSaveCurrent} title="Save the current board as a new template">
                + New from current board
              </button>
            </div>

            <div className={styles.templatesScroll}>
              {templatesTab === 'default' ? (
                defaultTemplates.length === 0
                  ? <EmptyState msg="No built-in templates found." hint="Place .json files in src/templates/ and restart." />
                  : <div className={styles.grid}>
                      {defaultTemplates.map(t => (
                        <DefaultCard key={t.id} t={t} onNew={handleNewBoard} onMerge={handleMerge} />
                      ))}
                    </div>
              ) : (
                userTemplates.length === 0
                  ? <EmptyState msg="No saved templates yet." hint='Use "New from current board" above to add one.' />
                  : <div className={styles.grid}>
                      {userTemplates.map(t => (
                        <UserCard
                          key={t.boardId}
                          t={t}
                          isEditing={editingTemplateId === t.boardId}
                          editingValue={editingTemplateValue}
                          onEditingValueChange={setEditingTemplateValue}
                          onCommitRename={() => commitTemplateRename(t.boardId)}
                          onCancelRename={() => setEditingTemplateId(null)}
                          onNew={handleUserNewBoard}
                          onMerge={handleUserMerge}
                          onOpenMenu={(x, y) => setTemplateMenu({ boardId: t.boardId, x, y })}
                        />
                      ))}
                    </div>
              )}
            </div>

            {/* Same fixed-height footer-link pattern as the boards tab —
                templates have their own parallel trash and count. */}
            <div className={`${styles.trashFooter} ${styles.trashFooterTemplates}`}>
              {trashedTemplateCount > 0 && (
                <button type="button" className={styles.trashLink} onClick={() => setTrashKind('template')}>
                  {trashedTemplateCount} template{trashedTemplateCount !== 1 ? 's' : ''} in trash
                </button>
              )}
            </div>
          </div>
        )}
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

      {templateMenu && (() => {
        const t = userTemplates.find(x => x.boardId === templateMenu.boardId)
        if (!t) return null
        return (
          <ContextMenu
            x={templateMenu.x}
            y={templateMenu.y}
            items={templateMenuItems(t)}
            onClose={() => setTemplateMenu(null)}
          />
        )
      })()}

      {exportTarget && <ExportModal board={exportTarget} onClose={() => setExportTarget(null)} />}
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

/* ── Template sub-components ────────────────────────────────────────────── */

function DefaultCard({ t, onNew, onMerge }: {
  t: ReturnType<typeof useTemplates>[number]
  onNew:   (b: Board) => void
  onMerge: (b: Board) => void
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardName}>{t.name}</span>
      </div>
      <div className={styles.cardMeta}>
        <span>{t.cardCount} card{t.cardCount !== 1 ? 's' : ''}</span>
        {t.backdropCount > 0 && <span>{t.backdropCount} backdrop{t.backdropCount !== 1 ? 's' : ''}</span>}
      </div>
      <div className={styles.cardActions}>
        <button className={styles.actionMerge} onClick={() => onMerge(t.board)} title="Append to current board">Merge into current</button>
        <button className={styles.actionNew}   onClick={() => onNew(t.board)}   title="Replace current board">New board</button>
      </div>
    </div>
  )
}

function UserCard({
  t, isEditing, editingValue, onEditingValueChange, onCommitRename, onCancelRename,
  onNew, onMerge, onOpenMenu,
}: {
  t:        BoardSummary
  isEditing: boolean
  editingValue: string
  onEditingValueChange: (v: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onNew:    (t: BoardSummary) => void
  onMerge:  (t: BoardSummary) => void
  onOpenMenu: (x: number, y: number) => void
}) {
  const savedDate = new Date(t.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const cards     = t.cardCount ?? 0
  const bds       = t.backdropCount ?? 0

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        {isEditing ? (
          <input
            className={styles.nameInput}
            value={editingValue}
            autoFocus
            onChange={e => onEditingValueChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') onCommitRename()
              if (e.key === 'Escape') onCancelRename()
            }}
          />
        ) : (
          <span className={styles.cardName}>{t.name}</span>
        )}
        <button
          type="button"
          className={styles.kebabBtn}
          aria-label="Template options"
          onClick={e => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            onOpenMenu(r.left, r.bottom + 4)
          }}
        >
          ⋮
        </button>
      </div>
      <div className={styles.cardMeta}>
        <span>{cards} card{cards !== 1 ? 's' : ''}</span>
        {bds > 0 && <span>{bds} backdrop{bds !== 1 ? 's' : ''}</span>}
        <span className={styles.cardDate}>{savedDate}</span>
      </div>
      <div className={styles.cardActions}>
        <button className={styles.actionMerge} onClick={() => onMerge(t)} title="Append to current board">Merge into current</button>
        <button className={styles.actionNew}   onClick={() => onNew(t)}   title="Replace current board">New board</button>
      </div>
    </div>
  )
}

function EmptyState({ msg, hint }: { msg: string; hint: string }) {
  return (
    <div className={styles.empty}>
      <p>{msg}</p>
      <p className={styles.emptyHint}>{hint}</p>
    </div>
  )
}
