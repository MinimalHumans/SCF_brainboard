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
// State machine: front ↔ edit
//
// front  = compact display face. Drag from anywhere on the card.
//          Shows: colored handle bar, title (Fraunces), type badge,
//          note preview, instance note preview. Read-only.
//
// edit   = full editing face. Drag from handle bar only.
//          Shows: all editable fields, swatch picker, publish button.
//
// The flip button (top-right of handle bar) is the only toggle.
// Escape also exits edit → front.
// ---------------------------------------------------------------------------

interface CardProps {
  card:          Card
  allCards:      Card[]
  getViewerZoom: () => number
}

export function CardComponent({ card, allCards, getViewerZoom }: CardProps) {
  const [isEditing, setIsEditing] = useState(false)

  const updateCardContent = useBoardStore(s => s.updateCardContent)
  const publishCard       = useBoardStore(s => s.publishCard)
  const entity = useBoardStore(s =>
    card.entityId ? s.board.entities.find(e => e.id === card.entityId) : undefined
  )
  const isSelected = useSelectionStore(s => s.selectedIds.has(card.id))

  const published   = card.entityId !== null
  const hasInstance = allCards.some(
    c => c.entityId === card.entityId && c.id !== card.id && published
  )

  const handlePointerDown = useCardDrag(card.id, getViewerZoom, isEditing)

  // Escape → exit edit
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isEditing) {
      e.stopPropagation()
      setIsEditing(false)
    }
  }, [isEditing])

  // Flip button: single pointer-down to avoid conflict with drag
  const handleFlipPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsEditing(v => !v)
  }, [])

  // Field updaters
  const setTitle        = useCallback((v: string) => updateCardContent(card.id, { title: v }),        [card.id, updateCardContent])
  const setNoteRaw      = useCallback((v: string) => updateCardContent(card.id, { noteRaw: v }),      [card.id, updateCardContent])
  const setInstanceNote = useCallback((v: string) => updateCardContent(card.id, { instanceNote: v }), [card.id, updateCardContent])
  const setType         = useCallback((v: string) => updateCardContent(card.id, { type: v as any }),  [card.id, updateCardContent])

  const handleSwatchPointerDown = useCallback((e: React.PointerEvent, swatch: string) => {
    e.stopPropagation()
    e.preventDefault()
    updateCardContent(card.id, { color: swatch as any })
  }, [card.id, updateCardContent])

  const handlePublishPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    publishCard(card.id)
    setIsEditing(false)
  }, [card.id, publishCard])

  // Note text for front face — shared entity note or draft
  const displayNote = entity?.noteRaw ?? card.noteRaw

  // Markdown render for front face note preview
  const noteHtml = useMemo(() => {
    return displayNote ? marked.parse(displayNote) as string : ''
  }, [displayNote])

  return (
    <div
      data-card-id={card.id}
      className={[
        styles.card,
        isEditing  ? styles.editing  : styles.front,
        isSelected ? styles.selected : '',
        published  ? ''              : styles.unpublished,
      ].join(' ').trim()}
      data-swatch={card.color}
      style={{
        transform: `translate(${card.position.x}px, ${card.position.y}px)`,
        zIndex:    card.zIndex,
      }}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    >

      {/* ── HANDLE BAR ─────────────────────────────────────────────────── */}
      {/* Always present. Primary drag target when editing. */}
      <div className={styles.handle} data-drag-handle="true">
        <span className={styles.typeBadge}>{card.type}</span>
        {hasInstance && (
          <span className={styles.instanceGlyph} title="Multiple instances on board">◈</span>
        )}
        {!published && (
          <span className={styles.draftLabel}>Draft</span>
        )}
        <button
          className={styles.flipBtn}
          onPointerDown={handleFlipPointerDown}
          title={isEditing ? 'Back to card view' : 'Edit card'}
          aria-label={isEditing ? 'Back to card view' : 'Edit card'}
        >
          {isEditing ? <ViewIcon /> : <EditIcon />}
        </button>
      </div>

      {/* ── FRONT FACE ─────────────────────────────────────────────────── */}
      {/* Compact display. Visible when not editing. */}
      {!isEditing && (
        <div className={styles.frontContent}>
          {/* Title */}
          <div className={`${styles.title} text-display-card`}>
            {card.title || `New ${card.type}`}
          </div>

          {/* Note — rendered as markdown */}
          {noteHtml ? (
            <div
              className={styles.noteMarkdown}
              dangerouslySetInnerHTML={{ __html: noteHtml }}
            />
          ) : (
            <p className={styles.emptyNote}>No note — click ✎ to edit</p>
          )}

          {/* Instance note (local placement context) */}
          {card.instanceNote && (
            <p className={styles.instanceNotePreview}>{card.instanceNote}</p>
          )}
        </div>
      )}

      {/* ── EDIT FACE ──────────────────────────────────────────────────── */}
      {/* Full fields. Visible when editing. */}
      {isEditing && (
        <div className={styles.editContent}>

          <div className={styles.field}>
            <label className={styles.label}>Type</label>
            <select
              className={styles.select}
              value={card.type}
              onChange={e => setType(e.target.value)}
              onClick={e => e.stopPropagation()}
            >
              {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Name</label>
            <input
              className={styles.input}
              value={card.title}
              onChange={e => setTitle(e.target.value)}
              placeholder={`New ${card.type}`}
              onClick={e => e.stopPropagation()}
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>
              Note
              {published && <span className={styles.tag}> · shared across instances</span>}
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

          <div className={styles.field}>
            <label className={styles.label}>
              Placement note
              <span className={styles.tag}> · this card only</span>
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

          <div className={styles.field}>
            <label className={styles.label}>Color</label>
            <div className={styles.swatches}>
              {SWATCH_KEYS.map(swatch => (
                <div
                  key={swatch}
                  role="button"
                  tabIndex={0}
                  aria-label={swatch}
                  title={swatch}
                  className={`${styles.swatch} ${card.color === swatch ? styles.swatchActive : ''}`}
                  style={{ '--dot': `var(--swatch-${swatch})` } as React.CSSProperties}
                  onPointerDown={e => handleSwatchPointerDown(e, swatch)}
                />
              ))}
            </div>
          </div>

          {!published && (
            <div className={styles.publishRow}>
              <button className={styles.publishBtn} onPointerDown={handlePublishPointerDown}>
                Publish entity
              </button>
            </div>
          )}

        </div>
      )}

    </div>
  )
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function EditIcon() {
  // Pencil — signals "enter edit mode"
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path
        d="M2 10.5h1.5L9 5 8 4l-5.5 5.5V10.5zM8 4l1-1 1 1-1 1L8 4z"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function ViewIcon() {
  // Card/view icon — signals "back to card view"
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="10" height="9" rx="1.5"
        stroke="currentColor" strokeWidth="1.3"/>
      <line x1="1.5" y1="5" x2="11.5" y2="5" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="4"   y1="7.5" x2="9" y2="7.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  )
}
