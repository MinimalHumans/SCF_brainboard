import { useEffect, useRef, useCallback } from 'react'
import { useBoardStore } from '@/store/boardStore'
import { toast } from '@/store/toastStore'
import { echo, sizeBucket } from '@/telemetry/echo'
import type { Board } from '@/types/board'

const STORAGE_KEY    = 'brainboard_v1'
const AUTOSAVE_DELAY = 500

// Autosave runs every 500ms; if localStorage is full every save fails, so
// report the first failure per session rather than a flood.
let autosaveErrorReported = false

/** Anonymous board-size tags: bucketed counts only, never content. */
function boardSizeTags(board: Board) {
  return {
    cards:     sizeBucket(board.cards.length),
    backdrops: sizeBucket((board.backdrops ?? []).length),
  }
}

export function usePersistence() {
  const board     = useBoardStore(s => s.board)
  const loadBoard = useBoardStore(s => s.loadBoard)
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLoadedRef = useRef(false)

  // Load on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Board
        if (parsed.schemaVersion === 1 && Array.isArray(parsed.cards)) {
          loadBoard(parsed)
          echo.counter('board_load', 1, { source: 'autosave', ...boardSizeTags(parsed) })
        } else {
          echo.log('autosave_restore_error', `unusable saved board (schemaVersion ${parsed.schemaVersion})`, { severity: 'warn' })
        }
      } else {
        echo.counter('board_load', 1, { source: 'fresh' })
      }
    } catch (err) {
      echo.log('autosave_restore_error', err, { severity: 'error' })
    }
    isLoadedRef.current = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autosave
  useEffect(() => {
    if (!isLoadedRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(board))
      } catch (err) {
        // Quota exceeded means silent data loss for the user — worth knowing.
        if (!autosaveErrorReported) {
          autosaveErrorReported = true
          echo.log('autosave_error', err, { severity: 'error', ...boardSizeTags(board) })
        }
      }
    }, AUTOSAVE_DELAY)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [board])

  // Export
  const exportBoard = useCallback(() => {
    const json     = JSON.stringify(board, null, 2)
    const blob     = new Blob([json], { type: 'application/json' })
    const url      = URL.createObjectURL(blob)
    const a        = document.createElement('a')
    const safeName = board.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'board'
    a.href         = url
    a.download     = `${safeName}.scriptyard.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported "${board.name}"`)
    echo.counter('export', 1, { format: 'json', ...boardSizeTags(board) })
  }, [board])

  // Import
  const importBoard = useCallback(() => {
    const input    = document.createElement('input')
    input.type     = 'file'
    input.accept   = '.json,.brainboard.json,.scriptyard.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string) as Board
          if (parsed.schemaVersion !== 1) {
            toast.error(`Unknown schema version: ${(parsed as any).schemaVersion}`)
            echo.counter('import', 1, { outcome: 'bad_schema' })
            return
          }
          if (!Array.isArray(parsed.cards)) {
            toast.error('Invalid board file.')
            echo.counter('import', 1, { outcome: 'invalid' })
            return
          }
          loadBoard(parsed)
          toast.success(`Loaded "${parsed.name}"`)
          echo.counter('import', 1, { outcome: 'success', ...boardSizeTags(parsed) })
        } catch {
          toast.error('Could not parse board file.')
          echo.counter('import', 1, { outcome: 'parse_error' })
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }, [loadBoard])

  return { exportBoard, importBoard }
}
