// Font imports — Vite resolves these from node_modules and bundles the
// WOFF2 files. Both are variable fonts, so a single file covers all weights.
import '@fontsource-variable/inter'
import '@fontsource-variable/fraunces'

// Global styles must load before any component.
// Tokens are imported inside globals.css — don't import tokens.css separately.
import '@/styles/globals.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
