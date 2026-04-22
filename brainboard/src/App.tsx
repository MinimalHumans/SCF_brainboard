import React from 'react'
import { Toolbar }    from '@/components/Toolbar/Toolbar'
import { Canvas }     from '@/components/Canvas/Canvas'
import { StatusBar }  from '@/components/StatusBar/StatusBar'
import { ToastStack } from '@/components/Toast/Toast'
import { useBoardStore } from '@/store/boardStore'
import { useSelectionStore } from '@/store/selectionStore'
import { usePersistence } from '@/hooks/usePersistence'
import { toast } from '@/store/toastStore'

export default function App() {
  const publishAllFn   = useBoardStore(s => s.publishAll)
  const publishCardsFn = useBoardStore(s => s.publishCards)
  const cards          = useBoardStore(s => s.board.cards)
  const selectedIds    = useSelectionStore(s => s.selectedIds)

  const { exportBoard, importBoard } = usePersistence()

  const handlePublishAll = () => {
    const drafts = cards.filter(c => c.entityId === null).length
    publishAllFn()
    toast[drafts === 0 ? 'info' : 'success'](
      drafts === 0 ? 'No draft cards to publish.' : `Published ${drafts} card${drafts !== 1 ? 's' : ''}.`
    )
  }

  const handlePublishSelected = () => {
    const ids    = [...selectedIds]
    const drafts = cards.filter(c => ids.includes(c.id) && c.entityId === null).length
    publishCardsFn(ids)
    toast[drafts === 0 ? 'info' : 'success'](
      drafts === 0 ? 'Selected cards already published.' : `Published ${drafts} card${drafts !== 1 ? 's' : ''}.`
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
      />
      <Canvas />
      <StatusBar />
      <ToastStack />
    </>
  )
}
