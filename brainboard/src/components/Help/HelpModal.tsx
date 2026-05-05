import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import styles from './HelpModal.module.css'

interface HelpModalProps {
  onClose: () => void
}

type Section = 'about' | 'canvas' | 'cards' | 'backdrops' | 'toolbar' | 'shortcuts'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'about',     label: 'About'      },
  { id: 'canvas',    label: 'Canvas'     },
  { id: 'cards',     label: 'Cards'      },
  { id: 'backdrops', label: 'Backdrops'  },
  { id: 'toolbar',   label: 'Toolbar'    },
  { id: 'shortcuts', label: 'Shortcuts'  },
]

export function HelpModal({ onClose }: HelpModalProps) {
  const [activeSection, setActiveSection] = useState<Section>('about')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

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
          {activeSection === 'about'     && <AboutHelp />}
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

// ── Shared primitives ─────────────────────────────────────────────────────────

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

// ── About ─────────────────────────────────────────────────────────────────────

function AboutHelp() {
  return (
    <div>
      <H2>About Brainboard</H2>
      <P>
        Brainboard is a spatial story-planning tool built for screenwriters and storytellers.
        Arrange cards and backdrops on an infinite canvas to map your characters, locations,
        scenes, and structure — then export to Markdown, Fountain, or Final Draft to start writing.
      </P>
      <P>
        Created by <strong>Minimal Humans</strong>.
      </P>

      <H3>Website</H3>
      <P>
        <a href="http://minimal-humans.com/" target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--color-accent)' }}>
          minimal-humans.com
        </a>
      </P>

      <H3>Feedback &amp; Feature Requests</H3>
      <P>
        Have a suggestion, found a bug, or want to talk story structure? Join the community
        on Discord — we'd love to hear from you.
      </P>
      <P>
        <a href="https://discord.gg/T42Y2tPXsJ" target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--color-accent)' }}>
          discord.gg/T42Y2tPXsJ
        </a>
      </P>
    </div>
  )
}

// ── Canvas ────────────────────────────────────────────────────────────────────

function CanvasHelp() {
  return (
    <div>
      <H2>Canvas</H2>
      <P>The canvas is an infinite zoomable workspace. Cards and backdrops exist in world space — their positions don't change when you pan or zoom.</P>

      <H3>Navigation</H3>
      <P><strong>Pan</strong> — hold <Kbd>Space</Kbd> and drag, or drag with the middle mouse button.</P>
      <P><strong>Zoom</strong> — scroll the mouse wheel. Zooms toward the cursor position. Use the <Kbd>−</Kbd> / <Kbd>%</Kbd> / <Kbd>+</Kbd> controls in the toolbar to step through zoom levels or reset to 100%.</P>
      <P><strong>Frame all</strong> — press <Kbd>F</Kbd> to fit everything in view.</P>

      <H3>Creating cards and backdrops</H3>
      <P><strong>Double-click</strong> any empty area of the canvas to create a new card at that position.</P>
      <P><strong>Tab</strong> opens a spotlight-style menu at the cursor. Type to filter, use <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move through results, and press <Kbd>Enter</Kbd> or <Kbd>Tab</Kbd> again to create the selected card or backdrop type. Press <Kbd>Esc</Kbd> to close without creating.</P>
      <P><strong>Right-click</strong> the canvas to open the context menu, which lets you create a card at that exact position or draw a new backdrop.</P>

      <H3>Selection</H3>
      <P><strong>Click</strong> a card to select it. <strong>Shift-click</strong> to add or remove from the selection.</P>
      <P><strong>Drag</strong> over empty canvas space to rubber-band select multiple cards. Release to confirm the selection.</P>
      <P><Kbd>Ctrl</Kbd> <Kbd>A</Kbd> selects all cards. <Kbd>Esc</Kbd> clears the selection.</P>

      <H3>Persistence</H3>
      <P>Your board autosaves to the browser's local storage 500ms after any change. Refreshing the page restores your work. Use Export to save a portable file.</P>
    </div>
  )
}

