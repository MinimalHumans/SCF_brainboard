import { useEffect, useRef, useCallback } from 'react'
import { useBoardStore } from '@/store/boardStore'
import { toast } from '@/store/toastStore'
import type { Board } from '@/types/board'

const STORAGE_KEY    = 'brainboard_v1'
const AUTOSAVE_DELAY = 500

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
        }
      }
    } catch { /* start fresh */ }
    isLoadedRef.current = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autosave
  useEffect(() => {
    if (!isLoadedRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(board)) } catch { /* quota */ }
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
    a.download     = `${safeName}.brainboard.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported "${board.name}"`)
  }, [board])

  // Import
  const importBoard = useCallback(() => {
    const input    = document.createElement('input')
    input.type     = 'file'
    input.accept   = '.json,.brainboard.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string) as Board
          if (parsed.schemaVersion !== 1) {
            toast.error(`Unknown schema version: ${(parsed as any).schemaVersion}`)
            return
          }
          if (!Array.isArray(parsed.cards)) {
            toast.error('Invalid board file.')
            return
          }
          loadBoard(parsed)
          toast.success(`Loaded "${parsed.name}"`)
        } catch {
          toast.error('Could not parse board file.')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }, [loadBoard])

  return { exportBoard, importBoard }
}
