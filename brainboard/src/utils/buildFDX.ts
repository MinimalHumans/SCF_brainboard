/**
 * buildFDX.ts
 * -----------
 * Converts a Brainboard Board into a Final Draft XML (.fdx) screenplay skeleton.
 * The output loads cleanly in Final Draft 10+ and most FDX-compatible tools.
 *
 * This is a one-way, read-only export — no round-trip is supported.
 *
 * FDX format notes:
 * - Final Draft recalculates Length and Page values on open; we emit 0.
 * - Sidecar context (characters, beats, themes, etc.) goes into bracketed
 *   Action paragraphs rather than ScriptNote elements for maximum portability
 *   across FDX readers that don't all support ScriptNote the same way.
 * - Every text value is XML-escaped. Run through `esc()` exactly once.
 */

import type { Board, Card, Entity, Backdrop } from '@/types/board'
import {
  buildBackdropParentMap,
  buildCardParentMap,
  cardsInBackdrop,
  backdropsInBackdrop,
  rootBackdrops,
  rootCards,
  rowSort,
  assembleSceneHeadingFromBackdrop,
  assembleSceneHeadingFromCard,
} from './screenplayCommon'

// ─── XML helpers ─────────────────────────────────────────────────────────────

/** Escape all five XML special characters. Apply to every text/attribute value. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Emit a standard paragraph. Returns empty string if text is blank — never emit empty <Text>. */
function para(type: string, text: string, alignAttr = ''): string {
  const t = text.trim()
  if (!t) return ''
  return [
    `    <Paragraph Type="${type}"${alignAttr}>`,
    `      <Text>${esc(t)}</Text>`,
    `    </Paragraph>`,
  ].join('\n')
}

/**
 * Emit a Scene Heading paragraph with optional SceneProperties metadata.
 * SceneProperties carries the synopsis and scene title for Final Draft's
 * scene navigator — Length and Page are recalculated by Final Draft on open.
 */
function sceneHeadingPara(slugline: string, navTitle: string, synopsis: string): string {
  const synAttr   = synopsis ? ` Synopsis="${esc(synopsis.trim())}"` : ''
  const titleAttr = ` Title="${esc(navTitle.trim())}"`
  return [
    `    <Paragraph Type="Scene Heading">`,
    `      <SceneProperties Length="0" Page="0"${titleAttr}${synAttr}/>`,
    `      <Text>${esc(slugline)}</Text>`,
    `    </Paragraph>`,
  ].join('\n')
}

// ─── Attribute helpers ────────────────────────────────────────────────────────

function attr(
  attributes: Record<string, string | string[]> | Record<string, string> | undefined,
  key: string,
): string {
  if (!attributes) return ''
  const v = attributes[key]
  return typeof v === 'string' ? v.trim() : ''
}

