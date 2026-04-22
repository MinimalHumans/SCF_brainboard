import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './HelpModal.module.css'

interface HelpModalProps {
  onClose: () => void
}

type Section = 'canvas' | 'cards' | 'backdrops' | 'toolbar' | 'shortcuts'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'canvas',    label: 'Canvas'     },
  { id: 'cards',     label: 'Cards'      },
  { id: 'backdrops', label: 'Backdrops'  },
  { id: 'toolbar',   label: 'Toolbar'    },
  { id: 'shortcuts', label: 'Shortcuts'  },
]

export function HelpModal({ onClose }: HelpModalProps) {
  const [activeSection, setActiveSection] = useState<Section>('canvas')

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-label="Help">
        <div className={styles.sidebar}>
          <div className={styles.sidebarTitle}>Help</div>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              className={`${styles.navBtn} ${activeSection === s.id ? styles.navActive : ''}`}
              onClick={() => setActiveSection(s.id)}
            >
              {s.label}
            </button>
          ))}
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close help">
            Close
          </button>
        </div>

        <div className={styles.content}>
          {activeSection === 'canvas'    && <CanvasHelp />}
          {activeSection === 'cards'     && <CardsHelp />}
          {activeSection === 'backdrops' && <BackdropsHelp />}
          {activeSection === 'toolbar'   && <ToolbarHelp />}
          {activeSection === 'shortcuts' && <ShortcutsHelp />}
        </div>
      </div>
    </div>,
    document.body
  )
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className={styles.h2}>{children}</h2>
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className={styles.h3}>{children}</h3>
}
function P({ children }: { children: React.ReactNode }) {
  return <p className={styles.p}>{children}</p>
}
function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>
}

function CanvasHelp() {
  return (
    <div>
      <H2>Canvas</H2>
      <P>The canvas is an infinite zoomable workspace. Cards and backdrops exist in world space — their positions don't change when you pan or zoom.</P>

      <H3>Navigation</H3>
      <P><strong>Pan</strong> — hold <Kbd>Space</Kbd> and drag, or drag with the middle mouse button.</P>
      <P><strong>Zoom</strong> — scroll the mouse wheel. Zooms toward the cursor position. Use the <Kbd>−</Kbd> / <Kbd>%</Kbd> / <Kbd>+</Kbd> controls in the toolbar to step through zoom levels or reset to 100%.</P>
      <P><strong>Frame all</strong> — press <Kbd>F</Kbd> to fit all cards in view.</P>

      <H3>Creating cards</H3>
      <P><strong>Double-click</strong> any empty area of the canvas to create a new card at that position.</P>
      <P><strong>Right-click</strong> the canvas to open the canvas context menu, which lets you create a card at that exact position or draw a new backdrop.</P>

      <H3>Selection</H3>
      <P><strong>Click</strong> a card to select it. <strong>Shift-click</strong> to add or remove from the selection.</P>
      <P><strong>Drag</strong> over empty canvas space to rubber-band select multiple cards. Release to confirm the selection.</P>
      <P><Kbd>Ctrl</Kbd> <Kbd>A</Kbd> selects all cards. <Kbd>Esc</Kbd> clears the selection.</P>

      <H3>Persistence</H3>
      <P>Your board autosaves to the browser's local storage 500ms after any change. Refreshing the page restores your work. Use Export to save a portable file.</P>
    </div>
  )
}

