import React, { useRef, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './AboutPopover.module.css'

interface AboutPopoverProps {
  anchorRef: React.RefObject<HTMLButtonElement>
  onClose:   () => void
}

export function AboutPopover({ anchorRef, onClose }: AboutPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 52, left: 0 })

  useLayoutEffect(() => {
    const btn = anchorRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left })
  }, [anchorRef])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    document.addEventListener('keydown',     onKeyDown,     { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
      document.removeEventListener('keydown',     onKeyDown,     { capture: true })
    }
  }, [onClose])

  return createPortal(
    <div
      ref={popoverRef}
      className={styles.popover}
      style={{ top: pos.top, left: pos.left }}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div className={styles.brand}>
        <span className={`${styles.wordmark} text-display`}>Brainboard</span>
        <span className={styles.byline}>Created by Minimal Humans</span>
      </div>

      <div className={styles.divider} />

      <div className={styles.links}>
        <div className={styles.linkRow}>
          <span className={styles.linkLabel}>Website</span>
          <a
            className={styles.link}
            href="https://minimal-humans.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            minimal-humans.com
          </a>
        </div>

        <div className={styles.linkRow}>
          <span className={styles.linkLabel}>Feedback &amp; feature requests</span>
          <a
            className={styles.link}
            href="https://discord.gg/T42Y2tPXsJ"
            target="_blank"
            rel="noopener noreferrer"
          >
            Join our Discord
          </a>
        </div>
      </div>

      <div className={styles.divider} />

      <p className={styles.note}>
        Share your thoughts, report bugs, or request features in the Discord channel.
      </p>
    </div>,
    document.body,
  )
}
