import React from 'react'
import styles from './Toolbar.module.css'

interface ToolbarProps {
  boardName?:          string
  hasSelection?:       boolean
  onPublishAll?:       () => void
  onPublishSelected?:  () => void
}

export function Toolbar({
  boardName        = 'Untitled Board',
  hasSelection     = false,
  onPublishAll,
  onPublishSelected,
}: ToolbarProps) {
  return (
    <header className={styles.toolbar}>
      <div className={styles.left}>
        <span className={`${styles.wordmark} text-display`}>Brainboard</span>
        <span className={styles.divider} aria-hidden="true" />
        <span className={styles.boardName}>{boardName}</span>
      </div>

      <div className={styles.center}>
        {/* Phase 2+: zoom level HUD and reset-view button */}
      </div>

      <div className={styles.right}>
        {/* Phase 9: import/export become functional */}
        <button className={styles.action} disabled title="Import board (Phase 9)">
          Import
        </button>
        <button className={styles.action} disabled title="Export board (Phase 9)">
          Export
        </button>

        <div className={styles.publishGroup}>
          {/* Publish Selected: only visible when cards are selected */}
          {hasSelection && onPublishSelected && (
            <button
              className={styles.action}
              onClick={onPublishSelected}
              title="Publish selected cards"
            >
              Publish Selected
            </button>
          )}
          <button
            className={`${styles.action} ${styles.publishAll}`}
            onClick={onPublishAll}
            disabled={!onPublishAll}
            title="Publish all unpublished cards"
          >
            Publish All
          </button>
        </div>
      </div>
    </header>
  )
}
