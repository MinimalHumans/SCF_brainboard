import React, { useState, useCallback, useRef, useMemo } from 'react'
import { marked } from 'marked'
import { useBoardStore } from '@/store/boardStore'
import { useSelectionStore } from '@/store/selectionStore'
import { useCardDrag } from '@/hooks/useCardDrag'
import type { Card } from '@/types/board'
import { ENTITY_TYPES, SWATCH_KEYS, getCardNote } from '@/types/board'
import styles from './Card.module.css'

// Configure marked once
marked.use({ breaks: true, gfm: true })

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CardProps {
  card:          Card
  allCards:      Card[]
  getViewerZoom: () => number
}

// ---------------------------------------------------------------------------
// Card component
// ---------------------------------------------------------------------------

export function CardComponent({ card, allCards, getViewerZoom }: CardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  // Store actions — stable function references, safe as individual selectors
  const updateCardContent = useBoardStore(s => s.updateCardContent)
  const publishCard       = useBoardStore(s => s.publishCard)

  // Entity for the back face (null if unpublished)
  const entity = useBoardStore(s =>
    card.entityId ? s.board.entities.find(e => e.id === card.entityId) : undefined
  )

  // Selection state — boolean selector, only re-renders when this card's selection changes
  const isSelected = useSelectionStore(s => s.selectedIds.has(card.id))

  const handlePointerDown = useCardDrag(card.id, getViewerZoom)

  // -------------------------------------------------------------------------
  // Double-click → enter edit mode (front face only)
  // -------------------------------------------------------------------------
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!card.isFlipped) setIsEditing(true)
  }, [card.isFlipped])

  // -------------------------------------------------------------------------
  // Escape key → exit edit mode
  // -------------------------------------------------------------------------
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setIsEditing(false)
    }
  }, [])

  // -------------------------------------------------------------------------
  // Flip button
  // -------------------------------------------------------------------------
  const handleFlip = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsEditing(false)
    updateCardContent(card.id, { isFlipped: !card.isFlipped })
  }, [card.id, card.isFlipped, updateCardContent])

  // -------------------------------------------------------------------------
  // Field update helpers
  // -------------------------------------------------------------------------
  const setTitle       = useCallback((v: string) => updateCardContent(card.id, { title: v }),       [card.id, updateCardContent])
  const setNoteRaw     = useCallback((v: string) => updateCardContent(card.id, { noteRaw: v }),     [card.id, updateCardContent])
  const setInstanceNote = useCallback((v: string) => updateCardContent(card.id, { instanceNote: v }), [card.id, updateCardContent])
  const setColor       = useCallback((v: string) => updateCardContent(card.id, { color: v as any }),[card.id, updateCardContent])
  const setType        = useCallback((v: string) => updateCardContent(card.id, { type: v as any }), [card.id, updateCardContent])

  const handlePublish  = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    publishCard(card.id)
  }, [card.id, publishCard])

  // noteRaw shown on back face (shared entity note or draft note)
  const noteRaw = getCardNote(card, entity ? [entity] : [])

  const published = card.entityId !== null
  const hasInstance = allCards.some(c => c.entityId === card.entityId && c.id !== card.id && published)

  return (
    <div
      ref={cardRef}
      data-card-id={card.id}
      className={[
        styles.cardShell,
        isSelected  ? styles.selected    : '',
        published   ? styles.published   : styles.unpublished,
      ].join(' ').trim()}
      data-swatch={card.color}
      style={{ transform: `translate(${card.position.x}px, ${card.position.y}px)`, zIndex: card.zIndex }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      <div className={`${styles.cardInner} ${card.isFlipped ? styles.flipped : ''}`}>

        {/* ==================== FRONT (note side) ==================== */}
        <div className={`${styles.face} ${styles.front}`}>
          <CardHeader
            card={card}
            isEditing={isEditing}
            hasInstance={hasInstance}
            onFlip={handleFlip}
            onTypeChange={setType}
          />

          {/* Title */}
          {isEditing ? (
            <input
              className={styles.titleInput}
              value={card.title}
              onChange={e => setTitle(e.target.value)}
              placeholder={`New ${card.type}`}
              onClick={e => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <div className={`${styles.title} text-display-card`}>
              {card.title || `New ${card.type}`}
            </div>
          )}

          {/* noteRaw — shared entity note */}
          {isEditing ? (
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>
                Note {published ? <span className={styles.sharedTag}>shared · all instances</span> : null}
              </label>
              <textarea
                className={styles.textarea}
                value={card.noteRaw}
                onChange={e => setNoteRaw(e.target.value)}
                placeholder="Add a note…"
                rows={4}
                onClick={e => e.stopPropagation()}
              />
            </div>
          ) : (
            card.noteRaw && (
              <p className={styles.notePreview}>{card.noteRaw}</p>
            )
          )}

          {/* instanceNote — local to this placement */}
          {isEditing && (
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>
                Placement note <span className={styles.sharedTag}>this card only</span>
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
          )}

          {/* Swatch + type picker (edit mode only) */}
          {isEditing && (
            <div className={styles.editFooter}>
              <SwatchPicker current={card.color} onChange={setColor} />
            </div>
          )}

          {/* View-mode instance note preview */}
          {!isEditing && card.instanceNote && (
            <p className={styles.instanceNotePreview}>{card.instanceNote}</p>
          )}
        </div>

        {/* ==================== BACK (attribute side) ==================== */}
        <div className={`${styles.face} ${styles.back}`}>
          <div className={styles.backHeader}>
            <span className={styles.typeBadge}>{card.type}</span>
            {published && (
              <span className={styles.entityTag}>Entity</span>
            )}
            <button className={styles.flipBtn} onClick={handleFlip} title="Flip to note side">
              <FlipIcon />
            </button>
          </div>

          {published && entity ? (
            <>
              <div className={`${styles.backTitle} text-display-card`}>{entity.title}</div>
              {entity.noteRaw ? (
                <MarkdownContent source={entity.noteRaw} className={styles.markdown} />
              ) : (
                <p className={styles.emptyNote}>No note yet — edit the front face.</p>
              )}
              <p className={styles.attributePlaceholder}>
                Attributes available in Phase 6
              </p>
            </>
          ) : (
            <div className={styles.unpublishedBack}>
              <p className={styles.unpublishedMsg}>Publish this card to unlock attributes and entity linking.</p>
              <button className={styles.publishBtn} onClick={handlePublish}>
                Publish
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CardHeader — shared between front face states
// ---------------------------------------------------------------------------

function CardHeader({
  card, isEditing, hasInstance, onFlip, onTypeChange,
}: {
  card: Card
  isEditing: boolean
  hasInstance: boolean
  onFlip: (e: React.MouseEvent) => void
  onTypeChange: (type: string) => void
}) {
  return (
    <div className={styles.header}>
      {isEditing ? (
        <select
          className={styles.typeSelect}
          value={card.type}
          onChange={e => onTypeChange(e.target.value)}
          onClick={e => e.stopPropagation()}
        >
          {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      ) : (
        <span className={styles.typeBadge}>{card.type}</span>
      )}

      {hasInstance && !isEditing && (
        <span className={styles.instanceGlyph} title="Multiple instances on board">◈</span>
      )}
      {!card.entityId && !isEditing && (
        <span className={styles.draftLabel}>Draft</span>
      )}

      <button
        className={styles.flipBtn}
        onClick={onFlip}
        title="Show attributes"
      >
        <FlipIcon />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SwatchPicker
// ---------------------------------------------------------------------------

function SwatchPicker({ current, onChange }: { current: string; onChange: (s: string) => void }) {
  return (
    <div className={styles.swatchPicker}>
      {SWATCH_KEYS.map(swatch => (
        <button
          key={swatch}
          className={`${styles.swatchDot} ${current === swatch ? styles.swatchActive : ''}`}
          style={{ '--dot-color': `var(--swatch-${swatch})` } as React.CSSProperties}
          onClick={e => { e.stopPropagation(); onChange(swatch) }}
          aria-label={swatch}
          title={swatch}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MarkdownContent — renders noteRaw as HTML
// ---------------------------------------------------------------------------

function MarkdownContent({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => marked.parse(source) as string, [source])
  return (
    <div
      className={className}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={e => e.stopPropagation()}
    />
  )
}

// ---------------------------------------------------------------------------
// FlipIcon SVG
// ---------------------------------------------------------------------------

function FlipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2 4.5C2 3.12 3.12 2 4.5 2h5c1.38 0 2.5 1.12 2.5 2.5v1M12 9.5C12 10.88 10.88 12 9.5 12h-5C3.12 12 2 10.88 2 9.5v-1"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"
      />
      <path d="M10.5 3L12 4.5 10.5 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3.5 11L2 9.5 3.5 8"  stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
