import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

/*
 * AutoGrowTextarea
 * ----------------
 * A textarea that is always exactly as tall as its content, so nothing the
 * user types is hidden behind an inner scrollbar. `rows` only ever sets the
 * STARTING height of a plain <textarea>; past that the browser scrolls the
 * content instead of growing the box, which is what made long attribute and
 * note text look truncated in the card editor.
 *
 * Mechanics: reset height to 'auto' (so scrollHeight reports the content
 * height rather than the current box height), then pin height to scrollHeight.
 * Done in useLayoutEffect so the resize is painted in the same frame as the
 * keystroke — no visible jump.
 *
 * `resize: none` is set inline because manual resizing and auto-growing fight
 * each other: the next keystroke would overwrite whatever the user dragged.
 * The min-height in the stylesheet still acts as a floor.
 *
 * Width changes (rotating a phone, the touch sheet re-laying out) change the
 * wrap point and therefore the needed height, so a window resize recomputes.
 */

interface AutoGrowTextareaProps {
  value:        string
  onChange:     (value: string) => void
  onFocus?:     () => void
  onBlur?:      (e: React.FocusEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  className?:   string
  /** Height floor, in lines, before any content is entered. */
  minRows?:     number
}

export function AutoGrowTextarea({
  value, onChange, onFocus, onBlur, placeholder, className, minRows = 2,
}: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const fit = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useLayoutEffect(fit, [fit, value])

  useEffect(() => {
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [fit])

  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      rows={minRows}
      onFocus={onFocus}
      onBlur={onBlur}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ overflowY: 'hidden', resize: 'none' }}
    />
  )
}
