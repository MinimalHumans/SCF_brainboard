import React, { useState } from 'react'
import { Toolbar }        from '@/components/Toolbar/Toolbar'
import { Canvas }         from '@/components/Canvas/Canvas'
import { StatusBar }      from '@/components/StatusBar/StatusBar'
import { ToastStack }     from '@/components/Toast/Toast'
import { TemplatesModal } from '@/components/Templates/TemplatesModal'
import { HelpModal }      from '@/components/Help/HelpModal'
import { OutlineModal }   from '@/components/Outline/OutlineModal'
import { SyncConflictModal } from '@/components/Sync/SyncConflictModal'
import { SyncDeletionModal } from '@/components/Sync/SyncDeletionModal'
import { useBoardStore }  from '@/store/boardStore'
import { useSelectionStore } from '@/store/selectionStore'
import { usePersistence } from '@/hooks/usePersistence'
import { useDriveSync }   from '@/hooks/useDriveSync'
import { toast }          from '@/store/toastStore'
import { nanoid }         from 'nanoid'

export default function App() {
  const loadBoard      = useBoardStore(s => s.loadBoard)
  const publishAllFn   = useBoardStore(s => s.publishAll)
  const publishCardsFn = useBoardStore(s => s.publishCards)
  const selectedIds    = useSelectionStore(s => s.selectedIds)

  const { exportBoard, importBoard, isLoaded } = usePersistence()
  const {
    providerState: driveState,
    conflict:      driveConflict,
    deletionConflict: driveDeletionConflict,
    link:    driveLink,
    unlink:  driveUnlink,
    resolveConflict: resolveDriveConflict,
    resolveDeletion: resolveDriveDeletion,
    checkNow: driveCheckNow,
  } = useDriveSync(isLoaded)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showHelp,      setShowHelp]      = useState(false)
  const [showOutline,   setShowOutline]   = useState(false)

  const handlePublishAll = () => {
    publishAllFn()
    toast.info('All cards are already published.')
  }

  const handlePublishSelected = () => {
    publishCardsFn([...selectedIds])
    toast.info('All cards are already published.')
  }

  const handleNewBoard = () => {
    const ok = window.confirm('Create a new blank board?\n\nYour current board will be lost. Export first to keep it.')
    if (!ok) return
    loadBoard({
      schemaVersion: 1, boardId: nanoid(), name: 'Untitled Board',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      viewport: { x: 4000, y: 4000, zoom: 1 },
      cards: [], entities: [], backdrops: [],
    })
    toast.success('New board created.')
  }

  return (
    <>
      <Toolbar
        hasSelection={selectedIds.size > 0}
        onPublishAll={handlePublishAll}
        onPublishSelected={selectedIds.size > 0 ? handlePublishSelected : undefined}
        onExport={exportBoard}
        onImport={importBoard}
        onTemplates={() => setShowTemplates(true)}
        onOutline={() => setShowOutline(true)}
        onHelp={() => setShowHelp(true)}
        onNewBoard={handleNewBoard}
        driveState={driveState}
        onDriveLink={driveLink}
        onDriveUnlink={driveUnlink}
        onDriveCheckNow={driveCheckNow}
      />
      <Canvas />
      <StatusBar driveState={driveState} />
      <ToastStack />
      {showTemplates && <TemplatesModal onClose={() => setShowTemplates(false)} />}
      {showHelp      && <HelpModal      onClose={() => setShowHelp(false)} />}
      {showOutline   && <OutlineModal   onClose={() => setShowOutline(false)} />}
      {driveConflict         && <SyncConflictModal conflict={driveConflict} onResolve={resolveDriveConflict} />}
      {driveDeletionConflict && <SyncDeletionModal deletion={driveDeletionConflict} onResolve={resolveDriveDeletion} />}
    </>
  )
}
