import { useEffect, useRef, useCallback, useState } from 'react'
import { useBoardStore } from '@/store/boardStore'
import { toast } from '@/store/toastStore'
import type { Board } from '@/types/board'
import { isOpfsSupported, readBoardFile, writeBoardFile, writeBoardFileVerified } from '@/lib/opfs/opfsStorage'

const STORAGE_KEY    = 'brainboard_v1'
const MIGRATED_KEY   = 'brainboard_migrated_v1'
const AUTOSAVE_DELAY = 500

function parseBoard(raw: string): Board | null {
  try {
    const parsed = JSON.parse(raw) as Board
    if (parsed.schemaVersion === 1 && Array.isArray(parsed.cards)) return parsed
    return null
  } catch {
    return null
  }
}

export function usePersistence() {
  const board     = useBoardStore(s => s.board)
  const loadBoard = useBoardStore(s => s.loadBoard)
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLoadedRef = useRef(false)
  // Mirrors isLoadedRef as state so callers outside this hook (Drive sync)
  // can tell when the real board — not the store's blank initial value —
  // has actually landed, instead of racing it.
  const [isLoaded, setIsLoaded] = useState(false)
  // Which backend autosave should target. Starts pointed at localStorage so
  // an autosave firing before load-on-mount resolves can't be lost; the load
  // effect flips it once it knows whether OPFS is actually usable.
  const backendRef = useRef<'opfs' | 'localStorage'>('localStorage')

  // Load on mount
  useEffect(() => {
    (async () => {
      if (!isOpfsSupported()) {
        // No OPFS in this browser — stay on the localStorage path permanently.
        const raw = localStorage.getItem(STORAGE_KEY)
        const parsed = raw ? parseBoard(raw) : null
        if (parsed) loadBoard(parsed)
        backendRef.current = 'localStorage'
        isLoadedRef.current = true
        setIsLoaded(true)
        return
      }

      try {
        const opfsRaw = await readBoardFile()
        const opfsBoard = opfsRaw ? parseBoard(opfsRaw) : null
        if (opfsBoard) {
          // Steady state: OPFS already has a valid board.
          loadBoard(opfsBoard)
          backendRef.current = 'opfs'
          isLoadedRef.current = true
          setIsLoaded(true)
          return
        }

        // No valid OPFS board yet. Check for a pre-OPFS localStorage board to migrate.
        const legacyRaw = localStorage.getItem(STORAGE_KEY)
        const legacyBoard = legacyRaw ? parseBoard(legacyRaw) : null
        if (legacyBoard) {
          try {
            await writeBoardFileVerified(legacyRaw!)
            localStorage.setItem(MIGRATED_KEY, 'true')
            // Deliberately NOT removing STORAGE_KEY — the original stays in
            // place indefinitely as a passive backup.
            loadBoard(legacyBoard)
            backendRef.current = 'opfs'
          } catch (err) {
            console.error('OPFS migration failed, staying on localStorage', err)
            toast.error("Couldn't move your board to the new storage — still using the old one.")
            loadBoard(legacyBoard)
            backendRef.current = 'localStorage'
          }
        } else {
          // Fresh install — nothing to load, start blank. Future saves go to OPFS.
          backendRef.current = 'opfs'
        }
      } catch (err) {
        // OPFS is supported per feature-detection but blew up anyway (e.g. a
        // quota/permissions issue). Fall back to localStorage rather than
        // risk data loss.
        console.error('OPFS read failed, falling back to localStorage', err)
        const raw = localStorage.getItem(STORAGE_KEY)
        const parsed = raw ? parseBoard(raw) : null
        if (parsed) loadBoard(parsed)
        backendRef.current = 'localStorage'
      } finally {
        isLoadedRef.current = true
        setIsLoaded(true)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autosave
  useEffect(() => {
    if (!isLoadedRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const json = JSON.stringify(board)
      try {
        if (backendRef.current === 'opfs') {
          await writeBoardFile(json)
        } else {
          localStorage.setItem(STORAGE_KEY, json)
        }
      } catch (err) {
        console.error('Autosave failed', err)
        toast.error("Couldn't save your board locally.")
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

  return { exportBoard, importBoard, isLoaded }
}
