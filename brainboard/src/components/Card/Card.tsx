import React, { useState, useCallback, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { marked } from 'marked'
import { useBoardStore, snapshotBoard } from '@/store/boardStore'
import { useSelectionStore } from '@/store/selectionStore'
import { useEditorSignalStore } from '@/store/editorSignalStore'
import { useCardDrag } from '@/hooks/useCardDrag'
import { ContextMenu } from '@/components/ContextMenu/ContextMenu'
import type { ContextMenuItem } from '@/components/ContextMenu/ContextMenu'
import type { Card } from '@/types/board'
import { ENTITY_TYPES, SWATCH_KEYS, isInstance } from '@/types/board'
import { ATTRIBUTE_SCHEMAS } from '@/config/attributeSchemas'
import styles from './Card.module.css'

marked.use({ breaks: true, gfm: true })

interface CardProps {
  card:             Card
  allCards:         Card[]
  getViewerZoom:    () => number
  onCreateInstance: (cardId: string) => void
  worldRef:         React.RefObject<HTMLDivElement>
}

export function CardComponent({ card, allCards, getViewerZoom, onCreateInstance, worldRef }: CardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [ctxMenu, setCtxMenu]     = useState<{ x: number; y: number } | null>(null)

  const updateCardContent     = useBoardStore(s => s.updateCardContent)
  const updateEntityAttribute = useBoardStore(s => s.updateEntityAttribute)
  const publishCard           = useBoardStore(s => s.publishCard)
  const duplicateCard         = useBoardStore(s => s.duplicateCard)
  const deleteCard            = useBoardStore(s => s.deleteCard)

  // Read entity live from store for realtime attribute updates
  const entity = useBoardStore(s =>
    card.entityId ? s.board.entities.find(e => e.id === card.entityId) : undefined
  )

  const isSelected   = useSelectionStore(s => s.selectedIds.has(card.id))
  const selectedIds  = useSelectionStore(s => s.selectedIds)
  const clearSelection = useSelectionStore(s => s.clearSelection)
  const select       = useSelectionStore(s => s.select)

  // Close when canvas signals
  const closeSignal = useEditorSignalStore(s => s.closeSignal)
  useEffect(() => { if (closeSignal > 0) setIsEditing(false) }, [closeSignal])

  const published   = true  // cards always published
  const hasInstance = isInstance(card, allCards)
  const attrSchema  = ATTRIBUTE_SCHEMAS[card.type] ?? []

  // Title always from entity to keep instances in sync
  const displayTitle = entity?.title ?? card.title

  const handlePointerDown = useCardDrag(card.id, getViewerZoom, isEditing)

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); setIsEditing(true)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isEditing) { e.stopPropagation(); setIsEditing(false) }
  }, [isEditing])

  const handleFlipPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault(); setIsEditing(true)
  }, [])

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
      { label: 'Create Instance', shortcut: 'Ctrl I', onClick: () => onCreateInstance(card.id) },
      {
        label: 'Delete', shortcut: 'Del', divider: true, danger: true,
        onClick: () => {
          if (multi) { useBoardStore.getState().deleteCards([...selectedIds]); clearSelection() }
          else deleteCard(card.id)
        },
      },
    ]
  }, [card.id, selectedIds, duplicateCard, deleteCard, onCreateInstance, clearSelection])

  // ── Text field change handlers (no snapshot — snapshot happens on focus) ──

  const setTitle        = useCallback((v: string) => updateCardContent(card.id, { title: v }),        [card.id, updateCardContent])
  const setNoteRaw      = useCallback((v: string) => updateCardContent(card.id, { noteRaw: v }),      [card.id, updateCardContent])
  const setInstanceNote = useCallback((v: string) => updateCardContent(card.id, { instanceNote: v }), [card.id, updateCardContent])

  // ── Discrete action handlers (snapshot before applying the change) ────────

  // Type dropdown: snapshot once before the change so each type switch is
  // its own undo step.
  const setType = useCallback((v: string) => {
    snapshotBoard()
    updateCardContent(card.id, { type: v as any })
  }, [card.id, updateCardContent])

  // Entity attribute change for text/textarea fields (no snapshot — onFocus handles it).
  const setAttr = useCallback((key: string, value: string) => {
    if (entity) updateEntityAttribute(entity.id, key, value)
  }, [entity, updateEntityAttribute])

  // Entity attribute change for select fields (snapshot before applying).
  const setAttrSelect = useCallback((key: string, value: string) => {
    snapshotBoard()
    if (entity) updateEntityAttribute(entity.id, key, value)
  }, [entity, updateEntityAttribute])

  // Swatch: snapshot before applying so each colour switch is its own undo step.
  const handleSwatchPointerDown = useCallback((e: React.PointerEvent, swatch: string) => {
    e.stopPropagation(); e.preventDefault()
    snapshotBoard()
    updateCardContent(card.id, { color: swatch as any })
  }, [card.id, updateCardContent])

  const handlePublishPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault()
    publishCard(card.id); setIsEditing(false)
  }, [card.id, publishCard])

  const displayNote = entity?.noteRaw ?? card.noteRaw
  const noteHtml    = useMemo(() => displayNote ? marked.parse(displayNote) as string : '', [displayNote])

  const filledAttrs = useMemo(() => {
    if (!entity || attrSchema.length === 0) return []
    return attrSchema
      .map(field => ({ field, value: (entity.attributes[field.key] as string) ?? '' }))
      .filter(({ value }) => value.trim() !== '')
  }, [entity, attrSchema])

  const CARD_W = 320
  const panelLeft = card.position.x + CARD_W + 8
  const panelTop  = card.position.y

  return (
    <>
      <div
        data-card-id={card.id}
        className={[styles.card, styles.front, isSelected ? styles.selected : ''].join(' ').trim()}
        data-swatch={card.color}
        style={{ transform: `translate(${card.position.x}px, ${card.position.y}px)`, zIndex: card.zIndex }}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
      >
        <div className={styles.handle} data-drag-handle="true">
          <span className={styles.typeBadge}>{card.type}</span>
          {hasInstance && (
            <span className={styles.instanceBadge} title="Instance — shares entity with other cards">
              <InstanceIcon />
            </span>
          )}
          {!isEditing && (
            <button className={styles.flipBtn} onPointerDown={handleFlipPointerDown} title="Edit card">
              <EditIcon />
            </button>
          )}
        </div>

        <div className={styles.frontContent}>
          <div className={`${styles.title} text-display-card`}>{displayTitle || `New ${card.type}`}</div>
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
          {noteHtml && <div className={styles.noteMarkdown} dangerouslySetInnerHTML={{ __html: noteHtml }} />}
          {card.instanceNote && <p className={styles.instanceNotePreview}>{card.instanceNote}</p>}
        </div>
      </div>

      {isEditing && worldRef.current && createPortal(
        <div className={styles.editPanel}
          style={{ position: 'absolute', left: panelLeft, top: panelTop, zIndex: card.zIndex + 1000 }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>{displayTitle || card.type}</span>
            <button className={styles.panelClose}
              onPointerDown={e => { e.stopPropagation(); e.preventDefault(); setIsEditing(false) }}
              title="Close">×</button>
          </div>

          {/* Type — discrete dropdown, snapshot before change */}
          <div className={styles.field}>
            <label className={styles.label}>Type</label>
            <select className={styles.select} value={card.type} onChange={e => setType(e.target.value)}>
              {[...ENTITY_TYPES].sort().map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Name — snapshot on focus, then free-type */}
          <div className={styles.field}>
            <label className={styles.label}>Name</label>
            <input
              className={styles.input}
              value={displayTitle}
              onFocus={() => snapshotBoard()}
              onChange={e => setTitle(e.target.value)}
              placeholder={`New ${card.type}`}
              autoFocus
            />
          </div>

          {attrSchema.length > 0 && (
            <div className={styles.attrSection}>
              <div className={styles.attrSectionHeader}>Attributes</div>
              {attrSchema.map(field => (
                <div key={field.key} className={styles.field}>
                  <label className={styles.label}>{field.label}</label>
                  {field.type === 'select' ? (
                    /* Attribute select — discrete, snapshot before change */
                    <select
                      className={styles.select}
                      value={(entity?.attributes[field.key] as string) ?? ''}
                      onChange={e => setAttrSelect(field.key, e.target.value)}
                    >
                      <option value="">—</option>
                      {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : field.type === 'textarea' ? (
                    /* Attribute textarea — snapshot on focus, then free-type */
                    <textarea
                      className={styles.textarea}
                      value={(entity?.attributes[field.key] as string) ?? ''}
                      onFocus={() => snapshotBoard()}
                      onChange={e => setAttr(field.key, e.target.value)}
                      placeholder={field.hint}
                      rows={2}
                    />
                  ) : (
                    /* Attribute text input — snapshot on focus, then free-type */
                    <input
                      className={styles.input}
                      value={(entity?.attributes[field.key] as string) ?? ''}
                      onFocus={() => snapshotBoard()}
                      onChange={e => setAttr(field.key, e.target.value)}
                      placeholder={field.hint}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Note — snapshot on focus, then free-type */}
          <div className={styles.field}>
            <label className={styles.label}>Note <span className={styles.tag}> · shared</span></label>
            <textarea
              className={styles.textarea}
              value={card.noteRaw}
              onFocus={() => snapshotBoard()}
              onChange={e => setNoteRaw(e.target.value)}
              placeholder="Add a note… (markdown supported)"
              rows={3}
            />
          </div>

          {/* Placement note — snapshot on focus, then free-type */}
          <div className={styles.field}>
            <label className={styles.label}>Placement note <span className={styles.tag}> · this card only</span></label>
            <textarea
              className={styles.textarea}
              value={card.instanceNote}
              onFocus={() => snapshotBoard()}
              onChange={e => setInstanceNote(e.target.value)}
              placeholder="Context for this placement…"
              rows={2}
            />
          </div>

          {/* Colour — discrete swatch click, snapshot before change */}
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
        </div>,
        worldRef.current
      )}

      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={contextMenuItems} onClose={() => setCtxMenu(null)} />
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

function InstanceIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="1" y="3.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="4" y="1" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.5 1"/>
    </svg>
  )
}
