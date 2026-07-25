import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  define: {
    // Deploys are triggered by version tags; GITHUB_REF_NAME is the tag name
    // in CI, so telemetry can compare metrics across releases.
    __APP_VERSION__: JSON.stringify(process.env.GITHUB_REF_NAME ?? 'dev'),
  },
  resolve: {
    alias: {
      // Allows imports like: import { Toolbar } from '@/components/Toolbar/Toolbar'
      // This alias must survive the port to the SCF React branch unchanged.
      '@': path.resolve(__dirname, './src'),
    },
  },
})
