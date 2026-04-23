import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useBoardStore } from '@/store/boardStore'
import { useViewerStore } from '@/store/viewerStore'
import { useHistoryStore } from '@/store/historyStore'
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

export function Toolbar({ hasSelection = false, onPublishAll, onPublishSelected, onExport, onImport, onTemplates, onHelp, onNewBoard }: ToolbarProps) {
  const boardName    = useBoardStore(s => s.board.name)
  const zoom         = useBoardStore(s => s.board.viewport.zoom)
  const setBoardName = useBoardStore(s => s.setBoardName)
  const requestZoom  = useViewerStore(s => s.requestZoom)
  const undo         = useBoardStore(s => s.undo)
  const redo         = useBoardStore(s => s.redo)
  const canUndo      = useHistoryStore(s => s.canUndo())
  const canRedo      = useHistoryStore(s => s.canRedo())

  const [isRenaming, setIsRenaming] = useState(false)
  const [draft, setDraft]           = useState('')
  const inputRef                    = useRef<HTMLInputElement>(null)

  const startRename = useCallback(() => { setDraft(boardName); setIsRenaming(true) }, [boardName])
  useEffect(() => { if (isRenaming) requestAnimationFrame(() => inputRef.current?.select()) }, [isRenaming])
  const commitRename = useCallback(() => { const t = draft.trim(); if (t) setBoardName(t); setIsRenaming(false) }, [draft, setBoardName])

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitRename() }
    if (e.key === 'Escape') { e.preventDefault(); setIsRenaming(false) }
  }, [commitRename])

  const zoomPct = Math.round(zoom * 100)

  return (
    <header className={styles.toolbar}>
      <div className={styles.left}>
        <span className={`${styles.wordmark} text-display`}>Brainboard</span>
        <span className={styles.divider} aria-hidden="true" />
        {isRenaming ? (
          <input ref={inputRef} className={styles.renameInput} value={draft}
            onChange={e => setDraft(e.target.value)} onBlur={commitRename}
            onKeyDown={handleRenameKeyDown} maxLength={80} aria-label="Board name" />
        ) : (
          <button className={styles.boardName} onClick={startRename} title="Click to rename">{boardName}</button>
        )}
      </div>

      <div className={styles.center}>
        <div className={styles.undoRedo}>
          <button className={styles.undoRedoBtn} onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">↩</button>
          <button className={styles.undoRedoBtn} onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">↪</button>
        </div>
        <div className={styles.zoomHud}>
          <button className={styles.zoomBtn} onClick={() => requestZoom({ type: 'out' })} title="Zoom out">−</button>
          <button className={styles.zoomPct} onClick={() => requestZoom({ type: 'reset' })} title="Reset zoom">{zoomPct}%</button>
          <button className={styles.zoomBtn} onClick={() => requestZoom({ type: 'in' })} title="Zoom in">+</button>
        </div>
      </div>

      <div className={styles.right}>
        <button className={styles.newBoardBtn} onClick={onNewBoard} title="New blank board">New Board</button>
        <button className={styles.action} onClick={onImport}>Import</button>
        <button className={styles.action} onClick={onExport}>Export</button>
        <button className={styles.templatesBtn} onClick={onTemplates}>Templates</button>
        <div className={styles.publishGroup}>
          {hasSelection && onPublishSelected && (
            <button className={styles.action} onClick={onPublishSelected}>Publish Selected</button>
          )}
          <button className={`${styles.action} ${styles.publishAll}`} onClick={onPublishAll} disabled={!onPublishAll}>
            Publish All
          </button>
        </div>
        <button className={styles.helpBtn} onClick={onHelp} aria-label="Help">?</button>
      </div>
    </header>
  )
}
