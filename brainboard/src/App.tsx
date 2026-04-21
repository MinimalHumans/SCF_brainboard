import React from 'react'
import { Toolbar } from '@/components/Toolbar/Toolbar'
import { Canvas }  from '@/components/Canvas/Canvas'
import { useBoardStore } from '@/store/boardStore'
import { useSelectionStore } from '@/store/selectionStore'

/*
 * App shell.
 * Phase 1+: reads board name from store for the Toolbar.
 * Phase 7+: Toolbar's Publish All and Publish Selected are wired here.
 */
export default function App() {
  /*
   * IMPORTANT: never pass an inline object literal as a Zustand selector.
   *   BAD:  useBoardStore(s => ({ a: s.a, b: s.b }))
   *         → new object reference every render → infinite re-render loop
   *   GOOD: separate useBoardStore calls per value (below), or useShallow()
   */
  const board        = useBoardStore(s => s.board)
  const publishAll   = useBoardStore(s => s.publishAll)
  const publishCards = useBoardStore(s => s.publishCards)
  const selectedIds  = useSelectionStore(s => s.selectedIds)

  return (
    <>
      <Toolbar
        boardName={board.name}
        onPublishAll={publishAll}
        onPublishSelected={
          selectedIds.size > 0
            ? () => publishCards([...selectedIds])
            : undefined
        }
        hasSelection={selectedIds.size > 0}
      />
      <Canvas />
    </>
  )
}
