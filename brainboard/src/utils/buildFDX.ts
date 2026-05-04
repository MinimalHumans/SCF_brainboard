/**
 * buildFDX.ts
 * -----------
 * Converts a Brainboard Board into a Final Draft XML (.fdx) screenplay skeleton.
 * The output loads cleanly in Final Draft 10+ and most FDX-compatible tools.
 *
 * This is a one-way, read-only export — no round-trip is supported.
 *
 * Data-retention approach
 * -----------------------
 * Every filled field on every backdrop and card is emitted somewhere.
 * Nothing is silently dropped. Writers delete what they don't need.
 *
 *   Structural attrs (Act/Sequence/Scene) → bracketed Action paragraphs
 *   Shots at any level                   → Shot paragraphs
 *   Characters/etc. in structural scope  → bracketed Action paragraphs
 *   Orphan entity-library cards at root  → Loose Notes section with full attributes
 *
 * FDX format notes:
 * - Final Draft recalculates Length and Page on open; emit 0 for both.
 * - Sidecar context uses bracketed Action paragraphs (not ScriptNote elements)
 *   for maximum portability across FDX-consuming tools.
 * - Every text value is XML-escaped through esc(). Apply once per value.
 */

import type { Board, Card, Entity, Backdrop } from '@/types/board'
import { ATTRIBUTE_SCHEMAS } from '@/config/attributeSchemas'
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

/** Emit a standard paragraph. Returns '' if text is blank — never emit empty <Text>. */
function para(type: string, text: string, extraAttrs = ''): string {
  const t = text.trim()
  if (!t) return ''
  return [
    `    <Paragraph Type="${type}"${extraAttrs}>`,
    `      <Text>${esc(t)}</Text>`,
    `    </Paragraph>`,
  ].join('\n')
}

