import React, { useState } from 'react'
import { Toolbar }        from '@/components/Toolbar/Toolbar'
import { Canvas }         from '@/components/Canvas/Canvas'
import { StatusBar }      from '@/components/StatusBar/StatusBar'
import { ToastStack }     from '@/components/Toast/Toast'
import { HelpModal }      from '@/components/Help/HelpModal'
import { OutlineModal }   from '@/components/Outline/OutlineModal'
import { BoardsModal }    from '@/components/Boards/BoardsModal'
import { UnsavedBoardModal } from '@/components/Boards/UnsavedBoardModal'
import { SyncConflictModal } from '@/components/Sync/SyncConflictModal'
import { SyncDeletionModal } from '@/components/Sync/SyncDeletionModal'
import { useSelectionStore } from '@/store/selectionStore'
import { useBoardStore }  from '@/store/boardStore'
import { useLibraryStore } from '@/store/libraryStore'
import { useBoardLibrary } from '@/hooks/useBoardLibrary'
import { useDriveSync }   from '@/hooks/useDriveSync'
import { useTrashMaintenance } from '@/hooks/useTrashMaintenance'
import { toast }          from '@/store/toastStore'

export default function App() {
  const publishAllFn   = useBoardStore(s => s.publishAll)
  const publishCardsFn = useBoardStore(s => s.publishCards)
  const selectedIds    = useSelectionStore(s => s.selectedIds)
  const unsavedGuard   = useLibraryStore(s => s.unsavedGuard)

  const library = useBoardLibrary()
  const drive   = useDriveSync(library.isLoaded)
  // Hydrates trash bookkeeping and runs the retention sweep (permanently
  // deletes boards whose time in the trash has expired).
  useTrashMaintenance(library.isLoaded, library, drive)

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
        onOutline={() => setShowOutline(true)}
        onHelp={() => setShowHelp(true)}
        onOpenBoards={() => setShowBoards(true)}
      />
      <Canvas />
      <StatusBar />
      <ToastStack />
      {showHelp      && <HelpModal      onClose={() => setShowHelp(false)} />}
      {showOutline   && <OutlineModal   onClose={() => setShowOutline(false)} />}
      {showBoards    && <BoardsModal    onClose={() => setShowBoards(false)} library={library} drive={drive} />}
      {drive.conflict         && <SyncConflictModal conflict={drive.conflict} conflictCount={drive.conflictCount} onResolve={drive.resolveConflict} />}
      {drive.deletionConflict && <SyncDeletionModal deletion={drive.deletionConflict} onResolve={drive.resolveDeletion} />}
      {unsavedGuard && (
        <UnsavedBoardModal
          boardName={unsavedGuard.boardName}
          cardCount={unsavedGuard.cardCount}
          backdropCount={unsavedGuard.backdropCount}
          onSave={unsavedGuard.onSave}
          onDiscard={unsavedGuard.onDiscard}
          onCancel={unsavedGuard.onCancel}
        />
      )}
    </>
  )
}
