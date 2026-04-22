import React, { useState, useCallback, useMemo } from 'react'
import { marked } from 'marked'
import { useBoardStore } from '@/store/boardStore'
import { useSelectionStore } from '@/store/selectionStore'
import { useCardDrag } from '@/hooks/useCardDrag'
import { ContextMenu } from '@/components/ContextMenu/ContextMenu'
import type { ContextMenuItem } from '@/components/ContextMenu/ContextMenu'
import type { Card } from '@/types/board'
import { ENTITY_TYPES, SWATCH_KEYS } from '@/types/board'
import { ATTRIBUTE_SCHEMAS } from '@/config/attributeSchemas'
import styles from './Card.module.css'

marked.use({ breaks: true, gfm: true })

interface CardProps {
  card:             Card
  allCards:         Card[]
  getViewerZoom:    () => number
  onCreateInstance: (cardId: string) => void
}

export function CardComponent({ card, allCards, getViewerZoom, onCreateInstance }: CardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [ctxMenu, setCtxMenu]     = useState<{ x: number; y: number } | null>(null)

  const updateCardContent     = useBoardStore(s => s.updateCardContent)
  const updateEntityAttribute = useBoardStore(s => s.updateEntityAttribute)
  const publishCard           = useBoardStore(s => s.publishCard)
  const duplicateCard         = useBoardStore(s => s.duplicateCard)
  const deleteCard            = useBoardStore(s => s.deleteCard)

  const entity = useBoardStore(s =>
    card.entityId ? s.board.entities.find(e => e.id === card.entityId) : undefined
  )
  const isSelected    = useSelectionStore(s => s.selectedIds.has(card.id))
  const selectedIds   = useSelectionStore(s => s.selectedIds)
  const clearSelection = useSelectionStore(s => s.clearSelection)
  const select        = useSelectionStore(s => s.select)

  const published   = card.entityId !== null
  const hasInstance = allCards.some(c => c.entityId === card.entityId && c.id !== card.id && published)
  const attrSchema  = ATTRIBUTE_SCHEMAS[card.type] ?? []

  const handlePointerDown = useCardDrag(card.id, getViewerZoom, isEditing)

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsEditing(true)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isEditing) { e.stopPropagation(); setIsEditing(false) }
  }, [isEditing])

  const handleFlipPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault()
    setIsEditing(v => !v)
  }, [])

  // Right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    if (!selectedIds.has(card.id)) select(card.id)
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }, [card.id, selectedIds, select])

  const contextMenuItems = useMemo((): ContextMenuItem[] => {
    const multi = selectedIds.size > 1 && selectedIds.has(card.id)
    return [
      { label: 'Edit', shortcut: 'Double-click', onClick: () => setIsEditing(true), disabled: multi },
      { label: 'Duplicate', shortcut: 'Ctrl D', onClick: () => duplicateCard(card.id), divider: true },
      { label: 'Create Instance', shortcut: 'Ctrl I', onClick: () => onCreateInstance(card.id), disabled: !published },
      {
        label: 'Delete', shortcut: 'Del', divider: true, danger: true,
        onClick: () => {
          if (multi) { useBoardStore.getState().deleteCards([...selectedIds]); clearSelection() }
          else deleteCard(card.id)
        },
      },
    ]
  }, [card.id, published, selectedIds, duplicateCard, deleteCard, onCreateInstance, clearSelection])

  // Field updaters
  const setTitle        = useCallback((v: string) => updateCardContent(card.id, { title: v }),        [card.id, updateCardContent])
  const setNoteRaw      = useCallback((v: string) => updateCardContent(card.id, { noteRaw: v }),      [card.id, updateCardContent])
  const setInstanceNote = useCallback((v: string) => updateCardContent(card.id, { instanceNote: v }), [card.id, updateCardContent])
  const setType         = useCallback((v: string) => updateCardContent(card.id, { type: v as any }),  [card.id, updateCardContent])

  const setAttr = useCallback((key: string, value: string) => {
    if (!entity) return
    updateEntityAttribute(entity.id, key, value)
  }, [entity, updateEntityAttribute])

  const handleSwatchPointerDown = useCallback((e: React.PointerEvent, swatch: string) => {
    e.stopPropagation(); e.preventDefault()
    updateCardContent(card.id, { color: swatch as any })
  }, [card.id, updateCardContent])

  const handlePublishPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault()
    publishCard(card.id)
    setIsEditing(false)
  }, [card.id, publishCard])

  // Note for front face
  const displayNote = entity?.noteRaw ?? card.noteRaw
  const noteHtml    = useMemo(() =>
    displayNote ? marked.parse(displayNote) as string : '',
  [displayNote])

  // Filled attributes for front face display
  // Only show fields that have a non-empty value
  const filledAttrs = useMemo(() => {
    if (!entity || attrSchema.length === 0) return []
    return attrSchema
      .map(field => ({
        field,
        value: (entity.attributes[field.key] as string) ?? '',
      }))
      .filter(({ value }) => value.trim() !== '')
  }, [entity, attrSchema])

  return (
    <>
      <div
        data-card-id={card.id}
        className={[
          styles.card,
          isEditing  ? styles.editing  : styles.front,
          isSelected ? styles.selected : '',
          published  ? ''              : styles.unpublished,
        ].join(' ').trim()}
        data-swatch={card.color}
        style={{ transform: `translate(${card.position.x}px, ${card.position.y}px)`, zIndex: card.zIndex }}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
      >
        {/* ── HANDLE BAR ── */}
        <div className={styles.handle} data-drag-handle="true">
          <span className={styles.typeBadge}>{card.type}</span>
          {hasInstance && <span className={styles.instanceGlyph} title="Multiple instances">◈</span>}
          {!published  && <span className={styles.draftLabel}>Draft</span>}
          <button
            className={styles.flipBtn}
            onPointerDown={handleFlipPointerDown}
            title={isEditing ? 'Back to card view' : 'Edit card'}
          >
            {isEditing ? <ViewIcon /> : <EditIcon />}
          </button>
        </div>

        {/* ── FRONT FACE ── */}
        {!isEditing && (
          <div className={styles.frontContent}>
            {/* Title */}
            <div className={`${styles.title} text-display-card`}>
              {card.title || `New ${card.type}`}
            </div>

            {/* Filled attributes — shown inline, card grows to fit */}
            {filledAttrs.length > 0 && (
              <div className={styles.attrDisplay}>
                {filledAttrs.map(({ field, value }) => (
                  <div key={field.key} className={styles.attrRow}>
                    <span className={styles.attrKey}>{field.label}</span>
                    <span className={styles.attrVal}>{value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Note — only shown if non-empty */}
            {noteHtml && (
              <div
                className={styles.noteMarkdown}
                dangerouslySetInnerHTML={{ __html: noteHtml }}
              />
            )}

            {/* Instance note — only if non-empty */}
            {card.instanceNote && (
              <p className={styles.instanceNotePreview}>{card.instanceNote}</p>
            )}
          </div>
        )}

        {/* ── EDIT FACE ── */}
        {/* Field order: Type → Name → Attributes → Note → Placement Note → Color → Publish */}
        {isEditing && (
          <div className={styles.editContent}>

            <div className={styles.field}>
              <label className={styles.label}>Type</label>
              <select className={styles.select} value={card.type}
                onChange={e => setType(e.target.value)} onClick={e => e.stopPropagation()}>
                {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Name</label>
              <input className={styles.input} value={card.title}
                onChange={e => setTitle(e.target.value)}
                placeholder={`New ${card.type}`}
                onClick={e => e.stopPropagation()} autoFocus />
            </div>

            {/* Attribute fields — between Name and Note */}
            {attrSchema.length > 0 && (
              <div className={styles.attrSection}>
                <div className={styles.attrSectionHeader}>
                  Attributes
                  {!published && <span className={styles.attrLock}> · publish to save</span>}
                </div>
                {attrSchema.map(field => (
                  <div key={field.key} className={styles.field}>
                    <label className={styles.label}>{field.label}</label>
                    {field.type === 'select' ? (
                      <select
                        className={styles.select}
                        value={(entity?.attributes[field.key] as string) ?? ''}
                        onChange={e => setAttr(field.key, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        disabled={!published}
                      >
                        <option value="">—</option>
                        {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        className={styles.textarea}
                        value={(entity?.attributes[field.key] as string) ?? ''}
                        onChange={e => setAttr(field.key, e.target.value)}
                        placeholder={field.hint}
                        rows={2}
                        onClick={e => e.stopPropagation()}
                        disabled={!published}
                      />
                    ) : (
                      <input
                        className={styles.input}
                        value={(entity?.attributes[field.key] as string) ?? ''}
                        onChange={e => setAttr(field.key, e.target.value)}
                        placeholder={field.hint}
                        onClick={e => e.stopPropagation()}
                        disabled={!published}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Note — at the bottom of content fields */}
            <div className={styles.field}>
              <label className={styles.label}>
                Note {published && <span className={styles.tag}> · shared</span>}
              </label>
              <textarea className={styles.textarea} value={card.noteRaw}
                onChange={e => setNoteRaw(e.target.value)}
                placeholder="Add a note… (markdown supported)"
                rows={3} onClick={e => e.stopPropagation()} />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>
                Placement note <span className={styles.tag}> · this card only</span>
              </label>
              <textarea className={styles.textarea} value={card.instanceNote}
                onChange={e => setInstanceNote(e.target.value)}
                placeholder="Context for this placement…"
                rows={2} onClick={e => e.stopPropagation()} />
            </div>

            {/* Color */}
            <div className={styles.field}>
              <label className={styles.label}>Color</label>
              <div className={styles.swatches}>
                {SWATCH_KEYS.map(swatch => (
                  <div key={swatch} role="button" tabIndex={0}
                    className={`${styles.swatch} ${card.color === swatch ? styles.swatchActive : ''}`}
                    style={{ '--dot': `var(--swatch-${swatch})` } as React.CSSProperties}
                    onPointerDown={e => handleSwatchPointerDown(e, swatch)}
                    aria-label={swatch} title={swatch} />
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

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          items={contextMenuItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  )
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M2 10.5h1.5L9 5 8 4 2.5 9.5V10.5zM8 4l1-1 1 1-1 1L8 4z"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  )
}

function ViewIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="1.5" y1="5" x2="11.5" y2="5" stroke="currentColor" strokeWidth="1.3"/>
      <line x1="4" y1="7.5" x2="9" y2="7.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  )
}
