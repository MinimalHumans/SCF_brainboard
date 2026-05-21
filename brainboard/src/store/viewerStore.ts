import { create } from 'zustand'

/*
 * viewerStore — command bus for imperative viewer operations.
 *
 * Problem: The Toolbar's zoom/frame buttons need to call viewer methods
 * inside Canvas, but the viewer ref lives in Canvas and we don't want to
 * lift it all the way to App.
 *
 * Two coexisting patterns:
 *  - zoomCommand: nullable command, cleared after execution by Canvas.
 *    Used because zoom carries a parameter (in/out/reset) and we want
 *    one-shot semantics.
 *  - frameCommand: incrementing counter (same shape as editorSignalStore.
 *    closeSignal). Canvas reacts to changes via useEffect; no clear step.
 *    Used because Frame All has no parameter and we want idempotent
 *    re-triggering — tap twice → frame twice.
 *
 * The actual zoom state continues to flow through boardStore.viewport via
 * syncViewport. This store is strictly for one-way command dispatch from
 * UI affordances that don't own the viewer ref.
 */

export type ZoomCommand =
  | { type: 'in' }
  | { type: 'out' }
  | { type: 'reset' }

interface ViewerStore {
  zoomCommand:      ZoomCommand | null
  requestZoom:      (cmd: ZoomCommand) => void
  clearZoomCommand: () => void
  frameCommand:     number
  requestFrame:     () => void
}

export const useViewerStore = create<ViewerStore>((set) => ({
  zoomCommand:      null,
  requestZoom:      (cmd) => set({ zoomCommand: cmd }),
  clearZoomCommand: ()    => set({ zoomCommand: null }),
  frameCommand:     0,
  requestFrame:     ()    => set(s => ({ frameCommand: s.frameCommand + 1 })),
}))
