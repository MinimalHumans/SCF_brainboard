import React, { useState, useRef, useMemo } from 'react'
import { useBoardStore }      from '@/store/boardStore'
import { useViewerStore }     from '@/store/viewerStore'
import { useHistoryStore }    from '@/store/historyStore'
import { useThemeStore }      from '@/store/themeStore'
import { useLibraryStore }    from '@/store/libraryStore'
import { useSyncStore }       from '@/store/syncStore'
import { useMediaQuery }      from '@/hooks/useMediaQuery'
import { AboutPopover }       from './AboutPopover'
import { ProjectInfoPopover } from './ProjectInfoPopover'
import { ContextMenu }        from '@/components/ContextMenu/ContextMenu'
import type { ContextMenuItem } from '@/components/ContextMenu/ContextMenu'
import styles                 from './Toolbar.module.css'

const PROVIDER_ID = 'google-drive'

/*
 * At or below this width the toolbar collapses to its compact layout:
 *   - the wordmark drops to icon-only (still opens About),
 *   - the board name truncates harder (still opens Project Info),
 *   - the zoom HUD is dropped entirely (pinch-zoom + Frame All replace it),
 *   - undo/redo, the board actions (Boards / Outline), and the Day/Night
 *     toggle all move into the ⋯ overflow menu,
 *   - the center keeps only Frame All; the right keeps ⋯ and Help.
 *
 * 720px keeps tablets (768px+) on the full layout and collapses phones. It's a
 * JS media query rather than pure CSS so the popover/menu anchoring logic has
 * a single unambiguous source of truth, and it reacts live to resize — a
 * desktop window dragged below 720px collapses and restores automatically.
 */
const NARROW_QUERY = '(max-width: 720px)'

interface ToolbarProps {
  hasSelection?: boolean
  onPublishAll?: () => void
  onPublishSelected?: () => void
  onOutline?:   () => void
  onHelp?:      () => void
  onOpenBoards: () => void
}

