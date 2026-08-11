import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { buildFountain } from '@/utils/buildFountain'
import { buildFDX } from '@/utils/buildFDX'
import { toast } from '@/store/toastStore'
import type { Board } from '@/types/board'
import styles from './ExportModal.module.css'

interface ExportOption {
  label: string
  desc:  string
  ext:   string
  mime:  string
  build: (board: Board) => string
}

const OPTIONS: ExportOption[] = [
  {
    label: 'Scriptyard Raw JSON',
    desc:  'Full Scriptyard format — reimport or archive',
    ext:   '.scriptyard.json',
    mime:  'application/json',
    build: board => JSON.stringify(board, null, 2),
  },
  {
    label: 'Fountain',
    desc:  'Script skeleton for Highland, Slugline, and Final Draft',
    ext:   '.fountain',
    mime:  'text/plain;charset=utf-8',
    build: buildFountain,
  },
  {
    label: 'Final Draft',
    desc:  'Script skeleton for Final Draft 10+',
    ext:   '.fdx',
    mime:  'application/xml;charset=utf-8',
    build: buildFDX,
  },
]

// Strips only characters that are actually invalid in a filename — the user
// is meant to be able to tweak this freely, not have their casing/spacing
// silently mangled the way the old auto-generated export name was.
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').trim() || 'board'
}

function download(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface ExportModalProps {
  onClose: () => void
  // Full board content for whichever board the user picked — the active
  // board, or another one loaded on demand from OPFS. Never fetched inside
  // this component, so it never has to show its own loading state.
  board: Board
}

/*
 * ExportModal — the single place every export format lives now (JSON,
 * Fountain, FDX), reachable both from the Boards list's own "Export…"
 * button (current board) and from a row's ⋮ menu (that row's board). The
 * output name is editable and independent of the board's own name — it's
 * only ever used for the downloaded file.
 */
export function ExportModal({ onClose, board }: ExportModalProps) {
  const [outputName, setOutputName] = useState(board.name.trim() || 'Untitled')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const cardCount     = board.cards?.length ?? 0
  const backdropCount = board.backdrops?.length ?? 0

  const handleExport = (opt: ExportOption) => {
    const filename = `${sanitizeFilename(outputName)}${opt.ext}`
    try {
      download(opt.build(board), filename, opt.mime)
      toast.success(`Exported "${filename}"`)
      onClose()
    } catch (err) {
      console.error(`${opt.label} export failed`, err)
      toast.error(`${opt.label} export failed — check the console for details.`)
    }
  }

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-label="Export">
        <div className={styles.header}>
          <h2 className={styles.title}>Export</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.body}>
          <div className={styles.boardInfo}>
            <span className={styles.boardName}>{board.name}</span>
            <span className={styles.boardMeta}>
              <span>{cardCount} card{cardCount !== 1 ? 's' : ''}</span>
              {backdropCount > 0 && <span>{backdropCount} backdrop{backdropCount !== 1 ? 's' : ''}</span>}
            </span>
          </div>

          <label className={styles.nameLabel} htmlFor="export-output-name">Output name</label>
          <input
            id="export-output-name"
            className={styles.nameInput}
            value={outputName}
            onChange={e => setOutputName(e.target.value)}
            autoFocus
          />

          <div className={styles.optionList}>
            {OPTIONS.map(opt => (
              <button key={opt.ext} className={styles.option} onClick={() => handleExport(opt)}>
                <div className={styles.optionText}>
                  <span className={styles.optionLabel}>{opt.label}</span>
                  <span className={styles.optionDesc}>{opt.desc}</span>
                </div>
                <span className={styles.optionExt}>{opt.ext}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
