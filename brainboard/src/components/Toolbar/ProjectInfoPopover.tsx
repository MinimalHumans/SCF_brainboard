import React, { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useBoardStore, snapshotBoard } from '@/store/boardStore'
import type { ProjectInfo } from '@/types/board'
import styles from './ProjectInfoPopover.module.css'

interface ProjectInfoPopoverProps {
  anchorRef: React.RefObject<HTMLButtonElement>
  onClose:   () => void
}

interface FieldDef {
  key:         keyof ProjectInfo
  label:       string
  placeholder: string
  textarea?:   boolean
}

const FIELDS: FieldDef[] = [
  { key: 'credit',    label: 'Credit',     placeholder: 'e.g. Written by' },
  { key: 'author',    label: 'Author',     placeholder: 'e.g. Jane Doe' },
  { key: 'source',    label: 'Source',     placeholder: 'e.g. Based on the novel by…' },
  { key: 'draftDate', label: 'Draft Date', placeholder: 'e.g. May 2026' },
  { key: 'contact',   label: 'Contact',    placeholder: 'Name, address, email, phone…', textarea: true },
  { key: 'copyright', label: 'Copyright',  placeholder: 'e.g. © 2026 Jane Doe' },
]

export function ProjectInfoPopover({ anchorRef, onClose }: ProjectInfoPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  const board             = useBoardStore(s => s.board)
  const setBoardName      = useBoardStore(s => s.setBoardName)
  const updateProjectInfo = useBoardStore(s => s.updateProjectInfo)

  const [pos, setPos] = useState({ top: 52, left: 0 })

  // Anchor below the button. useLayoutEffect so there's no visible flash.
  useLayoutEffect(() => {
    const btn = anchorRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left })
  }, [anchorRef])

  // Close on outside pointer-down or Escape.
  // capture: true on Escape so we win over Canvas's Escape handler.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    document.addEventListener('keydown',     onKeyDown,     { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
      document.removeEventListener('keydown',     onKeyDown,     { capture: true })
    }
  }, [onClose])

  const pi = board.projectInfo ?? {}

  return createPortal(
    <div
      ref={popoverRef}
      className={styles.popover}
      style={{ top: pos.top, left: pos.left }}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {/* Name — always the first field, autofocused */}
      <div className={styles.field}>
        <label className={styles.label}>Name</label>
        <input
          className={styles.input}
          defaultValue={board.name}
          onFocus={() => snapshotBoard()}
          onBlur={e => { const t = e.target.value.trim(); if (t) setBoardName(t) }}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
          placeholder="Board name"
          maxLength={80}
          autoFocus
        />
      </div>

      <div className={styles.divider} />

      <p className={styles.note}>
        These optional fields are used by future screenplay exports and on the title page.
      </p>

      {FIELDS.map(f => (
        <div key={f.key} className={styles.field}>
          <label className={styles.label}>{f.label}</label>
          {f.textarea ? (
            <textarea
              className={styles.textarea}
              defaultValue={pi[f.key] ?? ''}
              onFocus={() => snapshotBoard()}
              onBlur={e => updateProjectInfo({ [f.key]: e.target.value })}
              placeholder={f.placeholder}
              rows={2}
            />
          ) : (
            <input
              className={styles.input}
              defaultValue={pi[f.key] ?? ''}
              onFocus={() => snapshotBoard()}
              onBlur={e => updateProjectInfo({ [f.key]: e.target.value })}
              placeholder={f.placeholder}
            />
          )}
        </div>
      ))}
    </div>,
    document.body
  )
}
