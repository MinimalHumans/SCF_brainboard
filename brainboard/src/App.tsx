import React, { useState } from 'react'
import { Toolbar }        from '@/components/Toolbar/Toolbar'
import { Canvas }         from '@/components/Canvas/Canvas'
import { StatusBar }      from '@/components/StatusBar/StatusBar'
import { ToastStack }     from '@/components/Toast/Toast'
import { TemplatesModal } from '@/components/Templates/TemplatesModal'
import { HelpModal }      from '@/components/Help/HelpModal'
import { OutlineModal }   from '@/components/Outline/OutlineModal'
import { BoardsModal }    from '@/components/Boards/BoardsModal'
import { SyncConflictModal } from '@/components/Sync/SyncConflictModal'
import { SyncDeletionModal } from '@/components/Sync/SyncDeletionModal'
import { useSelectionStore } from '@/store/selectionStore'
import { useBoardStore }  from '@/store/boardStore'
import { useBoardLibrary } from '@/hooks/useBoardLibrary'
import { useDriveSync }   from '@/hooks/useDriveSync'
import { toast }          from '@/store/toastStore'

export default function App() {
  const publishAllFn   = useBoardStore(s => s.publishAll)
  const publishCardsFn = useBoardStore(s => s.publishCards)
  const selectedIds    = useSelectionStore(s => s.selectedIds)

  const library = useBoardLibrary()
  const drive   = useDriveSync(library.isLoaded)

  const [showTemplates, setShowTemplates] = useState(false)
  const [showHelp,      setShowHelp]      = useState(false)
  const [showOutline,   setShowOutline]   = useState(false)
  const [showBoards,    setShowBoards]    = useState(false)

  const handlePublishAll = () => {
    publishAllFn()
    toast.info('All cards are already published.')
  }

  const handlePublishSelected = () => {
    publishCardsFn([...selectedIds])
    toast.info('All cards are already published.')
  }

  return (
    <>
      <Toolbar
        hasSelection={selectedIds.size > 0}
        onPublishAll={handlePublishAll}
        onPublishSelected={selectedIds.size > 0 ? handlePublishSelected : undefined}
        onExport={library.exportBoard}
        onImport={library.importBoard}
        onTemplates={() => setShowTemplates(true)}
        onOutline={() => setShowOutline(true)}
        onHelp={() => setShowHelp(true)}
        onOpenBoards={() => setShowBoards(true)}
      />
      <Canvas />
      <StatusBar />
      <ToastStack />
      {showTemplates && <TemplatesModal onClose={() => setShowTemplates(false)} onAdoptBoard={library.adoptBoard} />}
      {showHelp      && <HelpModal      onClose={() => setShowHelp(false)} />}
      {showOutline   && <OutlineModal   onClose={() => setShowOutline(false)} />}
      {showBoards    && <BoardsModal    onClose={() => setShowBoards(false)} library={library} drive={drive} />}
      {drive.conflict         && <SyncConflictModal conflict={drive.conflict} conflictCount={drive.conflictCount} onResolve={drive.resolveConflict} />}
      {drive.deletionConflict && <SyncDeletionModal deletion={drive.deletionConflict} onResolve={drive.resolveDeletion} />}
    </>
  )
}
