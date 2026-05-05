# Brainboard

**A spatial story-planning tool for screenwriters.**

Brainboard lets you arrange cards and backdrops on an infinite canvas to map your characters, locations, scenes, and story structure — then export directly to Markdown, Fountain, or Final Draft to start writing.

Built by [Minimal Humans](http://minimal-humans.com/).  
Questions, feedback, and feature requests → [Discord](https://discord.gg/T42Y2tPXsJ)

---

## Features

### Cards
Place story entities on the canvas. Nine types, each with a tailored attribute schema:

| Type | Key attributes |
|---|---|
| **Character** | Pronouns, Role, Occupation, Age, Summary |
| **Location** | Type (INT/EXT), Time Period, Mood, Description |
| **Scene** | INT/EXT, Time of Day, Goal, Conflict, Outcome |
| **Prop** | Story Function, Description |
| **Beat** | Note |
| **Theme** | Statement, Expression, Opposition |
| **Arc** | Subject, Axis, Direction |
| **Shot** | Subject, Framing, Purpose |
| **Thought** | Note |

All types share a **Status** field (Active / Draft / Cut). Draft cards show a badge; Cut cards are faded and struck through.

**Instances** — place the same entity in multiple locations on the board. Instances share a note and attributes; each has its own placement note and color.

### Backdrops
Resizable spatial regions that group cards by story structure:

- **Act** — Function, Dramatic Question, Shift
- **Sequence** — Goal, Conflict, Outcome
- **Scene** — INT/EXT, Time of Day, Goal, Conflict, Outcome
- **Beat** — Description
- **Custom** — freeform grouping; transparent to exports

Draw backdrops by right-clicking the canvas, or use the Tab menu. Moving a backdrop moves all fully-contained cards with it.

### Canvas
- Infinite zoomable workspace
- Pan with `Space + Drag` or middle mouse
- Zoom with scroll wheel or toolbar controls
- Rubber-band multi-select
- `Tab` key opens a spotlight-style creation menu — type to filter, Enter to create
- `F` frames everything in view
- Undo/redo (50 steps)
- Autosaves to `localStorage` every 500ms

### Exports
- **Board Data (`.brainboard.json`)** — full reimportable format
- **Outline (`.md`)** — Markdown outline derived from the spatial structure of your board; live-updating while the modal is open
- **Fountain (`.fountain`)** — screenplay skeleton for Highland, Slugline, Final Draft, or any Fountain-aware tool; structural data emitted as boneyard blocks and action lines
- **Final Draft (`.fdx`)** — screenplay skeleton for Final Draft 10+; scene headings carry title/synopsis metadata for the navigator panel

### Templates
Save any board as a reusable template, or load one of the built-in templates. Templates can be loaded as a new board or merged into the current one.

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- npm (bundled with Node)

### Install and run

```bash
git clone https://github.com/MinimalHumans/SCF_brainboard.git
cd SCF_brainboard
npm install
npm run dev
```

The app opens at `http://localhost:5173`.

### Build for production

```bash
npm run build
```

Output goes to `dist/`. Serve it with any static file host.

---

## Dependencies

### Runtime

| Package | Purpose |
|---|---|
| [react](https://react.dev/) + [react-dom](https://react.dev/) | UI framework |
| [typescript](https://www.typescriptlang.org/) | Type safety |
| [zustand](https://github.com/pmndrs/zustand) | State management (board, selection, history, theme) |
| [react-infinite-viewer](https://github.com/daybrush/infinite-viewer) | Infinite zoomable canvas |
| [react-selecto](https://github.com/daybrush/selecto) | Rubber-band multi-select |
| [nanoid](https://github.com/ai/nanoid) | Unique ID generation |
| [marked](https://marked.js.org/) | Markdown rendering in card notes and the Outline modal |
| [@fontsource-variable/inter](https://fontsource.org/fonts/inter) | UI typeface (variable) |
| [@fontsource-variable/fraunces](https://fontsource.org/fonts/fraunces) | Display typeface for card titles (variable) |

### Dev / build

| Package | Purpose |
|---|---|
| [vite](https://vitejs.dev/) | Build tool and dev server |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | React fast refresh |
| [eslint](https://eslint.org/) | Linting |

---

## Project structure

```
src/
├── components/
│   ├── Backdrop/       # Backdrop component and CSS module
│   ├── Canvas/         # Infinite canvas, pan/zoom, draw-to-create
│   ├── Card/           # Card component and CSS module
│   ├── ContextMenu/    # Right-click menu
│   ├── Help/           # Help modal
│   ├── Outline/        # Outline modal
│   ├── StatusBar/      # Bottom status bar
│   ├── TabMenu/        # Spotlight-style creation menu (Tab key)
│   ├── Templates/      # Templates modal
│   ├── Toast/          # Toast notifications
│   └── Toolbar/        # Toolbar, popovers (About, Export, ProjectInfo)
├── config/
│   ├── attributeSchemas.ts   # Field definitions for each entity type
│   └── backdropSchemas.ts    # Field definitions for each backdrop type
├── hooks/
│   ├── useCardDrag.ts        # Pointer-based card drag logic
│   ├── usePersistence.ts     # localStorage autosave, import, export
│   └── useTemplates.ts       # Vite glob import for src/templates/*.json
├── store/
│   ├── boardStore.ts         # Main board state — cards, entities, backdrops
│   ├── editorSignalStore.ts  # Signal bus for closing open editors
│   ├── historyStore.ts       # Undo/redo via board snapshots
│   ├── selectionStore.ts     # Selected card IDs
│   ├── themeStore.ts         # Dark/light theme
│   ├── toastStore.ts         # Toast notifications
│   └── viewerStore.ts        # Zoom command bus (Toolbar → Canvas)
├── styles/
│   ├── globals.css           # Reset, typography utilities, canvas grid
│   └── tokens.css            # Design tokens — colors, spacing, type scale
├── templates/                # JSON board files loaded as built-in templates
├── types/
│   └── board.ts              # All core types: Card, Entity, Backdrop, Board, etc.
└── utils/
    ├── buildFDX.ts           # Final Draft XML emitter
    ├── buildFountain.ts      # Fountain screenplay emitter
    ├── buildOutline.ts       # Markdown outline emitter
    └── screenplayCommon.ts   # Shared geometry helpers for all screenplay exports
```

---

## Adding templates

1. Create a board in Brainboard.
2. Export it — toolbar → Export → Board Data.
3. Copy the `.brainboard.json` file into `src/templates/`.
4. Rename it to something descriptive, e.g. `three-act-structure.json`.
5. Restart the dev server (`npm run dev`).

The template appears in the Templates modal under the Default tab. The display name is derived from the filename (`three-act-structure` → "Three Act Structure").

---

## Data format

Boards are stored as JSON with `"schemaVersion": 1`. The format is stable and designed to be human-readable:

```jsonc
{
  "schemaVersion": 1,
  "boardId": "abc123",
  "name": "My Screenplay",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "viewport": { "x": 4000, "y": 4000, "zoom": 1 },
  "projectInfo": {
    "credit": "Written by",
    "author": "Jane Doe",
    "draftDate": "May 2026"
  },
  "cards": [ /* { id, entityId, type, position, color, zIndex, ... } */ ],
  "entities": [ /* { id, type, title, noteRaw, attributes } */ ],
  "backdrops": [ /* { id, type, title, position, size, attributes, ... } */ ]
}
```

Cards reference entities by `entityId`. Multiple cards can reference the same entity (instances). Entities hold the canonical title, note, and attributes. Cards hold position, color, and a local placement note.

---

## License

MIT
