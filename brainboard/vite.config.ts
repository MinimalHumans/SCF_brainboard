import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Allows imports like: import { Toolbar } from '@/components/Toolbar/Toolbar'
      // This alias must survive the port to the SCF React branch unchanged.
      '@': path.resolve(__dirname, './src'),
    },
  },
})
