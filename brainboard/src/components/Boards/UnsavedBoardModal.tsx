import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './UnsavedBoardModal.module.css'

interface UnsavedBoardModalProps {
  boardName:     string
  cardCount:     number
  backdropCount: number
  onSave:        (name: string) => void
  onDiscard:     () => void
  onCancel:      () => void
}

/*
 * UnsavedBoardModal — guards against silently losing a fresh draft board
 * (a blank New Board, or a template loaded as one) that has changes but was
 * never named/saved. Triggered from src/lib/boardDraft.ts's
 * confirmDiscardIfDraft whenever createBoard/switchBoard/adoptBoard/
 * importBoard would otherwise replace it out from under the user.
 *
 * A real component (not window.confirm) so the three outcomes — save under
 * a name, discard, or cancel and stay put — can be laid out as
 * conventional, clearly differentiated buttons rather than a single OK/Cancel.
 */
export function UnsavedBoardModal({ boardName, cardCount, backdropCount, onSave, onDiscard, onCancel }: UnsavedBoardModalProps) {
  const [name, setName] = useState(boardName)
  const trimmed = name.trim()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  return createPortal(
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-label="Unsaved board">
        <h2 className={styles.title}>Unsaved board</h2>
        <p className={styles.message}>
          This board hasn&apos;t been saved yet. Give it a name to save your changes, or discard them to continue.
        </p>

        <div className={styles.stats}>
          <span>{cardCount} card{cardCount !== 1 ? 's' : ''}</span>
          {backdropCount > 0 && <span>{backdropCount} backdrop{backdropCount !== 1 ? 's' : ''}</span>}
        </div>

        <input
          className={styles.nameInput}
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          onKeyDown={e => {
            if (e.key === 'Enter' && trimmed) onSave(trimmed)
            if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
          }}
        />

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
          <button type="button" className={styles.discardBtn} onClick={onDiscard}>Discard</button>
          <button
            type="button"
            className={styles.saveBtn}
            disabled={!trimmed}
            onClick={() => trimmed && onSave(trimmed)}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
