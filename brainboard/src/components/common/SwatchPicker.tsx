import React, { useRef, useCallback, useId } from 'react'
import { SWATCH_KEYS, type SwatchKey } from '@/types/board'

/*
 * SwatchPicker — the colour row shared by the Card and Backdrop edit panels.
 * ==========================================================================
 *
 * Why this exists
 * ---------------
 * Card and Backdrop each grew their own copy of this row, and the copies
 * drifted: Card's swatches had tabIndex={0} and an aria-label, Backdrop's had
 * neither. Neither had a key handler, so *both* were mouse-only in practice —
 * the tabIndex on Card's just meant you could focus a control you then had no
 * way to activate. One component means the next fix lands in both places.
 *
 * Why radiogroup and not 24 buttons
 * ---------------------------------
 * There are 24 swatches. Making each a tab stop would put 24 stops between the
 * note field and the Publish button, which is hostile to keyboard users even
 * though it technically satisfies "focusable".
 *
 * A radiogroup is also the honest semantics: this is a single-select from a
 * fixed set, which is what a radio group *is*. The APG pattern for it is
 * roving tabindex — the group holds exactly one tab stop, and arrow keys move
 * within it:
 *
 *   Tab          enter/leave the group (lands on the selected swatch)
 *   ArrowRight/Down   next swatch, wrapping
 *   ArrowLeft/Up      previous swatch, wrapping
 *   Home / End        first / last
 *
 * Selection follows focus (automatic activation), which is the APG default for
 * radio groups and is appropriate here: choosing a colour is instant, cheap,
 * and undoable via the board's existing snapshot/undo stack.
 *
 * Styling
 * -------
 * Card and Backdrop size their swatches differently on purpose (18px vs 16px,
 * different hover scale), so this component takes class names rather than
 * owning a stylesheet. It renders structure and behaviour; the callers keep
 * their own visual treatment.
 */

export interface SwatchPickerClassNames {
  /** Wrapper around label + row. */
  field:  string
  /** The "Color" caption. */
  label:  string
  /** Flex row holding the swatches. */
  row:    string
  /** A single swatch dot. */
  swatch: string
  /** Applied additionally to the selected swatch. */
  active: string
}

interface SwatchPickerProps {
  /** Currently selected swatch, if any. */
  value:      SwatchKey | string | undefined
  /** Fired on click or on keyboard selection. */
  onSelect:   (swatch: SwatchKey) => void
  classNames: SwatchPickerClassNames
  /** Visible caption, also used as the group's accessible name. */
  label?:     string
}

export function SwatchPicker({
  value,
  onSelect,
  classNames,
  label = 'Color',
}: SwatchPickerProps) {
  const labelId = useId()
  const refs    = useRef<Array<HTMLButtonElement | null>>([])

  /*
   * The roving tab stop. If nothing is selected yet the first swatch takes it,
   * so the group is always reachable — a group where every child is
   * tabIndex={-1} is a keyboard trap in reverse: you can never get in.
   */
  const selectedIdx = SWATCH_KEYS.indexOf(value as SwatchKey)
  const tabStopIdx  = selectedIdx === -1 ? 0 : selectedIdx

  const move = useCallback((to: number) => {
    const n    = SWATCH_KEYS.length
    const next = ((to % n) + n) % n          // wrap in both directions
    onSelect(SWATCH_KEYS[next])
    refs.current[next]?.focus()
  }, [onSelect])

  const handleKeyDown = useCallback((e: React.KeyboardEvent, idx: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':  e.preventDefault(); move(idx + 1); break
      case 'ArrowLeft':
      case 'ArrowUp':    e.preventDefault(); move(idx - 1); break
      case 'Home':       e.preventDefault(); move(0); break
      case 'End':        e.preventDefault(); move(SWATCH_KEYS.length - 1); break

      /*
       * Enter and Space are redundant under automatic activation — focusing a
       * swatch has already selected it — but the APG expects them to work, and
       * a user who tabs in and presses Space should not wonder if it took.
       * Space must be intercepted regardless or the panel scrolls.
       */
      case ' ':
      case 'Enter':      e.preventDefault(); onSelect(SWATCH_KEYS[idx]); break

      default: break
    }
    // Stop the board's global key handlers (Tab opens the TabMenu, Escape
    // clears modes) from reacting to keys meant for this group.
    e.stopPropagation()
  }, [move, onSelect])

  return (
    <div className={classNames.field}>
      {/*
        A <label> with no associated form control labels nothing. This is a
        plain caption, and the group is named via aria-labelledby instead.
      */}
      <span className={classNames.label} id={labelId}>{label}</span>

      <div className={classNames.row} role="radiogroup" aria-labelledby={labelId}>
        {SWATCH_KEYS.map((swatch, idx) => {
          const selected = swatch === value
          return (
            <button
              key={swatch}
              ref={el => { refs.current[idx] = el }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={swatch}
              title={swatch}
              tabIndex={idx === tabStopIdx ? 0 : -1}
              className={`${classNames.swatch} ${selected ? classNames.active : ''}`}
              style={{ '--dot': `var(--swatch-${swatch})` } as React.CSSProperties}
              /*
               * Selection stays on pointerdown rather than click. The panel is
               * a child of a draggable card/backdrop, and the original code
               * used preventDefault here to stop a drag gesture starting on
               * the swatch. Moving to onClick would let pointerdown through to
               * the drag handler first.
               *
               * preventDefault also suppresses the focus that a click would
               * normally give the button, which is what we want: clicking a
               * swatch should not silently relocate the keyboard tab stop.
               *
               * There is deliberately no onClick — keyboard activation is
               * handled in onKeyDown, so adding one would double-apply.
               */
              onPointerDown={e => {
                e.stopPropagation()
                e.preventDefault()
                onSelect(swatch)
              }}
              onKeyDown={e => handleKeyDown(e, idx)}
            />
          )
        })}
      </div>
    </div>
  )
}
