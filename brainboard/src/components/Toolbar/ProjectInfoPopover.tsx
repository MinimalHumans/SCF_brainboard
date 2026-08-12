import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
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

  // Writes go through useBoardStore.getState() in flushPending, so the actions
  // aren't subscribed to here — only the board itself, for the field values.
  const board             = useBoardStore(s => s.board)
  const isDraft           = useLibraryStore(s => s.isDraft)
  const hasDraftChanges   = (board.syncMeta?.version ?? 0) > 0
  const needsNameToSave   = isDraft && hasDraftChanges

  const [pos, setPos] = useState({ top: 52, left: 0 })
  /*
   * Pending edits, held as VALUES rather than read back off the DOM at commit
   * time.
   *
   * The fields are uncontrolled and save on blur, which is fine while the user
   * moves between them but is a race with the popover closing: whichever of
   * "blur" and "unmount" wins decides whether the last thing typed survives.
   * commitFocusedField() below force-blurs on the two close paths this
   * component owns, but it cannot cover a close that comes from anywhere else,
   * and a blur that lands after React has torn the input down never reaches an
   * onBlur handler at all — the text is simply gone, which is what it looks
   * like from the outside.
   *
   * So every keystroke parks its value here, and flushPending() commits from
   * this object. It is called on blur (unchanged behaviour), on both close
   * paths, and — the part that actually closes the hole — from an unmount
   * cleanup, which React guarantees to run no matter who closed the popover
   * or why. Values live in a plain ref, not element refs: React nulls element
   * refs during unmount, so by cleanup time there would be nothing to read.
   */
  const pendingInfoRef = useRef<Partial<ProjectInfo>>({})
  /*
   * null means "the name field has not been edited in this session" — which is
   * also how the old nameDirtyRef flag worked, and it matters: an untouched
   * draft default ("Untitled Board", or a template's own name) must NOT count
   * as the user accepting that name and saving the board under it. Typing text
   * back to what it already was still counts, since onChange fires either way.
   */
  const pendingNameRef = useRef<string | null>(null)

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

  /*
   * Commit anything typed but not yet written to the store. Safe to call more
   * than once: each field is cleared from the pending object as it lands, so a
   * blur followed by the unmount flush commits once, not twice.
   *
   * Reads the store through getState() rather than the values captured in
   * render, because the unmount cleanup below runs with the closure from the
   * render that installed it.
   */
  const flushPending = useCallback(() => {
    const store = useBoardStore.getState()

    const info = pendingInfoRef.current
    if (Object.keys(info).length) {
      pendingInfoRef.current = {}
      store.updateProjectInfo(info)
    }

    const name = pendingNameRef.current
    pendingNameRef.current = null
    if (name !== null) {
      const t = name.trim()
      if (t) {
        store.setBoardName(t)
        void attemptSaveDraft()
      }
    }
    // Refs and getState() only — nothing from the render scope, so this is
    // genuinely stable and the effects below don't churn.
  }, [])

  // Blurs the focused field first so its own onBlur runs normally, then
  // commits whatever is still pending. Used by both close paths.
  const commitFocusedField = useCallback(() => {
    const active = document.activeElement
    if (popoverRef.current?.contains(active)) (active as HTMLElement).blur()
    flushPending()
  }, [flushPending])

  // Last line of defence: whoever unmounts this popover — the close paths
  // below, a re-render of the toolbar, a board switch — the pending values
  // are written first.
  useEffect(() => flushPending, [flushPending])

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
  }, [onClose, commitFocusedField])

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
          onFocus={() => snapshotBoard()}
          onChange={e => { pendingNameRef.current = e.target.value }}
          onBlur={flushPending}
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
              onChange={e => { pendingInfoRef.current[f.key] = e.target.value }}
              onBlur={flushPending}
              placeholder={f.placeholder}
              rows={2}
            />
          ) : (
            <input
              className={styles.input}
              defaultValue={pi[f.key] ?? ''}
              onFocus={() => snapshotBoard()}
              onChange={e => { pendingInfoRef.current[f.key] = e.target.value }}
              onBlur={flushPending}
              placeholder={f.placeholder}
            />
          )}
        </div>
      ))}
    </div>,
    document.body
  )
}
