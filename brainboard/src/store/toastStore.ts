import { create } from 'zustand'
import { nanoid } from 'nanoid'

export type ToastKind = 'success' | 'info' | 'warning' | 'error'

export interface Toast {
  id:      string
  message: string
  kind:    ToastKind
}

interface ToastStore {
  toasts: Toast[]
  push:   (message: string, kind?: ToastKind) => void
  remove: (id: string) => void
}

const AUTO_DISMISS_MS = 3000

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  push: (message, kind = 'success') => {
    const id = nanoid()
    set(s => ({ toasts: [...s.toasts, { id, message, kind }] }))
    setTimeout(() => {
      set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
    }, AUTO_DISMISS_MS)
  },

  remove: (id) =>
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))

// Convenience helper — call from anywhere without a hook
export const toast = {
  success: (msg: string) => useToastStore.getState().push(msg, 'success'),
  info:    (msg: string) => useToastStore.getState().push(msg, 'info'),
  warning: (msg: string) => useToastStore.getState().push(msg, 'warning'),
  error:   (msg: string) => useToastStore.getState().push(msg, 'error'),
}
