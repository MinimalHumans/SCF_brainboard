import { create } from 'zustand'

/*
 * devModeStore — persistent "developer mode" flag, unlocked via the About
 * popover easter egg (see AboutPopover.tsx). Gates pre-release features
 * (currently: the Google Drive connect option) that aren't ready for a
 * general audience but still need to be reachable for internal testing.
 */

const DEV_MODE_KEY = 'brainboard_devmode'

function readStored(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(DEV_MODE_KEY) === 'true'
}

interface DevModeStore {
  enabled:    boolean
  setEnabled: (v: boolean) => void
}

export const useDevModeStore = create<DevModeStore>((set) => ({
  enabled: readStored(),
  setEnabled: (v) => {
    localStorage.setItem(DEV_MODE_KEY, v ? 'true' : 'false')
    set({ enabled: v })
  },
}))

export function isDevModeEnabled(): boolean {
  return useDevModeStore.getState().enabled
}
