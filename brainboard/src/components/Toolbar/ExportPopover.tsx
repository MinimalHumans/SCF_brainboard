import React, { useRef, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBoardStore } from '@/store/boardStore'
import { buildFountain } from '@/utils/buildFountain'
import { buildFDX }      from '@/utils/buildFDX'
import { toast }         from '@/store/toastStore'
import styles            from './ExportPopover.module.css'

interface ExportPopoverProps {
  anchorRef:     React.RefObject<HTMLButtonElement>
  onClose:       () => void
  /** Called for the JSON export — delegates to usePersistence.exportBoard. */
  onExportJson?: () => void
}

interface ExportOption {
  label:    string
  desc:     string
  ext:      string
  action:   () => void
}

export function ExportPopover({ anchorRef, onClose, onExportJson }: ExportPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const board      = useBoardStore(s => s.board)
  const [pos, setPos] = useState({ top: 52, left: 0 })

  // Position below the anchor button, keeping the right edge in viewport.
  useLayoutEffect(() => {
    const btn = anchorRef.current
    if (!btn) return
    const rect    = btn.getBoundingClientRect()
    const popW    = 272
    const padding = 8
    const left    = Math.min(rect.left, window.innerWidth - popW - padding)
    setPos({ top: rect.bottom + 4, left: Math.max(padding, left) })
  }, [anchorRef])

  // Close on outside pointer-down or Escape.
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

  const safeName = board.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'board'

  function download(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const options: ExportOption[] = [
    {
      label:  'Board Data',
      desc:   'Full Brainboard format — reimport or archive',
      ext:    '.json',
      action: () => {
        onExportJson?.()
        onClose()
      },
    },
    {
      label:  'Fountain',
      desc:   'Script skeleton for Highland, Slugline, and Final Draft',
      ext:    '.fountain',
      action: () => {
        try {
          const text = buildFountain(board)
          download(text, `${safeName}.fountain`, 'text/plain;charset=utf-8')
          toast.success(`Exported "${board.name}.fountain"`)
        } catch (err) {
          console.error('Fountain export failed', err)
          toast.error('Fountain export failed — check the console for details.')
        }
        onClose()
      },
    },
    {
      label:  'Final Draft',
      desc:   'Script skeleton for Final Draft 10+',
      ext:    '.fdx',
      action: () => {
        try {
          const text = buildFDX(board)
          download(text, `${safeName}.fdx`, 'application/xml;charset=utf-8')
          toast.success(`Exported "${board.name}.fdx"`)
        } catch (err) {
          console.error('FDX export failed', err)
          toast.error('FDX export failed — check the console for details.')
        }
        onClose()
      },
    },
  ]

  return createPortal(
    <div
      ref={popoverRef}
      className={styles.popover}
      style={{ top: pos.top, left: pos.left }}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div className={styles.header}>Export as</div>

      {options.map((opt, i) => (
        <React.Fragment key={opt.ext}>
          {i === 1 && <div className={styles.divider} />}
          <button className={styles.item} onClick={opt.action}>
            <div className={styles.itemText}>
              <span className={styles.itemLabel}>{opt.label}</span>
              <span className={styles.itemDesc}>{opt.desc}</span>
            </div>
            <span className={styles.itemExt}>{opt.ext}</span>
          </button>
        </React.Fragment>
      ))}
    </div>,
    document.body,
  )
}
