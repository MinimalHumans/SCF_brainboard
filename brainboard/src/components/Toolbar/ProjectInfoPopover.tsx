import React, { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useBoardStore, snapshotBoard } from '@/store/boardStore'
import { useLibraryStore } from '@/store/libraryStore'
import { attemptSaveDraft } from '@/lib/boardDraft'
import type { ProjectInfo } from '@/types/board'
import styles from './ProjectInfoPopover.module.css'
import { IS_TOUCH_PRIMARY } from '@/utils/isTouchPrimary'

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
  const isDraft           = useLibraryStore(s => s.isDraft)
  const hasDraftChanges   = (board.syncMeta?.version ?? 0) > 0
  const needsNameToSave   = isDraft && hasDraftChanges

  const [pos, setPos] = useState({ top: 52, left: 0 })
  // Whether the user has actually typed into the name field since it was
  // focused — a defocus with no edit must be a no-op (in particular, must
  // NOT count as "accepting" a fresh draft's default name). Retyping the
  // same text back (e.g. delete a char, undo it) still counts: any onChange
  // marks it dirty, regardless of what the final value ends up being.
  const nameDirtyRef = useRef(false)

  // Anchor below the button. useLayoutEffect so there's no visible flash.
  // Clamp the left edge so the 320px popover never runs off a narrow (phone)
  // viewport — the board name can sit mid-bar, so an un-clamped left would
  // push the right edge off-screen. Paired with max-width in the CSS for the
  // smallest screens where even the clamped 320px would overflow.
  useLayoutEffect(() => {
    const btn = anchorRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const PAD = 8
    const W   = 320
    const left = Math.max(PAD, Math.min(rect.left, window.innerWidth - W - PAD))
    setPos({ top: rect.bottom + 4, left })
  }, [anchorRef])

  // Commits whatever field is currently focused (if any) before the popover
  // unmounts. Both close paths below fire before a natural blur would ever
  // reach the input — closing first would silently discard an in-progress
  // edit, since onBlur (where fields actually save) never gets to run once
  // the input is torn down.
  const commitFocusedField = () => {
    const active = document.activeElement
    if (popoverRef.current?.contains(active)) (active as HTMLElement).blur()
  }

  // Close on outside pointer-down or Escape.
  // capture: true on Escape so we win over Canvas's Escape handler.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        commitFocusedField()
        onClose()
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        commitFocusedField()
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
          className={needsNameToSave ? `${styles.input} ${styles.inputNeedsSave}` : styles.input}
          defaultValue={board.name}
          onFocus={() => { snapshotBoard(); nameDirtyRef.current = false }}
          onChange={() => { nameDirtyRef.current = true }}
          onBlur={e => {
            // Untouched draft default ("Untitled Board", or a template's own
            // name) doesn't count until the user has actually edited the
            // field — even editing it back to the same text counts, an
            // unfocused field that was never touched does not.
            if (!nameDirtyRef.current) return
            nameDirtyRef.current = false
            const t = e.target.value.trim()
            if (!t) return
            setBoardName(t)
            void attemptSaveDraft()
          }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          placeholder="Board name"
          maxLength={80}
          autoFocus={!IS_TOUCH_PRIMARY}
        />
        {needsNameToSave && (
          <p className={styles.needsSaveNote}>This board isn&apos;t saved yet — edit the name to save it.</p>
        )}
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
