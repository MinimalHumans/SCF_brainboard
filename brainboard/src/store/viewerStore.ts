import { create } from 'zustand'

/*
 * viewerStore — command bus for imperative viewer operations.
 *
 * Problem: The Toolbar's zoom buttons need to call viewer.setTo() inside
 * Canvas, but the viewer ref lives in Canvas and we don't want to lift it
 * all the way to App.
 *
 * Solution: A tiny "pending command" store. Toolbar writes a command;
 * Canvas reads it in a useEffect and executes it against the viewer ref,
 * then clears it.
 *
 * This is a one-way bus, not a state sync. The command is consumed once
 * and cleared. The actual zoom state continues to flow through
 * boardStore.viewport via syncViewport as before.
 */

export type ZoomCommand =
  | { type: 'in' }
  | { type: 'out' }
  | { type: 'reset' }

interface ViewerStore {
  zoomCommand: ZoomCommand | null
  requestZoom: (cmd: ZoomCommand) => void
  clearZoomCommand: () => void
}

export const useViewerStore = create<ViewerStore>((set) => ({
  zoomCommand: null,
  requestZoom:      (cmd) => set({ zoomCommand: cmd }),
  clearZoomCommand: ()    => set({ zoomCommand: null }),
}))
