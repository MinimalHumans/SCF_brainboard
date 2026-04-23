import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useBoardStore } from '@/store/boardStore'
import { useViewerStore } from '@/store/viewerStore'
import styles from './Toolbar.module.css'

interface ToolbarProps {
  hasSelection?:      boolean
  onPublishAll?:      () => void
  onPublishSelected?: () => void
  onExport?:          () => void
  onImport?:          () => void
  onTemplates?:       () => void
  onHelp?:            () => void
  onNewBoard?:        () => void
}

export function Toolbar({
  hasSelection     = false,
  onPublishAll,
  onPublishSelected,
  onExport,
  onImport,
  onTemplates,
  onHelp,
  onNewBoard,
}: ToolbarProps) {
  const boardName    = useBoardStore(s => s.board.name)
  const zoom         = useBoardStore(s => s.board.viewport.zoom)
  const setBoardName = useBoardStore(s => s.setBoardName)
  const requestZoom  = useViewerStore(s => s.requestZoom)

  const [isRenaming, setIsRenaming] = useState(false)
  const [draft, setDraft]           = useState('')
  const inputRef                    = useRef<HTMLInputElement>(null)

  const startRename = useCallback(() => {
    setDraft(boardName)
    setIsRenaming(true)
  }, [boardName])

  useEffect(() => {
    if (isRenaming) requestAnimationFrame(() => inputRef.current?.select())
  }, [isRenaming])

  const commitRename = useCallback(() => {
    const t = draft.trim()
    if (t) setBoardName(t)
    setIsRenaming(false)
  }, [draft, setBoardName])

  const cancelRename = useCallback(() => setIsRenaming(false), [])

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitRename() }
    if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
  }, [commitRename, cancelRename])

  const zoomPct = Math.round(zoom * 100)

  return (
    <header className={styles.toolbar}>
      {/* Left: wordmark + board name */}
      <div className={styles.left}>
        <span className={`${styles.wordmark} text-display`}>Brainboard</span>
        <span className={styles.divider} aria-hidden="true" />
        {isRenaming ? (
          <input
            ref={inputRef}
            className={styles.renameInput}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKeyDown}
            maxLength={80}
            aria-label="Board name"
          />
        ) : (
          <button className={styles.boardName} onClick={startRename} title="Click to rename">
            {boardName}
          </button>
        )}
      </div>

      {/* Center: zoom HUD */}
      <div className={styles.center}>
        <div className={styles.zoomHud}>
          <button className={styles.zoomBtn} onClick={() => requestZoom({ type: 'out' })} title="Zoom out">−</button>
          <button className={styles.zoomPct} onClick={() => requestZoom({ type: 'reset' })} title="Reset zoom">
            {zoomPct}%
          </button>
          <button className={styles.zoomBtn} onClick={() => requestZoom({ type: 'in' })} title="Zoom in">+</button>
        </div>
      </div>

      {/* Right: actions */}
      <div className={styles.right}>
        <button className={styles.newBoardBtn} onClick={onNewBoard} title="Create a blank board (current board will be lost)">New Board</button>
        <button className={styles.action} onClick={onImport}    title="Import board from file">Import</button>
        <button className={styles.action} onClick={onExport}    title="Export board to file">Export</button>
        <button className={styles.templatesBtn} onClick={onTemplates} title="Browse templates">Templates</button>

        <div className={styles.publishGroup}>
          {hasSelection && onPublishSelected && (
            <button className={styles.action} onClick={onPublishSelected}>Publish Selected</button>
          )}
          <button
            className={`${styles.action} ${styles.publishAll}`}
            onClick={onPublishAll}
            disabled={!onPublishAll}
          >
            Publish All
          </button>
        </div>

        <button className={styles.helpBtn} onClick={onHelp} title="Help & keyboard shortcuts" aria-label="Help">
          ?
        </button>
      </div>
    </header>
  )
}
