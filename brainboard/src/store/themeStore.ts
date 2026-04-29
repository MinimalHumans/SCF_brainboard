import { create } from 'zustand'

type Theme = 'dark' | 'light'

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

// Apply on module load — prevents FOUC on reload
const _stored = (typeof localStorage !== 'undefined'
  ? localStorage.getItem('brainboard_theme')
  : null) as Theme | null
applyTheme(_stored ?? 'dark')

interface ThemeStore {
  theme: Theme
  toggle: () => void
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: _stored ?? 'dark',
  toggle: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    localStorage.setItem('brainboard_theme', next)
    set({ theme: next })
  },
}))
