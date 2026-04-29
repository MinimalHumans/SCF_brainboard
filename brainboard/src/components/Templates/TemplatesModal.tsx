import React, { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { nanoid } from 'nanoid'
import { useBoardStore } from '@/store/boardStore'
import { useTemplates } from '@/hooks/useTemplates'
import { toast } from '@/store/toastStore'
import type { Board, Card, Entity, Backdrop } from '@/types/board'
import styles from './TemplatesModal.module.css'

/* ── User template persistence ─────────────────────────────────────────── */

const USER_TEMPLATES_KEY = 'brainboard_user_templates'

export interface UserTemplate {
  id:      string
  name:    string
  savedAt: string
  board:   Board
}

function loadUserTemplates(): UserTemplate[] {
  try {
    const raw = localStorage.getItem(USER_TEMPLATES_KEY)
    return raw ? (JSON.parse(raw) as UserTemplate[]) : []
  } catch { return [] }
}

function saveUserTemplates(templates: UserTemplate[]): void {
  try { localStorage.setItem(USER_TEMPLATES_KEY, JSON.stringify(templates)) }
  catch { /* quota */ }
}

/* ── Merge helper ───────────────────────────────────────────────────────── */

function mergeBoard(current: Board, templateBoard: Board): Board {
  const OFFSET = 300
  const cardIdMap     = new Map<string, string>()
  const entityIdMap   = new Map<string, string>()
  const backdropIdMap = new Map<string, string>()
  templateBoard.cards.forEach(c    => cardIdMap.set(c.id, nanoid()))
  templateBoard.entities.forEach(e => entityIdMap.set(e.id, nanoid()))
  ;(templateBoard.backdrops ?? []).forEach(b => backdropIdMap.set(b.id, nanoid()))

  const remappedCards: Card[] = templateBoard.cards.map(c => ({
    ...c, id: cardIdMap.get(c.id)!,
    entityId: c.entityId ? entityIdMap.get(c.entityId) ?? null : null,
    position: { x: c.position.x + OFFSET, y: c.position.y + OFFSET },
  }))
  const remappedEntities: Entity[] = templateBoard.entities.map(e => ({
    ...e, id: entityIdMap.get(e.id)!,
  }))
  const remappedBackdrops: Backdrop[] = (templateBoard.backdrops ?? []).map(b => ({
    note: '', ...b, id: backdropIdMap.get(b.id)!,
    position: { x: b.position.x + OFFSET, y: b.position.y + OFFSET },
  }))

  return {
    ...current,
    updatedAt: new Date().toISOString(),
    cards:     [...current.cards, ...remappedCards],
    entities:  [...current.entities, ...remappedEntities],
    backdrops: [...(current.backdrops ?? []), ...remappedBackdrops],
  }
}

/* ── Modal component ────────────────────────────────────────────────────── */

interface TemplatesModalProps { onClose: () => void }

type Tab = 'default' | 'user'

export function TemplatesModal({ onClose }: TemplatesModalProps) {
  const [activeTab,      setActiveTab]      = useState<Tab>('default')
  const [userTemplates,  setUserTemplates]  = useState<UserTemplate[]>(loadUserTemplates)

  const defaultTemplates = useTemplates()
  const loadBoard        = useBoardStore(s => s.loadBoard)
  const board            = useBoardStore(s => s.board)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  /* ── Default template actions ─────────────────────────────────────────── */

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

  const handleMerge = useCallback((templateBoard: Board) => {
    loadBoard(mergeBoard(board, templateBoard))
    toast.success(`Merged "${templateBoard.name}" into current board`)
    onClose()
  }, [board, loadBoard, onClose])

  /* ── User template actions ────────────────────────────────────────────── */

  const handleSaveCurrent = useCallback(() => {
    const name = window.prompt('Name for this template:', board.name)
    if (!name || !name.trim()) return
    const entry: UserTemplate = {
      id:      nanoid(),
      name:    name.trim(),
      savedAt: new Date().toISOString(),
      board:   { ...board },
    }
    const updated = [entry, ...userTemplates]
    setUserTemplates(updated)
    saveUserTemplates(updated)
    toast.success(`Saved "${name.trim()}" to My Templates`)
    setActiveTab('user')
  }, [board, userTemplates])

  const handleDeleteUserTemplate = useCallback((id: string, name: string) => {
    const ok = window.confirm(`Delete user template "${name}"?\n\nThis cannot be undone.`)
    if (!ok) return
    const updated = userTemplates.filter(t => t.id !== id)
    setUserTemplates(updated)
    saveUserTemplates(updated)
    toast.success(`Deleted template "${name}"`)
  }, [userTemplates])

  const handleUserNewBoard = useCallback((t: UserTemplate) => {
    handleNewBoard(t.board)
  }, [handleNewBoard])

  const handleUserMerge = useCallback((t: UserTemplate) => {
    handleMerge(t.board)
  }, [handleMerge])

  /* ── Render ───────────────────────────────────────────────────────────── */

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-label="Templates">

        {/* Header */}
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Templates</h2>
            <p className={styles.subtitle}>
              Start from a template or merge into your current board.
            </p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        {/* Tab bar */}
        <div className={styles.tabBar}>
          <button
            className={`${styles.tab} ${activeTab === 'default' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('default')}
          >
            Default
            <span className={styles.tabBadge}>{defaultTemplates.length}</span>
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'user' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('user')}
          >
            My Templates
            <span className={styles.tabBadge}>{userTemplates.length}</span>
          </button>
          <div className={styles.tabFlex} />
          <button className={styles.saveBtn} onClick={handleSaveCurrent} title="Save current board as a user template">
            + Save current board
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {activeTab === 'default' && (
            defaultTemplates.length === 0
              ? <EmptyState msg="No default templates found." hint={`Place .json files in src/templates/ and restart.`} />
              : <div className={styles.grid}>
                  {defaultTemplates.map(t => (
                    <DefaultCard key={t.id} t={t} onNew={handleNewBoard} onMerge={handleMerge} />
                  ))}
                </div>
          )}
          {activeTab === 'user' && (
            userTemplates.length === 0
              ? <EmptyState msg="No saved templates yet." hint={'Use "Save current board" above to add one.'} />
              : <div className={styles.grid}>
                  {userTemplates.map(t => (
                    <UserCard key={t.id} t={t}
                      onNew={handleUserNewBoard}
                      onMerge={handleUserMerge}
                      onDelete={handleDeleteUserTemplate}
                    />
                  ))}
                </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function DefaultCard({ t, onNew, onMerge }: {
  t: ReturnType<typeof useTemplates>[number]
  onNew:   (b: Board) => void
  onMerge: (b: Board) => void
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardName}>{t.name}</span>
      </div>
      <div className={styles.cardMeta}>
        <span>{t.cardCount} card{t.cardCount !== 1 ? 's' : ''}</span>
        {t.backdropCount > 0 && <span>{t.backdropCount} backdrop{t.backdropCount !== 1 ? 's' : ''}</span>}
      </div>
      <div className={styles.cardActions}>
        <button className={styles.actionMerge} onClick={() => onMerge(t.board)} title="Append to current board">Merge into current</button>
        <button className={styles.actionNew}   onClick={() => onNew(t.board)}   title="Replace current board">New board</button>
      </div>
    </div>
  )
}

function UserCard({ t, onNew, onMerge, onDelete }: {
  t:        UserTemplate
  onNew:    (t: UserTemplate) => void
  onMerge:  (t: UserTemplate) => void
  onDelete: (id: string, name: string) => void
}) {
  const savedDate = new Date(t.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const cards     = t.board.cards?.length ?? 0
  const bds       = t.board.backdrops?.length ?? 0

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardName}>{t.name}</span>
        <button className={styles.deleteBtn} onClick={() => onDelete(t.id, t.name)} title="Delete template" aria-label="Delete">×</button>
      </div>
      <div className={styles.cardMeta}>
        <span>{cards} card{cards !== 1 ? 's' : ''}</span>
        {bds > 0 && <span>{bds} backdrop{bds !== 1 ? 's' : ''}</span>}
        <span className={styles.cardDate}>{savedDate}</span>
      </div>
      <div className={styles.cardActions}>
        <button className={styles.actionMerge} onClick={() => onMerge(t)} title="Append to current board">Merge into current</button>
        <button className={styles.actionNew}   onClick={() => onNew(t)}   title="Replace current board">New board</button>
      </div>
    </div>
  )
}

function EmptyState({ msg, hint }: { msg: string; hint: string }) {
  return (
    <div className={styles.empty}>
      <p>{msg}</p>
      <p className={styles.emptyHint}>{hint}</p>
    </div>
  )
}