export function Toolbar({
  hasSelection,
  onPublishAll,
  onPublishSelected,
  onOutline,
  onHelp,
  onOpenBoards,
}: ToolbarProps) {
  const isNarrow = useMediaQuery(NARROW_QUERY)

  const boardName    = useBoardStore(s => s.board.name)
  const zoom         = useBoardStore(s => s.board.viewport.zoom)
  // Draft = a blank New Board / template "New board" that hasn't been saved
  // yet (see src/lib/boardDraft.ts). hasDraftChanges mirrors the same
  // touch()-driven syncMeta.version signal boardDraft.ts uses, so the
  // button's grey/orange state always agrees with whether a save is
  // actually possible/needed right now.
  const isDraft         = useLibraryStore(s => s.isDraft)
  const hasDraftChanges = useBoardStore(s => (s.board.syncMeta?.version ?? 0) > 0)
  const requestZoom  = useViewerStore(s => s.requestZoom)
  const requestFrame = useViewerStore(s => s.requestFrame)
  const undo         = useBoardStore(s => s.undo)
  const redo         = useBoardStore(s => s.redo)
  const canUndo      = useHistoryStore(s => s.canUndo())
  const canRedo      = useHistoryStore(s => s.canRedo())
  const theme        = useThemeStore(s => s.theme)
  const toggleTheme  = useThemeStore(s => s.toggle)

  const boardNameBtnRef               = useRef<HTMLButtonElement>(null)
  const wordmarkBtnRef                = useRef<HTMLButtonElement>(null)
  const overflowBtnRef                = useRef<HTMLButtonElement>(null)
  const [showInfoPopover,   setShowInfoPopover]   = useState(false)
  const [showAboutPopover,  setShowAboutPopover]  = useState(false)
  const [overflowMenu,      setOverflowMenu]      = useState<{ x: number; y: number } | null>(null)

  // Aggregate Drive status across every board, not just the active one —
  // this is the one ambient signal outside the Boards modal, so it needs to
  // catch a conflict on a board you haven't opened yet. No badge at all
  // when the account isn't connected (nothing to report); worst status
  // wins: a conflict/error anywhere outranks "still syncing", which
  // outranks "all synced".
  const accountLinked  = useSyncStore(s => s.accounts[PROVIDER_ID] === true)
  const syncBoardsState = useSyncStore(s => s.boards)
  const libraryBoards   = useLibraryStore(s => s.boards)
  const boardsBadge = useMemo((): 'issue' | 'syncing' | 'synced' | null => {
    if (!accountLinked) return null
    let hasIssue = false, hasSyncing = false, hasSynced = false
    for (const b of libraryBoards) {
      const state = syncBoardsState[b.boardId]?.[PROVIDER_ID]
      if (!state?.linked) continue
      if (state.lastStatus === 'conflict' || state.lastStatus === 'deleted-remote' || state.lastStatus === 'error') hasIssue = true
      else if (state.lastStatus === 'syncing') hasSyncing = true
      else if (state.lastStatus === 'synced') hasSynced = true
    }
    if (hasIssue) return 'issue'
    if (hasSyncing) return 'syncing'
    if (hasSynced) return 'synced'
    return null
  }, [accountLinked, libraryBoards, syncBoardsState])

  const boardsBadgeTitle = boardsBadge === 'issue'
    ? 'One or more boards need attention — open Boards to review'
    : boardsBadge === 'syncing'
      ? 'Syncing…'
      : boardsBadge === 'synced'
        ? 'All boards synced'
        : undefined

  const zoomPct = Math.round(zoom * 100)

  // Open the overflow menu anchored below the ⋯ button. ContextMenu clamps
  // itself to the viewport (it's the same component used for right-click
  // anywhere), so anchoring at the button's left edge is fine even though the
  // button sits near the right edge of a phone screen.
  const openOverflow = () => {
    const r = overflowBtnRef.current?.getBoundingClientRect()
    setOverflowMenu(r ? { x: r.left, y: r.bottom + 4 } : { x: 0, y: 48 })
  }

  /*
   * Items for the compact overflow menu — exactly the controls hidden from the
   * narrow toolbar. Each tap closes the menu (ContextMenu fires onClick then
   * onClose), so repeated undo means reopening the menu; acceptable on a phone.
   * Export lives entirely inside the Boards modal now (its own "Export…"
   * button, plus a per-row ⋮ menu), so it isn't duplicated here.
   */
  const overflowItems: ContextMenuItem[] = [
    { label: 'Boards…', onClick: () => onOpenBoards() },
    { label: 'Undo', divider: true, onClick: () => undo(), disabled: !canUndo },
    { label: 'Redo', onClick: () => redo(), disabled: !canRedo },
    { label: 'Outline', divider: true, onClick: () => onOutline?.() },
    {
      label:   theme === 'dark' ? 'Light mode' : 'Dark mode',
      divider: true,
      onClick: () => toggleTheme(),
    },
  ]

  // Frame All — present in both layouts (the one center control kept on narrow).
  const frameButton = (
    <button
      className={styles.frameBtn}
      onClick={requestFrame}
      title="Frame all (F)"
      aria-label="Frame all"
    >
      <FrameIcon />
    </button>
  )

  // Help — present in both layouts.
  const helpButton = (
    <button className={styles.helpBtn} onClick={onHelp} aria-label="Help">?</button>
  )

  return (
    <header className={styles.toolbar}>
      <div className={styles.left}>
        <button
          ref={wordmarkBtnRef}
          className={`${styles.wordmark} ${styles.wordmarkBtn} text-display`}
          onClick={() => setShowAboutPopover(v => !v)}
          title="About Scriptyard"
        >
          <ScriptyardIcon />
          {!isNarrow && <span>Scriptyard</span>}
        </button>

        {showAboutPopover && (
          <AboutPopover
            anchorRef={wordmarkBtnRef}
            onClose={() => setShowAboutPopover(false)}
          />
        )}
        <span className={styles.divider} aria-hidden="true" />

        {/* Board name — click opens project info popover. Grey while this is
            a fresh, untouched draft (blank New Board / template "New board"
            nobody has edited yet); orange-bordered once it has changes and
            still needs a name to be saved (see src/lib/boardDraft.ts). */}
        <button
          ref={boardNameBtnRef}
          className={[
            styles.boardName,
            isNarrow ? styles.boardNameNarrow : '',
            isDraft && !hasDraftChanges ? styles.boardNameDraft     : '',
            isDraft && hasDraftChanges  ? styles.boardNameNeedsSave : '',
          ].filter(Boolean).join(' ')}
          onClick={() => setShowInfoPopover(v => !v)}
          title={isDraft && hasDraftChanges ? 'Set a name to save this new board' : 'Project settings'}
        >
          {boardName}
        </button>

        {showInfoPopover && (
          <ProjectInfoPopover
            anchorRef={boardNameBtnRef}
            onClose={() => setShowInfoPopover(false)}
          />
        )}
      </div>

      <div className={styles.center}>
        {isNarrow ? (
          frameButton
        ) : (
          <>
            <div className={styles.undoRedo}>
              <button className={styles.undoRedoBtn} onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">↩</button>
              <button className={styles.undoRedoBtn} onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">↪</button>
            </div>
            <div className={styles.zoomHud}>
              <button className={styles.zoomBtn} onClick={() => requestZoom({ type: 'out' })} title="Zoom out">−</button>
              <button className={styles.zoomPct} onClick={() => requestZoom({ type: 'reset' })} title="Reset zoom">{zoomPct}%</button>
              <button className={styles.zoomBtn} onClick={() => requestZoom({ type: 'in' })} title="Zoom in">+</button>
            </div>
            {frameButton}
            {/* Day / Night toggle */}
            <button
              className={styles.themeToggle}
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </>
        )}
      </div>

      <div className={styles.right}>
        {isNarrow ? (
          <>
            <button
              ref={overflowBtnRef}
              className={styles.overflowBtn}
              onClick={openOverflow}
              title="More"
              aria-label="More actions"
              aria-haspopup="menu"
            >
              <OverflowIcon />
            </button>
            {helpButton}
          </>
        ) : (
          <>
            <button
              className={`${styles.action} ${styles.syncBtn}`}
              onClick={onOpenBoards}
              title="Boards — manage and sync your boards"
            >
              Boards
              {boardsBadge && (
                <span
                  className={`${styles.syncBadge} ${styles[boardsBadge]}`}
                  title={boardsBadgeTitle}
                  aria-hidden="true"
                />
              )}
            </button>
            <button className={styles.action} onClick={onOutline}>Outline</button>
            {helpButton}
          </>
        )}
      </div>

      {overflowMenu && (
        <ContextMenu
          x={overflowMenu.x}
          y={overflowMenu.y}
          items={overflowItems}
          onClose={() => setOverflowMenu(null)}
        />
      )}
    </header>
  )
}

