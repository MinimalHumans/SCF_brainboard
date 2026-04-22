import type { Board } from '@/types/board'

/*
 * useTemplates
 * ------------
 * Reads all *.json files from src/templates/ at build time via Vite's
 * import.meta.glob. To add a new template:
 *
 *   1. Create a board in Brainboard
 *   2. Export it (toolbar → Export)
 *   3. Copy the .brainboard.json file into src/templates/
 *   4. Rename it to something descriptive (e.g. three-act-structure.json)
 *   5. Restart the dev server (npm run dev)
 *
 * The template name shown in the UI is derived from the filename:
 *   "three-act-structure.json" → "Three Act Structure"
 */

// Vite resolves this glob at build time. Each module has a default export
// which is the parsed JSON content of the file.
const templateModules = import.meta.glob<{ default: Board }>(
  '../templates/*.json',
  { eager: true }
)

export interface TemplateEntry {
  id:         string    // filename without extension
  name:       string    // human-readable title
  board:      Board
  cardCount:  number
  backdropCount: number
}

function filenameToTitle(path: string): string {
  // '../templates/three-act-structure.json' → 'Three Act Structure'
  const filename = path.split('/').pop() ?? path
  const base     = filename.replace(/\.(brainboard\.)?json$/, '')
  return base
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export function useTemplates(): TemplateEntry[] {
  return Object.entries(templateModules).map(([path, mod]) => {
    const board = mod.default
    return {
      id:           filenameToTitle(path).toLowerCase().replace(/\s/g, '-'),
      name:         filenameToTitle(path),
      board,
      cardCount:    board.cards?.length ?? 0,
      backdropCount: board.backdrops?.length ?? 0,
    }
  })
}
