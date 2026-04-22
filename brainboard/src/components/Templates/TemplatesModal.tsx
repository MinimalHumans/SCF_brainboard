import React, { useCallback } from 'react'
import { createPortal } from 'react-dom'
import { nanoid } from 'nanoid'
import { useBoardStore } from '@/store/boardStore'
import { useTemplates } from '@/hooks/useTemplates'
import { toast } from '@/store/toastStore'
import type { Board, Card, Entity, Backdrop } from '@/types/board'
import styles from './TemplatesModal.module.css'

interface TemplatesModalProps {
  onClose: () => void
}

export function TemplatesModal({ onClose }: TemplatesModalProps) {
  const templates  = useTemplates()
  const loadBoard  = useBoardStore(s => s.loadBoard)
  const board      = useBoardStore(s => s.board)

  /*
   * New board from template — replace the entire board state.
   */
  const handleNewBoard = useCallback((templateBoard: Board) => {
    const fresh: Board = {
      ...templateBoard,
      boardId:   nanoid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      backdrops: (templateBoard.backdrops ?? []).map(b => ({ note: '', ...b })),
    }
    loadBoard(fresh)
    toast.success(`Loaded template "${templateBoard.name}"`)
    onClose()
  }, [loadBoard, onClose])

  /*
   * Merge template into current board.
   *
   * Strategy:
   *   - Remap all IDs (board IDs are nanoid — we generate fresh ones to
   *     avoid any collision with existing board content)
   *   - Offset positions by (300, 300) so merged content doesn't land on
   *     top of existing cards
   *   - Append to existing cards, entities, backdrops
   */
  const handleMerge = useCallback((templateBoard: Board) => {
    const OFFSET = 300

    // Build ID remap tables
    const cardIdMap     = new Map<string, string>()
    const entityIdMap   = new Map<string, string>()
    const backdropIdMap = new Map<string, string>()

    templateBoard.cards.forEach(c     => cardIdMap.set(c.id, nanoid()))
    templateBoard.entities.forEach(e  => entityIdMap.set(e.id, nanoid()))
    ;(templateBoard.backdrops ?? []).forEach(b => backdropIdMap.set(b.id, nanoid()))

    const remappedCards: Card[] = templateBoard.cards.map(c => ({
      ...c,
      id:       cardIdMap.get(c.id)!,
      entityId: c.entityId ? entityIdMap.get(c.entityId) ?? null : null,
      position: { x: c.position.x + OFFSET, y: c.position.y + OFFSET },
    }))

    const remappedEntities: Entity[] = templateBoard.entities.map(e => ({
      ...e,
      id: entityIdMap.get(e.id)!,
    }))

    const remappedBackdrops: Backdrop[] = (templateBoard.backdrops ?? []).map(b => ({
      note: '',
      ...b,
      id:       backdropIdMap.get(b.id)!,
      position: { x: b.position.x + OFFSET, y: b.position.y + OFFSET },
    }))

    const merged: Board = {
      ...board,
      updatedAt: new Date().toISOString(),
      cards:     [...board.cards, ...remappedCards],
      entities:  [...board.entities, ...remappedEntities],
      backdrops: [...(board.backdrops ?? []), ...remappedBackdrops],
    }

    loadBoard(merged)
    toast.success(`Merged "${templateBoard.name}" into current board`)
    onClose()
  }, [board, loadBoard, onClose])

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-label="Templates">
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Templates</h2>
            <p className={styles.subtitle}>
              Start from a pre-built board or merge one into your current project.
              To add your own templates, export a board and place the <code>.json</code> file
              in <code>src/templates/</code>, then restart the dev server.
            </p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        {templates.length === 0 ? (
          <div className={styles.empty}>
            <p>No templates found.</p>
            <p className={styles.emptyHint}>
              Export a board and save it to <code>src/templates/</code> to see it here.
            </p>
          </div>
        ) : (
          <div className={styles.grid}>
            {templates.map(t => (
              <div key={t.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <span className={styles.cardName}>{t.name}</span>
                </div>
                <div className={styles.cardMeta}>
                  <span>{t.cardCount} card{t.cardCount !== 1 ? 's' : ''}</span>
                  {t.backdropCount > 0 && (
                    <span>{t.backdropCount} backdrop{t.backdropCount !== 1 ? 's' : ''}</span>
                  )}
                </div>
                <div className={styles.cardActions}>
                  <button
                    className={styles.actionMerge}
                    onClick={() => handleMerge(t.board)}
                    title="Append template content to the current board"
                  >
                    Merge into current
                  </button>
                  <button
                    className={styles.actionNew}
                    onClick={() => handleNewBoard(t.board)}
                    title="Replace current board with this template"
                  >
                    New board
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
