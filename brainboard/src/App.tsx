import React, { useState } from 'react'
import { Toolbar }          from '@/components/Toolbar/Toolbar'
import { Canvas }           from '@/components/Canvas/Canvas'
import { StatusBar }        from '@/components/StatusBar/StatusBar'
import { ToastStack }       from '@/components/Toast/Toast'
import { TemplatesModal }   from '@/components/Templates/TemplatesModal'
import { HelpModal }        from '@/components/Help/HelpModal'
import { useBoardStore }    from '@/store/boardStore'
import { useSelectionStore } from '@/store/selectionStore'
import { usePersistence }   from '@/hooks/usePersistence'
import { toast }            from '@/store/toastStore'
import { nanoid }           from 'nanoid'

export default function App() {
  const loadBoard      = useBoardStore(s => s.loadBoard)
  const boardId        = useBoardStore(s => s.board.boardId)
  const publishAllFn   = useBoardStore(s => s.publishAll)
  const publishCardsFn = useBoardStore(s => s.publishCards)
  const cards          = useBoardStore(s => s.board.cards)
  const selectedIds    = useSelectionStore(s => s.selectedIds)

  const { exportBoard, importBoard } = usePersistence()

  const handleNewBoard = () => {
    const confirmed = window.confirm(
      'Create a new blank board?\n\nYour current board will be lost. Make sure you have exported it first if you want to keep it.'
    )
    if (!confirmed) return
    loadBoard({
      schemaVersion: 1,
      boardId:       nanoid(),
      name:          'Untitled Board',
      createdAt:     new Date().toISOString(),
      updatedAt:     new Date().toISOString(),
      viewport:      { x: 4000, y: 4000, zoom: 1 },
      cards:         [],
      entities:      [],
      backdrops:     [],
    })
    toast.success('New board created.')
  }

  const [showTemplates, setShowTemplates] = useState(false)
  const [showHelp,      setShowHelp]      = useState(false)

  const handlePublishAll = () => {
    const drafts = cards.filter(c => c.entityId === null).length
    publishAllFn()
    toast[drafts === 0 ? 'info' : 'success'](
      drafts === 0
        ? 'No draft cards to publish.'
        : `Published ${drafts} card${drafts !== 1 ? 's' : ''}.`
    )
  }

  const handlePublishSelected = () => {
    const ids    = [...selectedIds]
    const drafts = cards.filter(c => ids.includes(c.id) && c.entityId === null).length
    publishCardsFn(ids)
    toast[drafts === 0 ? 'info' : 'success'](
      drafts === 0
        ? 'Selected cards already published.'
        : `Published ${drafts} card${drafts !== 1 ? 's' : ''}.`
    )
  }

  return (
    <>
      <Toolbar
        hasSelection={selectedIds.size > 0}
        onPublishAll={handlePublishAll}
        onPublishSelected={selectedIds.size > 0 ? handlePublishSelected : undefined}
        onExport={exportBoard}
        onImport={importBoard}
        onNewBoard={handleNewBoard}
        onTemplates={() => setShowTemplates(true)}
        onHelp={() => setShowHelp(true)}
      />
      <Canvas />
      <StatusBar />
      <ToastStack />

      {showTemplates && <TemplatesModal onClose={() => setShowTemplates(false)} />}
      {showHelp      && <HelpModal      onClose={() => setShowHelp(false)} />}
    </>
  )
}