// ── Cards ─────────────────────────────────────────────────────────────────────

function CardsHelp() {
  return (
    <div>
      <H2>Cards</H2>
      <P>Cards are story entity placements. Each card represents one instance of an entity — a Character, Location, Scene, Prop, Beat, Theme, Arc, Shot, or Thought — placed on the board.</P>

      <H3>Entity types</H3>
      <P><strong>Character</strong> — a person in the story. Attributes: Pronouns, Role, Occupation, Age, Character Summary.</P>
      <P><strong>Location</strong> — a place. Attributes: Type (Interior/Exterior/etc.), Time Period, Mood, Setting Description.</P>
      <P><strong>Scene</strong> — a discrete scene. Attributes: INT/EXT, Time of Day, Goal, Conflict, Outcome.</P>
      <P><strong>Prop</strong> — an object with story function. Attributes: Story Function, Description.</P>
      <P><strong>Beat</strong> — a unit of action or turning point. Name and note only.</P>
      <P><strong>Theme</strong> — a thematic idea. Attributes: Statement, Expression, Opposition.</P>
      <P><strong>Arc</strong> — a character or story arc. Attributes: Subject, Axis, Direction.</P>
      <P><strong>Shot</strong> — a specific camera setup. Attributes: Subject, Framing, Purpose.</P>
      <P><strong>Thought</strong> — a freeform note with no fixed schema. Name and note only.</P>
      <P>All entity types share a <strong>Status</strong> field (see below).</P>

      <H3>Card states</H3>
      <P><strong>View mode</strong> — compact display showing the title, any filled attribute values, and the note preview. The whole card is draggable.</P>
      <P><strong>Edit mode</strong> — click the pencil icon in the handle bar to open full editing. Drag from the handle bar only in this state.</P>

      <H3>The handle bar</H3>
      <P>The coloured bar at the top of every card shows the entity type. It is always draggable. The right side of the bar shows the Status badge (if set to Draft) and the edit button.</P>

      <H3>Status</H3>
      <P>Every entity has a <strong>Status</strong> attribute with three options:</P>
      <P><strong>Active</strong> — default. No visual indicator.</P>
      <P><strong>Draft</strong> — shows a DRAFT badge in the card handle. Use this to mark elements that are planned but not yet confirmed.</P>
      <P><strong>Cut</strong> — fades the card to 50% opacity and strikes through the title. Use this to keep cut elements visible without deleting them.</P>

      <H3>Instances</H3>
      <P>Right-click a card → <strong>Create Instance</strong> to place the same entity in a different location on the board. Instances share the entity note and attributes. Each has its own placement note and color. The ◈ glyph in the handle bar marks cards that have multiple instances.</P>

      <H3>Duplicating vs instancing</H3>
      <P><strong>Duplicate</strong> (<Kbd>Ctrl</Kbd> <Kbd>D</Kbd>) — creates a fully independent copy with a new entity. Use when you want a separate entity that starts from the same content.</P>
      <P><strong>Instance</strong> (<Kbd>Ctrl</Kbd> <Kbd>I</Kbd>) — creates a new placement of the same entity. Use when the same story element appears in multiple contexts on the board.</P>

      <H3>Color</H3>
      <P>Cards have 24 color swatches, with a default color assigned per entity type. Override per card in edit mode.</P>

      <H3>Notes</H3>
      <P>The <strong>Note</strong> is shared across all instances of an entity — editing it on one card updates all of them. It supports Markdown (bold, italic, inline code).</P>
      <P>The <strong>Placement note</strong> is local to a single card. Use it for spatial context: "Ezra at the saloon" vs "Ezra in the flashback".</P>
    </div>
  )
}

// ── Backdrops ─────────────────────────────────────────────────────────────────

