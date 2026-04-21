#!/usr/bin/env bash
# Brainboard — Phase 0 setup script
# Run from the directory where you want the project to live.
# After this completes, copy the provided src/ files over the generated ones.

set -e

echo "→ Scaffolding Vite + React + TS project..."
npm create vite@latest brainboard -- --template react-ts

cd brainboard

echo "→ Installing runtime dependencies..."
npm install \
  react-infinite-viewer \
  react-moveable \
  react-selecto \
  zustand \
  nanoid \
  marked \
  @fontsource-variable/inter \
  @fontsource-variable/fraunces

echo "→ Installing dev dependencies..."
npm install -D @types/node

echo "→ Removing Vite boilerplate..."
rm -f src/App.css src/index.css
# public/vite.svg and src/assets/react.svg can stay for now — overwritten in Phase 3

echo ""
echo "✓ Done. Now copy the provided files into brainboard/:"
echo "  - vite.config.ts       (replaces generated)"
echo "  - index.html           (replaces generated)"
echo "  - src/main.tsx         (replaces generated)"
echo "  - src/App.tsx          (replaces generated)"
echo "  - src/styles/          (new)"
echo "  - src/components/      (new)"
echo ""
echo "Then run: npm run dev"