/* ── Icons ───────────────────────────────────────────────────────────────── */

/*
 * ScriptyardIcon — the three stacked, offset cards (red/green/amber) from the
 * brand mark. Inlined rather than imported as an asset so it bundles with the
 * other toolbar icons and inherits no external file dependency. Colours are
 * intrinsic to the brand and intentionally fixed (not currentColor).
 */
function ScriptyardIcon() {
  return (
    <svg
      className={styles.wordmarkIcon}
      viewBox="0 0 86.11 87.54"
      role="img"
      aria-label="Scriptyard"
      focusable="false"
    >
      <g>
        <g>
          <g>
            <path fill="#ece5da" d="M76.72,72.15l-48.95,13.43c-4.53,1.24-8.32-1.85-8.48-6.9l-1.12-36.39c-.16-5.05,3.39-10.15,7.91-11.39l48.95-13.43c4.53-1.24,8.32,1.85,8.48,6.9l1.12,36.39c.16,5.05-3.39,10.15-7.91,11.39Z"/>
            <path fill="#f4af3f" d="M76.78,73.79l-48.95,13.43c-5.33,1.46-9.81-2.19-10-8.13l-1.12-36.39c-.18-5.95,4-11.97,9.33-13.44l48.95-13.43c5.33-1.46,9.81,2.19,10,8.13l1.12,36.39c.18,5.95-4,11.97-9.33,13.44ZM26.14,32.54c-3.71,1.02-6.62,5.21-6.49,9.35l1.12,36.39c.13,4.14,3.25,6.68,6.96,5.66l48.95-13.43c3.71-1.02,6.62-5.21,6.49-9.35l-1.12-36.39c-.13-4.14-3.25-6.68-6.96-5.66l-48.95,13.43Z"/>
          </g>
          <polygon fill="#f4af3f" points="18.91 46.98 83.08 29.37 82.84 21.73 76.96 17.1 30 29.99 22.29 32.6 18.62 37.51 18.24 40.7 18.91 46.98"/>
        </g>
        <g>
          <g>
            <path fill="#ece5da" d="M68.38,64.4l-48.95,13.43c-4.53,1.24-8.32-1.85-8.48-6.9l-1.12-36.39c-.16-5.05,3.39-10.15,7.91-11.39l48.95-13.43c4.53-1.24,8.32,1.85,8.48,6.9l1.12,36.39c.16,5.05-3.39,10.15-7.91,11.39Z"/>
            <path fill="#6bbe45" d="M68.43,66.04l-48.95,13.43c-5.33,1.46-9.81-2.19-10-8.13l-1.12-36.39c-.18-5.95,4-11.97,9.33-13.44l48.95-13.43c5.33-1.46,9.81,2.19,10,8.13l1.12,36.39c.18,5.95-4,11.97-9.33,13.44ZM17.79,24.79c-3.71,1.02-6.62,5.21-6.49,9.35l1.12,36.39c.13,4.14,3.25,6.68,6.96,5.66l48.95-13.43c3.71-1.02,6.62-5.21,6.49-9.35l-1.12-36.39c-.13-4.14-3.25-6.68-6.96-5.66l-48.95,13.43Z"/>
          </g>
          <polygon fill="#6bbe45" points="10.56 39.23 74.73 21.62 74.49 13.97 68.62 9.35 21.65 22.24 13.94 24.85 10.27 29.76 9.9 32.95 10.56 39.23"/>
        </g>
        <g>
          <g>
            <path fill="#ece5da" d="M60.03,56.64l-48.95,13.43c-4.53,1.24-8.32-1.85-8.48-6.9L1.48,26.79c-.16-5.05,3.39-10.15,7.91-11.39L58.34,1.96c4.53-1.24,8.32,1.85,8.48,6.9l1.12,36.39c.16,5.05-3.39,10.15-7.91,11.39Z"/>
            <path fill="#ef393b" d="M60.08,58.28l-48.95,13.43c-5.33,1.46-9.81-2.19-10-8.13L0,27.19c-.18-5.95,4-11.97,9.33-13.44L58.29.32c5.33-1.46,9.81,2.19,10,8.13l1.12,36.39c.18,5.95-4,11.97-9.33,13.44ZM9.44,17.04c-3.71,1.02-6.62,5.21-6.49,9.35l1.12,36.39c.13,4.14,3.25,6.68,6.96,5.66l48.95-13.43c3.71-1.02,6.62-5.21,6.49-9.35l-1.12-36.39c-.13-4.14-3.25-6.68-6.96-5.66L9.44,17.04Z"/>
          </g>
          <polygon fill="#ef393b" points="2.21 31.48 66.38 13.87 66.14 6.22 60.27 1.6 13.3 14.48 5.59 17.09 1.92 22 1.55 25.2 2.21 31.48"/>
        </g>
      </g>
    </svg>
  )
}

function FrameIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="10" height="10" rx="1.5"
        stroke="currentColor" strokeWidth="1.4" fill="none"/>
    </svg>
  )
}

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

/*
 * OverflowIcon — three horizontal dots, the conventional "more / overflow"
 * affordance (deliberately not a hamburger, which connotes primary nav).
 * Uses currentColor so it follows the .overflowBtn text colour on hover.
 */
function OverflowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="3.5"  cy="8" r="1.4" fill="currentColor"/>
      <circle cx="8"    cy="8" r="1.4" fill="currentColor"/>
      <circle cx="12.5" cy="8" r="1.4" fill="currentColor"/>
    </svg>
  )
}