/**
 * Emit a Scene Heading paragraph with SceneProperties metadata.
 * SceneProperties carries the title and synopsis for Final Draft's navigator.
 * Length and Page are recalculated by Final Draft on open.
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

  // ── Shot paragraph helper ─────────────────────────────────────────────────
  function emitShot(c: Card) {
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

  // ── Scene sidecar paragraphs ──────────────────────────────────────────────

  interface SceneAttrs { goal?: string; conflict?: string; outcome?: string }

  /**
   * Emit bracketed Action paragraphs for scene context, followed by Shot
   * paragraphs. Called for both Scene backdrops and standalone Scene cards.
   */
  function emitSceneSidecar(
    contained:     Card[],
    beatBackdrops: Backdrop[],
    sceneAttrs?:   SceneAttrs,
  ) {
    const charCards    = contained.filter(c => c.type === 'Character')
    const propCards    = contained.filter(c => c.type === 'Prop')
    const themeCards   = contained.filter(c => c.type === 'Theme')
    const arcCards     = contained.filter(c => c.type === 'Arc')
    const thoughtCards = contained.filter(c => c.type === 'Thought')
    const beatCards    = contained.filter(c => c.type === 'Beat')
    const shotCards    = contained.filter(c => c.type === 'Shot')

    // Scene structural attributes — emit first so plan is visible above cast
    if (sceneAttrs?.goal) {
      const p = para('Action', `[Goal: ${sceneAttrs.goal}]`)
      if (p) content.push(p)
    }
    if (sceneAttrs?.conflict) {
      const p = para('Action', `[Conflict: ${sceneAttrs.conflict}]`)
      if (p) content.push(p)
    }
    if (sceneAttrs?.outcome) {
      const p = para('Action', `[Outcome: ${sceneAttrs.outcome}]`)
      if (p) content.push(p)
    }

    // Characters
    if (charCards.length > 0) {
      const names = charCards.map(c => (eMap.get(c.entityId)?.title ?? c.title).toUpperCase())
      const p = para('Action', `[Characters: ${names.join(', ')}]`)
      if (p) content.push(p)
    }

    // Beat backdrops nested inside scene (folded into sidecar)
    for (const bd of beatBackdrops) {
      const desc = attr(bd.attributes, 'description')
      const text = desc ? `[Beat: ${bd.title} — ${desc}]` : `[Beat: ${bd.title}]`
      const p = para('Action', text)
      if (p) content.push(p)
    }

    // Beat cards
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

    // Thoughts
    for (const c of thoughtCards) {
      const note = (eMap.get(c.entityId)?.noteRaw ?? c.noteRaw)?.trim()
      if (note) {
        const p = para('Action', `[Note: ${note}]`)
        if (p) content.push(p)
      }
    }

    // Shots
    for (const c of shotCards) emitShot(c)
  }

  // ── Scene backdrop ─────────────────────────────────────────────────────────

  function emitSceneBackdrop(bd: Backdrop) {
    const heading  = assembleSceneHeadingFromBackdrop(bd, cards, eMap, cardParent)
    // Goal → FDX Synopsis (appears in Final Draft's navigator panel)
    const goal     = attr(bd.attributes, 'goal')
    const synopsis = bd.note?.trim() || goal
    content.push(sceneHeadingPara(heading.raw, bd.title, synopsis))

    const sceneAttrs: SceneAttrs = {
      goal,
      conflict: attr(bd.attributes, 'conflict'),
      outcome:  attr(bd.attributes, 'outcome'),
    }

    const contained     = cardsInBackdrop(bd.id, cards, cardParent)
    const beatBackdrops = backdropsInBackdrop(bd.id, backdrops, bdParent).filter(b => b.type === 'Beat')
    emitSceneSidecar(contained, beatBackdrops, sceneAttrs)
  }

  // ── Standalone Scene card ─────────────────────────────────────────────────

  function emitSceneCard(card: Card) {
    const entity   = eMap.get(card.entityId)
    const heading  = assembleSceneHeadingFromCard(card, entity, cards, eMap, cardParent)
    const note     = (entity?.noteRaw ?? card.noteRaw)?.trim() || ''
    const goal     = attr(strAttrs(entity?.attributes ?? {}), 'goal')
    const synopsis = note || goal
    content.push(sceneHeadingPara(heading.raw, entity?.title ?? card.title, synopsis))

    const sceneAttrs: SceneAttrs = {
      goal,
      conflict: attr(strAttrs(entity?.attributes ?? {}), 'conflict'),
      outcome:  attr(strAttrs(entity?.attributes ?? {}), 'outcome'),
    }
    // Scene cards have no spatially-contained children; attrs only in sidecar
    emitSceneSidecar([], [], sceneAttrs)
  }

  // ── Act / Sequence structural context helper ───────────────────────────────
  /**
   * Emit bracketed Action paragraphs for Act or Sequence level, combining
   * typed structural attributes with any non-Scene, non-Shot direct-child cards.
   * Returns Shot cards for the caller to emit as Shot paragraphs.
   */
  function emitStructuralContext(
    attrParas:   string[],    // pre-built attribute paragraphs
    directCards: Card[],
  ): Card[] {
    const charCards    = directCards.filter(c => c.type === 'Character')
    const propCards    = directCards.filter(c => c.type === 'Prop')
    const beatCards    = directCards.filter(c => c.type === 'Beat')
    const themeCards   = directCards.filter(c => c.type === 'Theme')
    const arcCards     = directCards.filter(c => c.type === 'Arc')
    const thoughtCards = directCards.filter(c => c.type === 'Thought')
    const shotCards    = directCards.filter(c => c.type === 'Shot')

    // Structural attributes first
    for (const p of attrParas) if (p) content.push(p)

    // Characters
    if (charCards.length > 0) {
      const names = charCards.map(c => (eMap.get(c.entityId)?.title ?? c.title).toUpperCase())
      const p = para('Action', `[Characters: ${names.join(', ')}]`)
      if (p) content.push(p)
    }

    // Props
    for (const c of propCards) {
      const e    = eMap.get(c.entityId)
      const desc = attr(strAttrs(e?.attributes ?? {}), 'description')
      const title = e?.title ?? c.title
      const p = para('Action', desc ? `[Prop: ${title} — ${desc}]` : `[Prop: ${title}]`)
      if (p) content.push(p)
    }

    // Beats
    for (const c of beatCards) {
      const e    = eMap.get(c.entityId)
      const desc = attr(strAttrs(e?.attributes ?? {}), 'description') || (e?.noteRaw ?? c.noteRaw)?.trim() || ''
      const title = e?.title ?? c.title
      const p = para('Action', desc ? `[Beat: ${title} — ${desc}]` : `[Beat: ${title}]`)
      if (p) content.push(p)
    }

    // Themes
    for (const c of themeCards) {
      const e    = eMap.get(c.entityId)
      const stmt = attr(strAttrs(e?.attributes ?? {}), 'statement')
      const title = e?.title ?? c.title
      const p = para('Action', stmt ? `[Theme: ${title} — ${stmt}]` : `[Theme: ${title}]`)
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

    // Thoughts
    for (const c of thoughtCards) {
      const note = (eMap.get(c.entityId)?.noteRaw ?? c.noteRaw)?.trim()
      if (note) {
        const p = para('Action', `[Note: ${note}]`)
        if (p) content.push(p)
      }
    }

    return shotCards
  }

  // ── Recursive structural traversal ─────────────────────────────────────────

  function emitBackdrop(bd: Backdrop) {
    switch (bd.type) {

      case 'Act': {
        const actPara = para('New Act', `ACT — ${bd.title.toUpperCase()}`)
        if (actPara) content.push(actPara)
        if (bd.note?.trim()) {
          const np = para('Action', bd.note.trim())
          if (np) content.push(np)
        }

        // Act structural attribute paragraphs
        const actAttrParas: string[] = []
        const fn = attr(bd.attributes, 'function')
        const dq = attr(bd.attributes, 'dramatic_question')
        const sh = attr(bd.attributes, 'shift')
        if (fn) actAttrParas.push(para('Action', `[Function: ${fn}]`))
        if (dq) actAttrParas.push(para('Action', `[Dramatic Question: ${dq}]`))
        if (sh) actAttrParas.push(para('Action', `[Shift: ${sh}]`))

        // Direct-child cards
        const directCards    = cardsInBackdrop(bd.id, cards, cardParent)
        const directNonScene = directCards.filter(c => c.type !== 'Scene')

        const directShots = emitStructuralContext(actAttrParas, directNonScene)
        for (const c of directShots) emitShot(c)

        // Recurse into child backdrops
        for (const child of backdropsInBackdrop(bd.id, backdrops, bdParent)) {
          emitBackdrop(child)
        }

        // Scene entity cards directly inside this Act
        for (const c of directCards.filter(c => c.type === 'Scene')) {
          emitSceneCard(c)
        }
        break
      }

      case 'Sequence': {
        const seqPara = para('General', `SEQUENCE: ${bd.title.toUpperCase()}`)
        if (seqPara) content.push(seqPara)
        if (bd.note?.trim()) {
          const np = para('Action', bd.note.trim())
          if (np) content.push(np)
        }

        // Sequence structural attribute paragraphs
        const seqAttrParas: string[] = []
        const goal     = attr(bd.attributes, 'goal')
        const conflict = attr(bd.attributes, 'conflict')
        const outcome  = attr(bd.attributes, 'outcome')
        if (goal)     seqAttrParas.push(para('Action', `[Goal: ${goal}]`))
        if (conflict) seqAttrParas.push(para('Action', `[Conflict: ${conflict}]`))
        if (outcome)  seqAttrParas.push(para('Action', `[Outcome: ${outcome}]`))

        const directCards    = cardsInBackdrop(bd.id, cards, cardParent)
        const directNonScene = directCards.filter(c => c.type !== 'Scene')

        const directShots = emitStructuralContext(seqAttrParas, directNonScene)
        for (const c of directShots) emitShot(c)

        for (const child of backdropsInBackdrop(bd.id, backdrops, bdParent)) {
          emitBackdrop(child)
        }

        for (const c of directCards.filter(c => c.type === 'Scene')) {
          emitSceneCard(c)
        }
        break
      }

      case 'Beat': {
        const p = para('Action', `— BEAT: ${bd.title} —`)
        if (p) content.push(p)
        if (bd.note?.trim()) {
          const np = para('Action', bd.note.trim())
          if (np) content.push(np)
        }
        const desc = attr(bd.attributes, 'description')
        if (desc) {
          const dp = para('Action', `[Description: ${desc}]`)
          if (dp) content.push(dp)
        }
        for (const child of backdropsInBackdrop(bd.id, backdrops, bdParent)) {
          emitBackdrop(child)
        }
        break
      }

      case 'Scene':
        emitSceneBackdrop(bd)
        break

      // 'Custom' is transparent — its children are promoted by the parent map
    }
  }

  // ── Root traversal ────────────────────────────────────────────────────────

  for (const bd of rootBackdrops(backdrops, bdParent)) {
    emitBackdrop(bd)
  }

  // Standalone Scene cards at root level
  const rootSceneCards = rowSort(rootCards(cards, cardParent).filter(c => c.type === 'Scene'))
  for (const c of rootSceneCards) {
    emitSceneCard(c)
  }

  // ── Loose Notes ───────────────────────────────────────────────────────────
  // Orphan entity-library cards (typically Character/Location/Prop reference
  // columns outside the Act layout). Emit with full attributes. Deduplicate
  // by entityId — multiple card instances share one entity.
  const handledAtRoot = new Set(['Scene'])
  const seenEntityIds = new Set<string>()
  const orphans = rowSort(rootCards(cards, cardParent).filter(c => !handledAtRoot.has(c.type)))

  if (orphans.length > 0) {
    const headerP = para('General', 'LOOSE NOTES')
    if (headerP) content.push(headerP)

    for (const c of orphans) {
      if (seenEntityIds.has(c.entityId)) continue
      seenEntityIds.add(c.entityId)

      const e     = eMap.get(c.entityId)
      const title = e?.title ?? c.title
      const eType = (e?.type ?? c.type) as keyof typeof ATTRIBUTE_SCHEMAS
      const schema = ATTRIBUTE_SCHEMAS[eType] ?? ATTRIBUTE_SCHEMAS[c.type as keyof typeof ATTRIBUTE_SCHEMAS] ?? []
      const note  = (e?.noteRaw ?? c.noteRaw)?.trim()

      // Build attribute summary from schema
      const attrParts: string[] = []
      for (const f of schema) {
        if (f.key === 'status') continue
        const v = e?.attributes[f.key]
        if (typeof v === 'string' && v.trim()) {
          attrParts.push(`${f.label}: ${v.trim()}`)
        }
      }

      // Entity name + attributes on one paragraph, note on a second if present
      const summaryParts = [`[${c.type}: ${title}`]
      if (attrParts.length > 0) summaryParts.push(` — ${attrParts.join(' · ')}`)
      summaryParts.push(']')
      const p = para('Action', summaryParts.join(''))
      if (p) content.push(p)

      if (note) {
        const np = para('Action', `[${note}]`)
        if (np) content.push(np)
      }
    }
  }

  // ── Title page ─────────────────────────────────────────────────────────────

  const titlePageParagraphs: string[] = []

  const addCentered = (text: string) => {
    if (!text.trim()) return
    titlePageParagraphs.push(
      `    <Paragraph Type="Action" Alignment="Center">`,
      `      <Text>${esc(text.trim())}</Text>`,
      `    </Paragraph>`,
    )
  }

  addCentered(name)

  const credit = projectInfo?.credit?.trim()
  const author = projectInfo?.author?.trim()
  if (credit || author) {
    if (credit) addCentered(credit)
    if (author) addCentered(author)
  }

  if (projectInfo?.source?.trim())    addCentered(projectInfo.source.trim())
  if (projectInfo?.draftDate?.trim()) addCentered(projectInfo.draftDate.trim())

  if (projectInfo?.contact?.trim()) {
    for (const line of projectInfo.contact.trim().split('\n')) {
      addCentered(line.trim())
    }
  }

  if (projectInfo?.copyright?.trim()) addCentered(projectInfo.copyright.trim())

  // ── Assemble document ─────────────────────────────────────────────────────

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
    '<FinalDraft DocumentType="Script" Template="No" Version="6">',
    '  <Content>',
    ...content,
    '  </Content>',
    '  <TitlePage>',
    '    <Content>',
    ...titlePageParagraphs,
    '    </Content>',
    '  </TitlePage>',
    '</FinalDraft>',
  ].join('\n')
}