function BackdropsHelp() {
  return (
    <div>
      <H2>Backdrops</H2>
      <P>Backdrops are resizable spatial regions that visually group cards by story structure. They always sit behind all cards on the canvas.</P>

      <H3>Creating a backdrop</H3>
      <P><strong>Right-click</strong> empty canvas and choose a backdrop type from the menu. The cursor becomes a crosshair and a hint banner appears at the bottom of the screen. <strong>Click and drag</strong> to draw the bounds, then release to create. Press <Kbd>Esc</Kbd> to cancel.</P>
      <P>You can also use the <strong>Tab menu</strong> — press <Kbd>Tab</Kbd>, type the backdrop type, and press <Kbd>Enter</Kbd>. This creates a backdrop at a preset size centered on the cursor.</P>

      <H3>Backdrop types</H3>
      <P><strong>Act</strong> — highest level structural container. Attributes: Function, Dramatic Question, Shift.</P>
      <P><strong>Sequence</strong> — a group of scenes that accomplish one narrative goal. Attributes: Goal, Conflict, Outcome.</P>
      <P><strong>Scene</strong> — a discrete scene container. Attributes: INT/EXT, Time of Day, Goal, Conflict, Outcome. Scene backdrops use the INT/EXT and Time of Day attributes to assemble a proper slugline when exporting to Fountain or Final Draft.</P>
      <P><strong>Beat</strong> — the smallest structural unit. Attribute: Description.</P>
      <P><strong>Custom</strong> — a freeform grouping region with no fixed schema. Useful for visual organisation without imposing structural meaning. Custom backdrops are transparent to the outline and screenplay exports — their children are treated as if they belong to the nearest non-Custom parent.</P>

      <H3>Status</H3>
      <P>Backdrops also have a Status attribute (Active/Draft/Cut). Draft shows a DRAFT badge in the header. Cut fades the entire backdrop and strikes through its title.</P>

      <H3>Moving backdrops</H3>
      <P>Drag the coloured header bar. Cards whose bounding boxes are fully inside the backdrop move with it. Spatial membership is computed at drag start — it is not stored.</P>

      <H3>Resizing</H3>
      <P>Hover over the header — eight resize handles appear at the corners and edge midpoints. Drag any handle to resize.</P>

      <H3>Editing</H3>
      <P>Click the pencil icon in the header to open the edit panel. Title, type, type-specific attributes, note, and color are all editable here.</P>
      <P>The <strong>note</strong> appears in the lower-left corner of the backdrop — useful for brief stage direction or reminders about the section's purpose.</P>
      <P><strong>Double-click</strong> the title text in the backdrop body to jump straight to editing.</P>

      <H3>Canvas interaction within backdrops</H3>
      <P>The backdrop body is pointer-events transparent — you can double-click inside a backdrop to create a card, right-click for the canvas menu, and pan or zoom normally. Only the header bar and resize handles intercept input.</P>
    </div>
  )
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function ToolbarHelp() {
  return (
    <div>
      <H2>Toolbar</H2>

      <H3>About (Brainboard logo)</H3>
      <P>Click the <strong>Brainboard</strong> wordmark in the top-left to open the About panel, which has links to the Minimal Humans website and the Discord community.</P>

      <H3>Board name and project info</H3>
      <P>Click the <strong>board name</strong> to open the Project Info panel. Here you can rename the board and fill in screenplay title-page fields — Credit, Author, Source, Draft Date, Contact, and Copyright. These fields are used when exporting to Fountain or Final Draft.</P>

      <H3>Undo / Redo</H3>
      <P>The <strong>↩</strong> and <strong>↪</strong> buttons undo and redo board changes. Keyboard shortcuts: <Kbd>Ctrl</Kbd> <Kbd>Z</Kbd> to undo, <Kbd>Ctrl</Kbd> <Kbd>Y</Kbd> or <Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>Z</Kbd> to redo. Up to 50 steps are stored. Viewport changes (pan, zoom) are not tracked.</P>

      <H3>Zoom controls</H3>
      <P>The <Kbd>−</Kbd> and <Kbd>+</Kbd> buttons zoom out and in by 25% increments, keeping the viewport center fixed. Click the percentage display to reset to 100%. The scroll wheel zooms toward the cursor position.</P>

      <H3>Day / Night toggle</H3>
      <P>The sun/moon icon in the center of the toolbar switches between dark and light themes. Your preference is saved to the browser.</P>

      <H3>New Board</H3>
      <P>Creates a new blank board. You will be prompted to confirm — your current board will be lost unless you export it first.</P>

      <H3>Import</H3>
      <P>Opens a file picker. Loading a board replaces the current board. Only <code>.brainboard.json</code> files (schema version 1) are accepted.</P>

      <H3>Export</H3>
      <P>Opens a format picker with three options:</P>
      <P><strong>Board Data (.json)</strong> — the full Brainboard format. Use this to archive or reimport your board.</P>
      <P><strong>Fountain (.fountain)</strong> — a screenplay skeleton for Highland, Slugline, Final Draft, or any Fountain-aware tool. Structural data (Act/Sequence/Scene attributes, beats, characters, shots) is emitted as Fountain boneyard blocks and action lines.</P>
      <P><strong>Final Draft (.fdx)</strong> — a screenplay skeleton for Final Draft 10+. Scene headings carry title and synopsis metadata for Final Draft's navigator panel.</P>

      <H3>Templates</H3>
      <P>Opens the template browser. Each template can be loaded as a new board (replacing current content) or merged into the existing board (content is appended and offset to avoid overlap).</P>
      <P><strong>My Templates</strong> tab — save your current board as a reusable template using the "Save current board" button. Saved templates persist in the browser.</P>

      <H3>Outline</H3>
      <P>Generates a Markdown outline of the current board, derived from the spatial structure of your backdrops and cards. The outline updates live while the modal is open. Use <strong>Copy Markdown</strong> to copy to the clipboard, or <strong>Export .md</strong> to download the file.</P>

      <H3>Status bar</H3>
      <P>The bar at the bottom shows the current selection count on the left. On the right: Backdrops, Cards, and Entities counts. If any cards have Status set to Draft, a Drafts count also appears.</P>
    </div>
  )
}

// ── Shortcuts ─────────────────────────────────────────────────────────────────

function ShortcutsHelp() {
  const rows: [string[], string][] = [
    [['Double-click canvas'],     'Create card at cursor position'],
    [['Double-click card'],       'Enter edit mode'],
    [['Tab'],                     'Open spotlight menu — type to filter, Enter to create'],
    [['Right-click canvas'],      'Canvas context menu (new card, new backdrop)'],
    [['Right-click card'],        'Card context menu (edit, duplicate, instance, delete)'],
    [['Space', 'Drag'],           'Pan the canvas'],
    [['Middle mouse', 'Drag'],    'Pan the canvas'],
    [['Scroll wheel'],            'Zoom toward cursor'],
    [['F'],                       'Frame all cards and backdrops in view'],
    [['Ctrl', 'Z'],               'Undo'],
    [['Ctrl', 'Y'],               'Redo (also Ctrl Shift Z)'],
    [['Ctrl', 'A'],               'Select all cards'],
    [['Click'],                   'Select card'],
    [['Shift', 'Click'],          'Add or remove card from selection'],
    [['Drag canvas'],             'Rubber-band select cards'],
    [['Ctrl', 'D'],               'Duplicate selected card(s)'],
    [['Ctrl', 'I'],               'Create instance of selected card'],
    [['Delete / Backspace'],      'Delete selected card(s)'],
    [['Esc'],                     'Clear selection / cancel creation mode / close menus'],
  ]

  return (
    <div>
      <H2>Keyboard Shortcuts</H2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Shortcut</th>
            <th className={styles.th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([keys, desc]) => (
            <tr key={desc} className={styles.tr}>
              <td className={styles.tdShortcut}>
                {keys.map((k, i) => (
                  <React.Fragment key={k}>
                    <Kbd>{k}</Kbd>
                    {i < keys.length - 1 && <span className={styles.plus}> + </span>}
                  </React.Fragment>
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
