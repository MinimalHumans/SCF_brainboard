import React, { useCallback, useEffect, useRef, useState } from 'react'
import styles from './HoldToConfirmButton.module.css'

/*
 * HoldToConfirmButton — the app-wide confirmation pattern for destructive
 * actions, replacing OS-level confirm() popups (which can't be exercised
 * from pure-JS tests).
 *
 * Mechanics:
 *  - Press and hold: a progress fill charges from 0 → 100% over `duration`.
 *  - Reaching 100% ARMS the action but never auto-fires — the button stays
 *    charged for as long as the pointer is held.
 *  - The action commits only on RELEASE while still over the button.
 *  - Releasing early (before full) or dragging off the button at any point
 *    (even fully charged) cancels and resets to zero.
 *
 * Pointer events cover mouse, touch, and pen uniformly; keyboard users get
 * the same hold semantics via Space/Enter (keydown charges, keyup commits).
 *
 * Callers pick `duration`: ~600–800ms for a general destructive action;
 * shorter (see TRASH_HOLD_MS in the Trash view) where the user is already
 * inside an explicitly destructive context and it should feel snappier.
 */

export const DEFAULT_HOLD_MS = 700

interface HoldToConfirmButtonProps {
  onConfirm:  () => void
  /** Hold time in ms before the action arms. Default 700. */
  duration?:  number
  disabled?:  boolean
  title?:     string
  className?: string
  children:   React.ReactNode
}

export function HoldToConfirmButton({
  onConfirm, duration = DEFAULT_HOLD_MS, disabled, title, className, children,
}: HoldToConfirmButtonProps) {
  const [progress, setProgress] = useState(0)
  const btnRef      = useRef<HTMLButtonElement | null>(null)
  const rafRef      = useRef<number | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  // Latest onConfirm without needing it memoised by callers.
  const confirmRef  = useRef(onConfirm)
  useEffect(() => { confirmRef.current = onConfirm })

  const reset = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (pointerIdRef.current !== null && btnRef.current?.hasPointerCapture(pointerIdRef.current)) {
      try { btnRef.current.releasePointerCapture(pointerIdRef.current) } catch { /* already released */ }
    }
    startedAtRef.current = null
    pointerIdRef.current = null
    setProgress(0)
  }, [])

  useEffect(() => reset, [reset])

  const startCharging = useCallback(() => {
    startedAtRef.current = performance.now()
    const tick = () => {
      if (startedAtRef.current === null) return
      const p = Math.min(1, (performance.now() - startedAtRef.current) / duration)
      setProgress(p)
      // Keep ticking only until fully charged — at 1 the button just sits
      // armed until release/leave.
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
      else rafRef.current = null
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [duration])

  const isCharging = () => startedAtRef.current !== null
  const isArmed = () =>
    startedAtRef.current !== null && performance.now() - startedAtRef.current >= duration

  const commitIfArmed = useCallback(() => {
    const armed = isArmed()
    reset()
    if (armed) confirmRef.current()
  }, [reset]) // eslint-disable-line react-hooks/exhaustive-deps

  const isInside = (e: React.PointerEvent) => {
    const r = btnRef.current?.getBoundingClientRect()
    return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
    // Capture so move/up keep arriving even when the pointer wanders off
    // the button — leaving must cancel, which we detect via move-outside.
    // try/catch: capturing an already-inactive pointer throws, and a failed
    // capture just means we fall back to plain bubbling events.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    pointerIdRef.current = e.pointerId
    startCharging()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isCharging() || e.pointerId !== pointerIdRef.current) return
    // Dragging/mousing off the element cancels outright — even when fully
    // charged. Wandering back does NOT resume; the user starts over.
    if (!isInside(e)) reset()
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!isCharging() || e.pointerId !== pointerIdRef.current) return
    if (isInside(e)) commitIfArmed()
    else reset()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return
    e.preventDefault()
    if (!isCharging()) startCharging()
  }

  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    commitIfArmed()
  }

  const armed = progress >= 1
  return (
    <button
      ref={btnRef}
      type="button"
      title={title}
      disabled={disabled}
      className={`${styles.holdBtn} ${armed ? styles.armed : ''} ${className ?? ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={reset}
      // A touch hold would otherwise open the OS context menu mid-charge.
      onContextMenu={e => e.preventDefault()}
    >
      <span className={styles.fill} style={{ width: `${progress * 100}%` }} aria-hidden="true" />
      <span className={styles.label}>{children}</span>
    </button>
  )
}
