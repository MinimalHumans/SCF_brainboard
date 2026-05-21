/**
 * Detect whether the device's primary pointer is touch (phone, tablet)
 * versus mouse-like (desktop, laptop without touchscreen, or with one).
 *
 * Used to gate behaviours that work poorly on touch — chiefly autoFocus
 * on text inputs, which would summon the iOS keyboard the moment a panel
 * opens and push the visual viewport upward, taking the toolbar with it.
 *
 * Detection combines two signals:
 *
 *   1. `(pointer: coarse)` media query — true when the primary input
 *      mechanism is coarse (finger, stylus). False on mouse / trackpad.
 *
 *   2. `navigator.maxTouchPoints > 0` — true on any device with a
 *      touchscreen, regardless of which input is "primary". This is the
 *      important fallback: an iPad with a Magic Keyboard attached reports
 *      its primary pointer as `fine` (because the trackpad is the primary
 *      input), but it still has a touchscreen and will pop the virtual
 *      keyboard if a text input is autofocused via touch interaction.
 *
 * We OR the two together so any touch-capable device opts out of
 * autoFocus. False positives (touch laptop where user is on a mouse)
 * just lose autoFocus on a few inputs — minor UX cost, not a bug.
 *
 * Resolved once at module load. Switching primary pointer mid-session
 * is rare enough that we don't subscribe to media query changes.
 *
 * Guarded for environments where window or matchMedia might not exist
 * (very old browsers, SSR); both paths in those edge cases resolve to
 * `false`, treating the device as mouse-primary — safer default.
 */
export const IS_TOUCH_PRIMARY: boolean =
  typeof window !== 'undefined' && (
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    (typeof window.matchMedia === 'function' &&
     window.matchMedia('(pointer: coarse)').matches)
  )
