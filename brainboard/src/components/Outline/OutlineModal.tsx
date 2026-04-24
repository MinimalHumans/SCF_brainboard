import React, { useState, useEffect, useMemo } from 'react'
import { createPortal }    from 'react-dom'
import { marked }          from 'marked'
import { useBoardStore }   from '@/store/boardStore'
import { buildOutline }    from '@/utils/buildOutline'
import { toast }           from '@/store/toastStore'
import styles              from './OutlineModal.module.css'

interface OutlineModalProps {
  onClose: () => void
}

export function OutlineModal({ onClose }: OutlineModalProps) {
  const [mode, setMode] = useState<'rendered' | 'raw'>('rendered')

  // Live subscription — recomputes whenever board mutates while modal is open
  const board    = useBoardStore(s => s.board)
  const markdown = useMemo(() => buildOutline(board), [board])
  const html     = useMemo(() => marked.parse(markdown) as string, [markdown])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown)
      toast.success('Outline copied to clipboard')
    } catch {
      toast.error('Failed to copy to clipboard')
    }
  }

  const handleExport = () => {
    const safeName = board.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'board'
    const blob     = new Blob([markdown], { type: 'text/markdown' })
    const url      = URL.createObjectURL(blob)
    const a        = document.createElement('a')
    a.href         = url
    a.download     = `${safeName}-outline.md`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${safeName}-outline.md`)
  }

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Outline"
      >
        {/* Header */}
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Outline</h2>
            <p className={styles.subtitle}>A Markdown outline of your current board</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        {/* Mode toggle */}
        <div className={styles.modeBar}>
          <div className={styles.modeToggle}>
            <button
              className={`${styles.modeBtn} ${mode === 'rendered' ? styles.modeBtnActive : ''}`}
              onClick={() => setMode('rendered')}
            >
              Rendered
            </button>
            <button
              className={`${styles.modeBtn} ${mode === 'raw' ? styles.modeBtnActive : ''}`}
              onClick={() => setMode('raw')}
            >
              Raw
            </button>
          </div>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {mode === 'rendered' ? (
            <div
              className={styles.prose}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <pre className={styles.raw}>{markdown}</pre>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button className={styles.footerBtn} onClick={handleCopy}>
            Copy Markdown
          </button>
          <button
            className={`${styles.footerBtn} ${styles.footerBtnPrimary}`}
            onClick={handleExport}
          >
            Export .md
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
