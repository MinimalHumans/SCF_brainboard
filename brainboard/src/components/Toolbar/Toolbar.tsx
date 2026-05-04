import React, { useState, useRef } from 'react'
import { useBoardStore }      from '@/store/boardStore'
import { useViewerStore }     from '@/store/viewerStore'
import { useHistoryStore }    from '@/store/historyStore'
import { useThemeStore }      from '@/store/themeStore'
import { ProjectInfoPopover } from './ProjectInfoPopover'
import styles                 from './Toolbar.module.css'

interface ToolbarProps {
  onExport?:          () => void
  onImport?:          () => void
  onTemplates?:       () => void
  onOutline?:         () => void
  onHelp?:            () => void
  onNewBoard?:        () => void
}

export function Toolbar({
  onExport,
  onImport,
  onTemplates,
  onOutline,
  onHelp,
  onNewBoard,
}: ToolbarProps) {
  const boardName   = useBoardStore(s => s.board.name)
  const zoom        = useBoardStore(s => s.board.viewport.zoom)
  const requestZoom = useViewerStore(s => s.requestZoom)
  const undo        = useBoardStore(s => s.undo)
  const redo        = useBoardStore(s => s.redo)
  const canUndo     = useHistoryStore(s => s.canUndo())
  const canRedo     = useHistoryStore(s => s.canRedo())
  const theme       = useThemeStore(s => s.theme)
  const toggleTheme = useThemeStore(s => s.toggle)

  const boardNameBtnRef              = useRef<HTMLButtonElement>(null)
  const [showPopover, setShowPopover] = useState(false)

  const zoomPct = Math.round(zoom * 100)

  return (
    <header className={styles.toolbar}>
      <div className={styles.left}>
        <span className={`${styles.wordmark} text-display`}>Brainboard</span>
        <span className={styles.divider} aria-hidden="true" />

        {/* Board name — click opens project info popover */}
        <button
          ref={boardNameBtnRef}
          className={styles.boardName}
          onClick={() => setShowPopover(v => !v)}
          title="Project settings"
        >
          {boardName}
        </button>

        {showPopover && (
          <ProjectInfoPopover
            anchorRef={boardNameBtnRef}
            onClose={() => setShowPopover(false)}
          />
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
        {/* Day / Night toggle */}
        <button
          className={styles.themeToggle}
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>

      <div className={styles.right}>
        <button className={styles.action} onClick={onNewBoard} title="New blank board">New Board</button>
        <button className={styles.action} onClick={onImport}>Import</button>
        <button className={styles.action} onClick={onExport}>Export</button>
        <button className={styles.action} onClick={onTemplates}>Templates</button>
        <button className={styles.action} onClick={onOutline}>Outline</button>
        <button className={styles.helpBtn} onClick={onHelp} aria-label="Help">?</button>
      </div>
    </header>
  )
}

/* ── Icons ───────────────────────────────────────────────────────────────── */

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r="3" stroke="currentColor" strokeWidth="1.4"/>
      <line x1="7.5" y1="1"   x2="7.5" y2="2.5"  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="7.5" y1="12.5" x2="7.5" y2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="1"   y1="7.5" x2="2.5"  y2="7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="12.5" y1="7.5" x2="14" y2="7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="3.2"  y1="3.2"  x2="4.2"  y2="4.2"  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="10.8" y1="10.8" x2="11.8" y2="11.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="10.8" y1="3.2"  x2="11.8" y2="2.2"  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="3.2"  y1="10.8" x2="2.2"  y2="11.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M12.5 8.5A6 6 0 0 1 5.5 1.5a5.5 5.5 0 1 0 7 7z"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
