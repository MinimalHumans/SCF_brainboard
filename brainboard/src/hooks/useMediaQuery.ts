import { useState, useEffect } from 'react'

/*
 * useMediaQuery — subscribe to a CSS media query and return its current match.
 *
 * Used by the Toolbar to switch between the full layout and the compact
 * (overflow-menu) layout at the 720px breakpoint. It reacts live to viewport
 * resize, so a desktop window dragged below the breakpoint collapses to the
 * compact layout and restores when widened — without a reload.
 *
 * Guarded for environments without window / matchMedia (SSR, very old
 * browsers): both paths resolve to false there, i.e. "treat as wide".
 */
export function useMediaQuery(query: string): boolean {
  const getMatch = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false

  const [matches, setMatches] = useState<boolean>(getMatch)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    // Sync immediately in case the match changed between render and effect.
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
