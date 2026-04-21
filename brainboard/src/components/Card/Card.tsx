import React, { useState, useCallback, useMemo } from 'react'
import { marked } from 'marked'
import { useBoardStore } from '@/store/boardStore'
import { useSelectionStore } from '@/store/selectionStore'
import { useCardDrag } from '@/hooks/useCardDrag'
import type { Card } from '@/types/board'
import { ENTITY_TYPES, SWATCH_KEYS } from '@/types/board'
import styles from './Card.module.css'

marked.use({ breaks: true, gfm: true })

// ---------------------------------------------------------------------------
// Card mode state machine
//
//   closed  ←→  flipped    (flip button toggles between these)
//   closed  →   open       (double-click)
//   open    →   closed     (close button or Escape)
//
// The flip animation only runs between 'closed' and 'flipped'.
// 'open' is a separate expanded edit state — no flip in edit mode.
// This sidesteps the CSS preserve-3d / InfiniteViewer transform conflict.
// ---------------------------------------------------------------------------
type CardMode = 'closed' | 'open' | 'flipped'

interface CardProps {
  card:          Card
  allCards:      Card[]
  getViewerZoom: () => number
}

export function CardComponent({ card, allCards, getViewerZoom }: CardProps) {
  const [mode, setMode] = useState<CardMode>('closed')

  const updateCardContent = useBoardStore(s => s.updateCardContent)
  const publishCard       = useBoardStore(s => s.publishCard)
  const entity = useBoardStore(s =>
    card.entityId ? s.board.entities.find(e => e.id === card.entityId) : undefined
  )
  const isSelected = useSelectionStore(s => s.selectedIds.has(card.id))

  const isOpen     = mode === 'open'
  const isFlipped  = mode === 'flipped'
  const published  = card.entityId !== null
  const hasInstance = allCards.some(
    c => c.entityId === card.entityId && c.id !== card.id && published
  )

  const handlePointerDown = useCardDrag(card.id, getViewerZoom, isOpen)

  // Double-click on closed card → open edit mode
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (mode === 'closed') {
      e.stopPropagation()
      setMode('open')
    }
  }, [mode])

  // Escape anywhere on the card → close
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && mode === 'open') {
      e.stopPropagation()
      setMode('closed')
    }
  }, [mode])

  // Flip button — single click, uses onPointerDown to avoid drag conflict
  const handleFlipPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()  // prevent card drag from starting
    if (mode === 'closed')  setMode('flipped')
    if (mode === 'flipped') setMode('closed')
    // In open mode, flip button is not shown
  }, [mode])

  const handleClose = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setMode('closed')
  }, [])

  // Field updates
  const setTitle        = useCallback((v: string) => updateCardContent(card.id, { title: v }),        [card.id, updateCardContent])
  const setNoteRaw      = useCallback((v: string) => updateCardContent(card.id, { noteRaw: v }),      [card.id, updateCardContent])
  const setInstanceNote = useCallback((v: string) => updateCardContent(card.id, { instanceNote: v }), [card.id, updateCardContent])
  const setType         = useCallback((v: string) => updateCardContent(card.id, { type: v as any }),  [card.id, updateCardContent])

  // Swatch: use onPointerDown with stopPropagation to prevent card drag stealing
  const handleSwatchPointerDown = useCallback((e: React.PointerEvent, swatch: string) => {
    e.stopPropagation()
    e.preventDefault()
    updateCardContent(card.id, { color: swatch as any })
  }, [card.id, updateCardContent])

  const handlePublishPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    publishCard(card.id)
    setMode('closed')
  }, [card.id, publishCard])

  // Markdown for back face
  const noteHtml = useMemo(() => {
    const source = entity?.noteRaw ?? card.noteRaw
    return source ? marked.parse(source) as string : ''
  }, [entity?.noteRaw, card.noteRaw])

  return (
    <div
      data-card-id={card.id}
      className={[
        styles.card,
        styles[mode],
        isSelected ? styles.selected : '',
        published  ? '' : styles.unpublished,
      ].join(' ').trim()}
      data-swatch={card.color}
      style={{ transform: `translate(${card.position.x}px, ${card.position.y}px)`, zIndex: card.zIndex }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {/* ====== DRAG HANDLE (always present, primary drag target when open) ====== */}
      <div
        className={styles.dragHandle}
        data-drag-handle="true"
        style={{ '--handle-color': `var(--swatch-${card.color})` } as React.CSSProperties}
      >
        <span className={styles.typeBadge}>{card.type}</span>
        {hasInstance && <span className={styles.instanceGlyph} title="Multiple instances">◈</span>}
        {!published  && <span className={styles.draftLabel}>Draft</span>}

        <div className={styles.handleActions}>
          {/* Flip button: closed ↔ flipped. Not shown in open mode. */}
          {mode !== 'open' && (
            <button
              className={styles.iconBtn}
              onPointerDown={handleFlipPointerDown}
              title={isFlipped ? 'Show front' : 'Show attributes'}
              aria-label={isFlipped ? 'Show front' : 'Show attributes'}
            >
              <FlipIcon flipped={isFlipped} />
            </button>
          )}
          {/* Close button: only in open mode */}
          {mode === 'open' && (
            <button
              className={styles.iconBtn}
              onPointerDown={handleClose}
              title="Close edit mode"
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>

      {/* ====== FRONT FACE ====== */}
      <div className={`${styles.face} ${styles.front} ${isFlipped ? styles.faceHidden : ''}`}>
        {mode === 'closed' && (
          /* Closed: compact read-only view */
          <div className={styles.closedContent}>
            <div className={`${styles.title} text-display-card`}>
              {card.title || `New ${card.type}`}
            </div>
            {card.noteRaw && (
              <p className={styles.notePreview}>{card.noteRaw}</p>
            )}
            {card.instanceNote && (
              <p className={styles.instanceNotePreview}>{card.instanceNote}</p>
            )}
          </div>
        )}

        {mode === 'open' && (
          /* Open: full edit fields */
          <div className={styles.openContent}>
            {/* Type */}
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Type</label>
              <select
                className={styles.typeSelect}
                value={card.type}
                onChange={e => setType(e.target.value)}
                onClick={e => e.stopPropagation()}
              >
                {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Title */}
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Name</label>
              <input
                className={styles.titleInput}
                value={card.title}
                onChange={e => setTitle(e.target.value)}
                placeholder={`New ${card.type}`}
                onClick={e => e.stopPropagation()}
                autoFocus
              />
            </div>

            {/* Note */}
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>
                Note
                {published && <span className={styles.sharedTag}> · shared</span>}
              </label>
              <textarea
                className={styles.textarea}
                value={card.noteRaw}
                onChange={e => setNoteRaw(e.target.value)}
                placeholder="Add a note… (markdown supported)"
                rows={4}
                onClick={e => e.stopPropagation()}
              />
            </div>

            {/* Instance note */}
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>
                Placement note
                <span className={styles.sharedTag}> · this card only</span>
              </label>
              <textarea
                className={styles.textarea}
                value={card.instanceNote}
                onChange={e => setInstanceNote(e.target.value)}
                placeholder="Context for this placement…"
                rows={2}
                onClick={e => e.stopPropagation()}
              />
            </div>

            {/* Swatch picker */}
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Color</label>
              <div className={styles.swatchRow}>
                {SWATCH_KEYS.map(swatch => (
                  <div
                    key={swatch}
                    role="button"
                    tabIndex={0}
                    className={`${styles.swatchDot} ${card.color === swatch ? styles.swatchActive : ''}`}
                    style={{ '--dot-color': `var(--swatch-${swatch})` } as React.CSSProperties}
                    onPointerDown={e => handleSwatchPointerDown(e, swatch)}
                    aria-label={swatch}
                    title={swatch}
                  />
                ))}
              </div>
            </div>

            {/* Publish (if unpublished) */}
            {!published && (
              <div className={styles.publishRow}>
                <button
                  className={styles.publishBtn}
                  onPointerDown={handlePublishPointerDown}
                >
                  Publish entity
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ====== BACK FACE (attributes) ====== */}
      <div className={`${styles.face} ${styles.back} ${!isFlipped ? styles.faceHidden : ''}`}>
        {published && entity ? (
          <div className={styles.backContent}>
            <div className={`${styles.backTitle} text-display-card`}>{entity.title}</div>
            {noteHtml ? (
              <div
                className={styles.markdown}
                dangerouslySetInnerHTML={{ __html: noteHtml }}
              />
            ) : (
              <p className={styles.emptyNote}>No note yet — double-click to edit.</p>
            )}
            <p className={styles.attributePlaceholder}>Attributes · Phase 6</p>
          </div>
        ) : (
          <div className={styles.unpublishedBack}>
            <p className={styles.unpublishedMsg}>
              Publish this card to unlock the attribute side.
            </p>
            <button className={styles.publishBtn} onPointerDown={handlePublishPointerDown}>
              Publish
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function FlipIcon({ flipped }: { flipped: boolean }) {
  return flipped ? (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M9.5 2L7 4.5M7 4.5L4.5 2M7 4.5V10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ) : (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="1.5" y1="5.5" x2="11.5" y2="5.5" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <line x1="3" y1="3" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <line x1="10" y1="3" x2="3"  y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}