function CardsHelp() {
  return (
    <div>
      <H2>Cards</H2>
      <P>Cards are story entity placements — each card represents one instance of a Character, Location, Scene, Prop, Beat, Theme, Arc, or Thought on the board.</P>

      <H3>Two states</H3>
      <P><strong>Front (view mode)</strong> — compact display showing the card's title, filled attribute values, note preview, and placement note. This is the default state. The whole card is draggable.</P>
      <P><strong>Edit mode</strong> — click the pencil icon in the card's handle bar to open full editing. The card widens. Drag from the handle bar only.</P>

      <H3>The handle bar</H3>
      <P>Every card has a coloured bar at the top showing the entity type and the edit/view toggle button. This bar is always draggable in both states.</P>

      <H3>Card content</H3>
      <P><strong>Type</strong> — select from Arc, Beat, Character, Location, Prop, Scene, Theme, Thought. Changing type changes the attribute schema and the default swatch colour.</P>
      <P><strong>Name</strong> — the card's primary title, displayed in Fraunces on the front face.</P>
      <P><strong>Attributes</strong> — type-specific fields (e.g. Role and Occupation for a Character). Filled attributes are displayed on the front face. Attribute fields are disabled until the card is published.</P>
      <P><strong>Note</strong> — a shared entity note. If the same entity appears on the board multiple times as instances, all instances share this note. Supports markdown (bold, italic, inline code).</P>
      <P><strong>Placement note</strong> — local to this card only, never shared. Use it for spatial context: "Ezra at the saloon" vs "Ezra in flashback".</P>
      <P><strong>Color</strong> — eight muted swatches, one per type by default. Override per card.</P>

      <H3>Publishing</H3>
      <P>A card starts as a <strong>Draft</strong> (shown with a dashed border). Drafts have a name and note but no stable entity ID. Publishing assigns a permanent entity ID and unlocks attributes.</P>
      <P>Publish a single card via the Publish button in edit mode. Publish all drafts at once with Publish All in the toolbar.</P>

      <H3>Instances</H3>
      <P>Right-click a published card → Create Instance to place the same entity in a different location. Instances share the entity note and attributes. Each has its own placement note and swatch color. The ◈ glyph marks cards with multiple instances.</P>

      <H3>Duplicating vs instancing</H3>
      <P><strong>Duplicate</strong> (<Kbd>Ctrl</Kbd> <Kbd>D</Kbd>) — creates a fully independent draft copy with a new entity ID. Use when you want a separate entity that starts from the same content.</P>
      <P><strong>Instance</strong> (<Kbd>Ctrl</Kbd> <Kbd>I</Kbd>) — creates a new placement of the same entity. Use when the same story element appears in multiple contexts on the board.</P>
    </div>
  )
}

function BackdropsHelp() {
  return (
    <div>
      <H2>Backdrops</H2>
      <P>Backdrops are spatial regions — resizable containers that visually group cards by act, sequence, or beat. They always sit behind all cards.</P>

      <H3>Creating a backdrop</H3>
      <P>Right-click empty canvas → choose <strong>Add Sequence backdrop</strong>, <strong>Add Act backdrop</strong>, or <strong>Add Beat backdrop</strong>. The cursor becomes a crosshair and a hint banner appears.</P>
      <P><strong>Click and drag</strong> to draw the backdrop bounds. Release to create it. Press <Kbd>Esc</Kbd> to cancel before drawing.</P>

      <H3>Types</H3>
      <P><strong>Act</strong> — highest level structural container. Has Function, Dramatic Question, and Shift attributes.</P>
      <P><strong>Sequence</strong> — a group of scenes that accomplish one narrative goal. Has Goal, Conflict, and Outcome attributes.</P>
      <P><strong>Beat</strong> — the smallest structural unit. Has a description field only.</P>

      <H3>Moving backdrops</H3>
      <P>Drag the coloured header bar at the top. Cards whose bounding boxes are fully inside the backdrop move with it. This spatial membership is computed at drag start — not stored.</P>

      <H3>Resizing</H3>
      <P>Hover over the header bar or an edge handle — eight resize handles appear at the corners and edge midpoints. Drag any handle to resize. Corner handles resize two axes; edge handles resize one.</P>

      <H3>Editing</H3>
      <P>Click the pencil icon in the header bar to open the edit panel. The title, type-specific attributes, note, and color swatch are all editable here.</P>
      <P>The <strong>title</strong> defaults to the type name. Edit it in the panel to name the act or sequence.</P>
      <P>The <strong>note</strong> appears in the lower-right corner of the backdrop — useful for brief stage direction or purpose reminders.</P>
      <P>Double-click the title text in the backdrop body (when not editing) to jump straight to editing.</P>

      <H3>Canvas interaction within backdrops</H3>
      <P>The backdrop body is pointer-events transparent — you can double-click inside a backdrop to create a card, right-click for the canvas menu, and pan/zoom normally. Only the header bar and resize handles intercept interaction.</P>
    </div>
  )
}