function strAttrs(
  attributes: Record<string, string | string[]>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(attributes)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildFDX(board: Board): string {
  const { cards, entities, backdrops, name, projectInfo } = board
  const eMap       = new Map<string, Entity>(entities.map(e => [e.id, e]))
  const bdParent   = buildBackdropParentMap(backdrops)
  const cardParent = buildCardParentMap(cards, backdrops)
  const content: string[] = []

  // ── Recursive structural traversal ─────────────────────────────────────────

  function emitBackdrop(bd: Backdrop) {
    switch (bd.type) {
      case 'Act': {
        const p = para('New Act', `ACT — ${bd.title.toUpperCase()}`)
        if (p) content.push(p)
        if (bd.note?.trim()) {
          const np = para('Action', bd.note.trim())
          if (np) content.push(np)
        }
        for (const child of backdropsInBackdrop(bd.id, backdrops, bdParent)) {
          emitBackdrop(child)
        }
        for (const c of cardsInBackdrop(bd.id, cards, cardParent).filter(c => c.type === 'Scene')) {
          emitSceneCard(c)
        }
        break
      }

      case 'Sequence': {
        const p = para('General', `SEQUENCE: ${bd.title.toUpperCase()}`)
        if (p) content.push(p)
        if (bd.note?.trim()) {
          const np = para('Action', bd.note.trim())
          if (np) content.push(np)
        }
        for (const child of backdropsInBackdrop(bd.id, backdrops, bdParent)) {
          emitBackdrop(child)
        }
        for (const c of cardsInBackdrop(bd.id, cards, cardParent).filter(c => c.type === 'Scene')) {
          emitSceneCard(c)
        }
        break
      }

      case 'Beat': {
        // Structural Beat at Act/Sequence level.
        // Beats nested inside Scene backdrops are handled as sidecar context.
        const p = para('Action', `— BEAT: ${bd.title} —`)
        if (p) content.push(p)
        if (bd.note?.trim()) {
          const np = para('Action', bd.note.trim())
          if (np) content.push(np)
        }
        for (const child of backdropsInBackdrop(bd.id, backdrops, bdParent)) {
          emitBackdrop(child)
        }
        break
      }

      case 'Scene':
        emitSceneBackdrop(bd)
        break

      // 'Custom' is transparent — children are promoted by the parent map.
    }
  }

  function emitSceneBackdrop(bd: Backdrop) {
    const heading  = assembleSceneHeadingFromBackdrop(bd, cards, eMap, cardParent)
    const synopsis = bd.note?.trim() || attr(bd.attributes, 'goal')
    content.push(sceneHeadingPara(heading.raw, bd.title, synopsis))

    const contained     = cardsInBackdrop(bd.id, cards, cardParent)
    const beatBackdrops = backdropsInBackdrop(bd.id, backdrops, bdParent).filter(b => b.type === 'Beat')

    emitSceneSidecar(contained, beatBackdrops)
  }

  function emitSceneCard(card: Card) {
    const entity   = eMap.get(card.entityId)
    const heading  = assembleSceneHeadingFromCard(card, entity, cards, eMap, cardParent)
    const note     = (entity?.noteRaw ?? card.noteRaw)?.trim() || ''
    const goal     = attr(strAttrs(entity?.attributes ?? {}), 'goal')
    const synopsis = note || goal
    content.push(sceneHeadingPara(heading.raw, entity?.title ?? card.title, synopsis))

    // For a standalone Scene card, contextual data comes from its attributes.
    const conflict = attr(strAttrs(entity?.attributes ?? {}), 'conflict')
    const outcome  = attr(strAttrs(entity?.attributes ?? {}), 'outcome')
    if (conflict) {
      const p = para('Action', `[Conflict: ${conflict}]`)
      if (p) content.push(p)
    }
    if (outcome) {
      const p = para('Action', `[Outcome: ${outcome}]`)
      if (p) content.push(p)
    }
  }

  /**
   * Emit sidecar context Action paragraphs and Shot paragraphs for a scene.
   * Beat backdrops nested inside the scene are folded in as context items
   * rather than structural Beat markers.
   */
  function emitSceneSidecar(contained: Card[], beatBackdrops: Backdrop[]) {
    const charCards    = contained.filter(c => c.type === 'Character')
    const propCards    = contained.filter(c => c.type === 'Prop')
    const themeCards   = contained.filter(c => c.type === 'Theme')
    const arcCards     = contained.filter(c => c.type === 'Arc')
    const thoughtCards = contained.filter(c => c.type === 'Thought')
    const beatCards    = contained.filter(c => c.type === 'Beat')
    const shotCards    = contained.filter(c => c.type === 'Shot')

    // Characters
    if (charCards.length > 0) {
      const names = charCards.map(c => (eMap.get(c.entityId)?.title ?? c.title).toUpperCase())
      const p = para('Action', `[Characters: ${names.join(', ')}]`)
      if (p) content.push(p)
    }

    // Beat backdrops nested inside this scene
    for (const bd of beatBackdrops) {
      const desc = attr(bd.attributes, 'description')
      const text = desc ? `[Beat: ${bd.title} — ${desc}]` : `[Beat: ${bd.title}]`
      const p = para('Action', text)
      if (p) content.push(p)
    }

    // Beat cards inside this scene
    for (const c of beatCards) {
      const e    = eMap.get(c.entityId)
      const desc = attr(strAttrs(e?.attributes ?? {}), 'description') || (e?.noteRaw ?? c.noteRaw)?.trim() || ''
      const title = e?.title ?? c.title
      const text  = desc ? `[Beat: ${title} — ${desc}]` : `[Beat: ${title}]`
      const p = para('Action', text)
      if (p) content.push(p)
    }

    // Themes
    for (const c of themeCards) {
      const e    = eMap.get(c.entityId)
      const stmt = attr(strAttrs(e?.attributes ?? {}), 'statement')
      const title = e?.title ?? c.title
      const text  = stmt ? `[Theme: ${title} — ${stmt}]` : `[Theme: ${title}]`
      const p = para('Action', text)
      if (p) content.push(p)
    }

    // Arcs
    for (const c of arcCards) {
      const e       = eMap.get(c.entityId)
      const subject = attr(strAttrs(e?.attributes ?? {}), 'subject')
      const axis    = attr(strAttrs(e?.attributes ?? {}), 'axis')
      const title   = e?.title ?? c.title
      let text: string
      if (subject && axis) text = `[Arc: ${title} — ${subject}: ${axis}]`
      else if (subject)    text = `[Arc: ${title} — ${subject}]`
      else                 text = `[Arc: ${title}]`
      const p = para('Action', text)
      if (p) content.push(p)
    }

    // Props
    for (const c of propCards) {
      const e    = eMap.get(c.entityId)
      const desc = attr(strAttrs(e?.attributes ?? {}), 'description')
      const title = e?.title ?? c.title
      const text  = desc ? `[Prop: ${title} — ${desc}]` : `[Prop: ${title}]`
      const p = para('Action', text)
      if (p) content.push(p)
    }

    // Thoughts / loose notes
    for (const c of thoughtCards) {
      const note = (eMap.get(c.entityId)?.noteRaw ?? c.noteRaw)?.trim()
      if (note) {
        const p = para('Action', `[Note: ${note}]`)
        if (p) content.push(p)
      }
    }

    // Shots — use the FDX Shot paragraph type
    for (const c of shotCards) {
      const e       = eMap.get(c.entityId)
      const title   = e?.title ?? c.title
      const framing = attr(strAttrs(e?.attributes ?? {}), 'framing')
      const purpose = attr(strAttrs(e?.attributes ?? {}), 'purpose')
      const prefix  = framing ? framing.toUpperCase() : 'ANGLE ON'
      const text    = purpose
        ? `${prefix}: ${title.toUpperCase()}. ${purpose}`
        : `${prefix}: ${title.toUpperCase()}.`
      const p = para('Shot', text)
      if (p) content.push(p)
    }
  }

  // ── Root-level traversal ──────────────────────────────────────────────────

  const topBackdrops = rootBackdrops(backdrops, bdParent)
  for (const bd of topBackdrops) {
    emitBackdrop(bd)
  }

  // Standalone Scene cards at root level
  const rootSceneCards = rowSort(rootCards(cards, cardParent).filter(c => c.type === 'Scene'))
  for (const c of rootSceneCards) {
    emitSceneCard(c)
  }

  // Loose Notes — orphan cards not attached to any scene structure
  const handledAtRoot = new Set(['Scene'])
  const orphans = rowSort(rootCards(cards, cardParent).filter(c => !handledAtRoot.has(c.type)))
  if (orphans.length > 0) {
    const noteP = para('General', 'LOOSE NOTES')
    if (noteP) content.push(noteP)
    for (const c of orphans) {
      const e     = eMap.get(c.entityId)
      const title = e?.title ?? c.title
      const note  = (e?.noteRaw ?? c.noteRaw)?.trim()
      const desc  = attr(strAttrs(e?.attributes ?? {}), 'description')
      const info  = note || desc
      const text  = info ? `[${c.type}: ${title} — ${info}]` : `[${c.type}: ${title}]`
      const p = para('Action', text)
      if (p) content.push(p)
    }
  }

  // ── Title page ─────────────────────────────────────────────────────────────

  const titlePageParagraphs: string[] = []

  const addCentered = (text: string) => {
    const p = para('Action', text, ' Alignment="Center"')
    if (p) titlePageParagraphs.push(p)
  }

  addCentered(name)

  const credit = projectInfo?.credit?.trim()
  const author = projectInfo?.author?.trim()
  if (credit || author) {
    titlePageParagraphs.push(para('Action', '', '')) // blank line
    if (credit) addCentered(credit)
    if (author) addCentered(author)
  }

  if (projectInfo?.source?.trim()) {
    titlePageParagraphs.push(para('Action', '', ''))
    addCentered(projectInfo.source.trim())
  }

  if (projectInfo?.draftDate?.trim()) {
    titlePageParagraphs.push(para('Action', '', ''))
    addCentered(projectInfo.draftDate.trim())
  }

  if (projectInfo?.contact?.trim()) {
    titlePageParagraphs.push(para('Action', '', ''))
    for (const line of projectInfo.contact.trim().split('\n')) {
      addCentered(line.trim())
    }
  }

  if (projectInfo?.copyright?.trim()) {
    titlePageParagraphs.push(para('Action', '', ''))
    addCentered(projectInfo.copyright.trim())
  }

  // ── Assemble document ─────────────────────────────────────────────────────

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
    '<FinalDraft DocumentType="Script" Template="No" Version="6">',
    '  <Content>',
    ...content,
    '  </Content>',
    '  <TitlePage>',
    '    <Content>',
    ...titlePageParagraphs.filter(Boolean),
    '    </Content>',
    '  </TitlePage>',
    '</FinalDraft>',
  ]

  return lines.join('\n')
}