function ToolbarHelp() {
  return (
    <div>
      <H2>Toolbar</H2>

      <H3>Board name</H3>
      <P>Click the board name to rename it inline. Press <Kbd>Enter</Kbd> to confirm or <Kbd>Esc</Kbd> to cancel. The name is used as the filename when exporting.</P>

      <H3>Zoom controls</H3>
      <P>The <Kbd>−</Kbd> and <Kbd>+</Kbd> buttons zoom out and in by 25% increments, keeping the viewport center fixed. Click the percentage display to reset to 100%. The scroll wheel zooms toward the cursor position.</P>

      <H3>Import / Export</H3>
      <P><strong>Export</strong> — downloads the current board as a <code>.brainboard.json</code> file. The file includes all cards, entities, backdrops, and the viewport position.</P>
      <P><strong>Import</strong> — opens a file picker. Loading a board replaces the current board. Unsupported schema versions are rejected with an error toast.</P>

      <H3>Templates</H3>
      <P>Opens the template browser. Each template can be loaded as a new board (replacing current content) or merged into the existing board (content is appended and offset by 300px to avoid overlap).</P>
      <P>To create your own template: make a board, export it, and place the <code>.json</code> file in <code>src/templates/</code>. Restart the dev server and it appears in the browser.</P>

      <H3>Publish All / Publish Selected</H3>
      <P><strong>Publish All</strong> — converts every draft card to a published entity in one action.</P>
      <P><strong>Publish Selected</strong> — appears when cards are selected. Publishes only the selected drafts.</P>

      <H3>Status bar</H3>
      <P>The bar at the bottom shows: selection count (left), and board statistics on the right — Backdrops, Cards, Entities, Drafts.</P>
    </div>
  )
}

function ShortcutsHelp() {
  const rows: [string, string][] = [
    ['Double-click canvas',  'Create card at cursor position'],
    ['Double-click card',    'Enter edit mode'],
    ['Right-click canvas',   'Canvas context menu (new card, new backdrop)'],
    ['Right-click card',     'Card context menu (edit, duplicate, instance, delete)'],
    ['Drag card',            'Move card (drag handle bar in edit mode)'],
    ['Drag canvas',          'Rubber-band select cards'],
    ['Space + Drag',         'Pan the canvas'],
    ['Middle mouse + Drag',  'Pan the canvas'],
    ['Scroll wheel',         'Zoom toward cursor'],
    ['F',                    'Frame all cards in view'],
    ['Ctrl A',               'Select all cards'],
    ['Shift + Click',        'Add or remove from selection'],
    ['Esc',                  'Clear selection / cancel creation mode / exit edit mode'],
    ['Ctrl D',               'Duplicate selected card(s)'],
    ['Ctrl I',               'Create instance of selected published card'],
    ['Delete / Backspace',   'Delete selected card(s)'],
  ]

  return (
    <div>
      <H2>Keyboard Shortcuts</H2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Action</th>
            <th className={styles.th}>Shortcut</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([shortcut, desc]) => (
            <tr key={shortcut} className={styles.tr}>
              <td className={styles.tdShortcut}>
                {shortcut.split(' + ').map((k, i, arr) => (
                  <span key={k}>
                    <Kbd>{k}</Kbd>
                    {i < arr.length - 1 && <span className={styles.plus}> + </span>}
                  </span>
                ))}
              </td>
              <td className={styles.tdDesc}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
