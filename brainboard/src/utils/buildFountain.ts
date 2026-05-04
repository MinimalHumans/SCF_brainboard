/**
 * buildFountain.ts
 * ----------------
 * Converts a Brainboard Board into a Fountain screenplay skeleton.
 * The output is a starting-point script the writer loads into Highland,
 * Slugline, Final Draft, or any Fountain-aware tool.
 *
 * This is a one-way, read-only export — no round-trip is supported.
 *
 * Fountain spec reference: https://fountain.io/syntax
 *
 * Data-retention approach
 * -----------------------
 * Every filled field on every backdrop and card is emitted somewhere.
 * Nothing is silently dropped. Writers delete what they don't need;
 * they can't recover what was never written.
 *
 *   Structural attrs (Act/Sequence/Scene) → boneyard [[ ]] context blocks
 *   Shots at any level                   → uppercase action lines
 *   Characters/etc. in structural scope  → boneyard lines in context block
 *   Orphan entity-library cards at root  → Loose Notes with full attributes
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

// ─── Main export ─────────────────────────────────────────────────────────────

export function buildFountain(board: Board): string {
  const { cards, entities, backdrops, name, projectInfo } = board
  const eMap       = new Map<string, Entity>(entities.map(e => [e.id, e]))
  const bdParent   = buildBackdropParentMap(backdrops)
  const cardParent = buildCardParentMap(cards, backdrops)
  const out: string[] = []

  // ── Title page ─────────────────────────────────────────────────────────────
  out.push(`Title: ${name}`)
  if (projectInfo?.credit)    out.push(`Credit: ${projectInfo.credit}`)
  if (projectInfo?.author)    out.push(`Author: ${projectInfo.author}`)
  if (projectInfo?.source)    out.push(`Source: ${projectInfo.source}`)
  out.push(`Draft date: ${new Date().toISOString().slice(0, 10)}`)
  if (projectInfo?.contact) {
    const lines = projectInfo.contact.trim().split('\n')
    out.push(`Contact: ${lines[0]}`)
    for (let i = 1; i < lines.length; i++) out.push(`    ${lines[i]}`)
  }
  if (projectInfo?.copyright) out.push(`Copyright: ${projectInfo.copyright}`)
  out.push('')

  // ── Project context boneyard ───────────────────────────────────────────────
  const roots        = rootCards(cards, cardParent)
  const rootThemes   = rowSort(roots.filter(c => c.type === 'Theme'))
  const rootArcs     = rowSort(roots.filter(c => c.type === 'Arc'))
  const rootThoughts = rowSort(roots.filter(c => c.type === 'Thought'))

  if (rootThemes.length > 0 || rootArcs.length > 0 || rootThoughts.length > 0) {
    const lines: string[] = ['Project context']
    if (rootThemes.length > 0) {
      const items = rootThemes.map(c => {
        const e    = eMap.get(c.entityId)
        const stmt = attr(strAttrs(e?.attributes ?? {}), 'statement')
        const title = e?.title ?? c.title
        return stmt ? `${title} — ${stmt}` : title
      })
      lines.push(`Themes: ${items.join('; ')}`)
    }
    if (rootArcs.length > 0) {
      const items = rootArcs.map(c => {
        const e       = eMap.get(c.entityId)
        const subject = attr(strAttrs(e?.attributes ?? {}), 'subject')
        const axis    = attr(strAttrs(e?.attributes ?? {}), 'axis')
        const title   = e?.title ?? c.title
        if (subject && axis) return `${title} — ${subject}: ${axis}`
        if (subject)         return `${title} — ${subject}`
        return title
      })
      lines.push(`Arcs: ${items.join('; ')}`)
    }
    if (rootThoughts.length > 0) {
      const notes = rootThoughts
        .map(c => (eMap.get(c.entityId)?.noteRaw ?? c.noteRaw)?.trim())
        .filter(Boolean)
      if (notes.length) lines.push(`Notes: ${notes.join('; ')}`)
    }
    out.push('[[')
    for (const l of lines) out.push(l)
    out.push(']]')
    out.push('')
  }

  // ── Shot line formatter ───────────────────────────────────────────────────
  function formatShot(c: Card): string {
    const e       = eMap.get(c.entityId)
    const title   = e?.title ?? c.title
    const framing = attr(strAttrs(e?.attributes ?? {}), 'framing')
    const purpose = attr(strAttrs(e?.attributes ?? {}), 'purpose')
    const prefix  = framing ? framing.toUpperCase() : 'ANGLE ON'
    return purpose
      ? `${prefix}: ${title.toUpperCase()}. ${purpose}`
      : `${prefix}: ${title.toUpperCase()}.`
  }

  // ── Scene sidecar ─────────────────────────────────────────────────────────

  interface SceneAttrs { goal?: string; conflict?: string; outcome?: string }

  /**
   * Emit [[Scene context]] boneyard + shot action lines + two blank writer lines.
   * sceneAttrs are the scene's own structural fields (goal/conflict/outcome).
   * Writer blank lines are always appended, even when there is no sidecar block.
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

    const hasSceneAttrs = !!(sceneAttrs?.goal || sceneAttrs?.conflict || sceneAttrs?.outcome)

    const hasSidecar =
      hasSceneAttrs           ||
      charCards.length     > 0 ||
      beatBackdrops.length > 0 ||
      beatCards.length     > 0 ||
      themeCards.length    > 0 ||
      arcCards.length      > 0 ||
      propCards.length     > 0 ||
      thoughtCards.length  > 0

    if (hasSidecar) {
      out.push('[[')
      out.push('Scene context')

      // Scene structural attributes first — writers see the plan before cast
      if (sceneAttrs?.goal)     out.push(`Goal: ${sceneAttrs.goal}`)
      if (sceneAttrs?.conflict) out.push(`Conflict: ${sceneAttrs.conflict}`)
      if (sceneAttrs?.outcome)  out.push(`Outcome: ${sceneAttrs.outcome}`)

      // Characters
      if (charCards.length > 0) {
        const names = charCards.map(c => (eMap.get(c.entityId)?.title ?? c.title).toUpperCase())
        out.push(`Characters: ${names.join(', ')}`)
      }

      // Beat backdrops nested inside the scene (folded into sidecar)
      for (const bd of beatBackdrops) {
        const desc = attr(bd.attributes, 'description')
        out.push(desc ? `Beat: ${bd.title} — ${desc}` : `Beat: ${bd.title}`)
      }

      // Beat cards inside this scene
      for (const c of beatCards) {
        const e    = eMap.get(c.entityId)
        const desc = attr(strAttrs(e?.attributes ?? {}), 'description') || (e?.noteRaw ?? c.noteRaw)?.trim() || ''
        const title = e?.title ?? c.title
        out.push(desc ? `Beat: ${title} — ${desc}` : `Beat: ${title}`)
      }

      // Themes
      for (const c of themeCards) {
        const e    = eMap.get(c.entityId)
        const stmt = attr(strAttrs(e?.attributes ?? {}), 'statement')
        const title = e?.title ?? c.title
        out.push(stmt ? `Theme: ${title} — ${stmt}` : `Theme: ${title}`)
      }

      // Arcs
      for (const c of arcCards) {
        const e       = eMap.get(c.entityId)
        const subject = attr(strAttrs(e?.attributes ?? {}), 'subject')
        const axis    = attr(strAttrs(e?.attributes ?? {}), 'axis')
        const title   = e?.title ?? c.title
        if (subject && axis) out.push(`Arc: ${title} — ${subject}: ${axis}`)
        else if (subject)    out.push(`Arc: ${title} — ${subject}`)
        else                 out.push(`Arc: ${title}`)
      }

      // Props
      for (const c of propCards) {
        const e    = eMap.get(c.entityId)
        const desc = attr(strAttrs(e?.attributes ?? {}), 'description')
        const title = e?.title ?? c.title
        out.push(desc ? `Prop: ${title} — ${desc}` : `Prop: ${title}`)
      }

      // Thoughts
      const thoughtNotes = thoughtCards
        .map(c => (eMap.get(c.entityId)?.noteRaw ?? c.noteRaw)?.trim())
        .filter(Boolean)
      if (thoughtNotes.length) out.push(`Notes: ${thoughtNotes.join('; ')}`)

      out.push(']]')
      out.push('')
    }

    // Shots emit as uppercase action lines after the boneyard block
    for (const c of shotCards) out.push(formatShot(c))
    if (shotCards.length > 0) out.push('')

    // Writer space — always two blank lines after every scene
    out.push('')
    out.push('')
  }

  // ── Scene backdrop emitter ────────────────────────────────────────────────

  function emitSceneBackdrop(bd: Backdrop) {
    const heading = assembleSceneHeadingFromBackdrop(bd, cards, eMap, cardParent)
    out.push(heading.raw)
    out.push('')

    if (bd.note?.trim()) {
      out.push(`= ${bd.note.trim()}`)
      out.push('')
    }

    const sceneAttrs: SceneAttrs = {
      goal:     attr(bd.attributes, 'goal'),
      conflict: attr(bd.attributes, 'conflict'),
      outcome:  attr(bd.attributes, 'outcome'),
    }

    const contained     = cardsInBackdrop(bd.id, cards, cardParent)
    const beatBackdrops = backdropsInBackdrop(bd.id, backdrops, bdParent).filter(b => b.type === 'Beat')
    emitSceneSidecar(contained, beatBackdrops, sceneAttrs)
  }

  // ── Standalone Scene card emitter ─────────────────────────────────────────

  function emitSceneCard(card: Card) {
    const entity  = eMap.get(card.entityId)
    const heading = assembleSceneHeadingFromCard(card, entity, cards, eMap, cardParent)
    out.push(heading.raw)
    out.push('')

    const note = (entity?.noteRaw ?? card.noteRaw)?.trim()
    if (note) {
      out.push(`= ${note}`)
      out.push('')
    }

    const sceneAttrs: SceneAttrs = {
      goal:     attr(strAttrs(entity?.attributes ?? {}), 'goal'),
      conflict: attr(strAttrs(entity?.attributes ?? {}), 'conflict'),
      outcome:  attr(strAttrs(entity?.attributes ?? {}), 'outcome'),
    }

    // Scene cards have no spatially-contained children; attrs only in sidecar
    emitSceneSidecar([], [], sceneAttrs)
  }

  // ── Act / Sequence structural context helper ───────────────────────────────
  /**
   * Build and emit a [[ label ... ]] boneyard block for Act or Sequence level,
   * combining typed structural attributes with any non-Scene, non-Shot cards
   * directly contained by this backdrop.
   * Returns the Shot cards for the caller to emit as action lines.
   */
  function emitStructuralContext(
    label:       string,
    attrLines:   string[],
    directCards: Card[],
  ): Card[] {
    const charCards    = directCards.filter(c => c.type === 'Character')
    const propCards    = directCards.filter(c => c.type === 'Prop')
    const beatCards    = directCards.filter(c => c.type === 'Beat')
    const themeCards   = directCards.filter(c => c.type === 'Theme')
    const arcCards     = directCards.filter(c => c.type === 'Arc')
    const thoughtCards = directCards.filter(c => c.type === 'Thought')
    const shotCards    = directCards.filter(c => c.type === 'Shot')

    const contextLines = [...attrLines]

    if (charCards.length > 0) {
      const names = charCards.map(c => (eMap.get(c.entityId)?.title ?? c.title).toUpperCase())
      contextLines.push(`Characters: ${names.join(', ')}`)
    }

    for (const c of propCards) {
      const e    = eMap.get(c.entityId)
      const desc = attr(strAttrs(e?.attributes ?? {}), 'description')
      const title = e?.title ?? c.title
      contextLines.push(desc ? `Prop: ${title} — ${desc}` : `Prop: ${title}`)
    }

    for (const c of beatCards) {
      const e    = eMap.get(c.entityId)
      const desc = attr(strAttrs(e?.attributes ?? {}), 'description') || (e?.noteRaw ?? c.noteRaw)?.trim() || ''
      const title = e?.title ?? c.title
      contextLines.push(desc ? `Beat: ${title} — ${desc}` : `Beat: ${title}`)
    }

    for (const c of themeCards) {
      const e    = eMap.get(c.entityId)
      const stmt = attr(strAttrs(e?.attributes ?? {}), 'statement')
      const title = e?.title ?? c.title
      contextLines.push(stmt ? `Theme: ${title} — ${stmt}` : `Theme: ${title}`)
    }

    for (const c of arcCards) {
      const e       = eMap.get(c.entityId)
      const subject = attr(strAttrs(e?.attributes ?? {}), 'subject')
      const axis    = attr(strAttrs(e?.attributes ?? {}), 'axis')
      const title   = e?.title ?? c.title
      if (subject && axis) contextLines.push(`Arc: ${title} — ${subject}: ${axis}`)
      else if (subject)    contextLines.push(`Arc: ${title} — ${subject}`)
      else                 contextLines.push(`Arc: ${title}`)
    }

    const thoughtNotes = thoughtCards
      .map(c => (eMap.get(c.entityId)?.noteRaw ?? c.noteRaw)?.trim())
      .filter(Boolean)
    if (thoughtNotes.length) contextLines.push(`Notes: ${thoughtNotes.join('; ')}`)

    if (contextLines.length > 0) {
      out.push('[[')
      out.push(label)
      for (const l of contextLines) out.push(l)
      out.push(']]')
      out.push('')
    }

    return shotCards
  }

  // ── Recursive structural traversal ────────────────────────────────────────

  function emitBackdrop(bd: Backdrop) {
    switch (bd.type) {

      case 'Act': {
        out.push(`# ${bd.title}`)
        if (bd.note?.trim()) out.push(`= ${bd.note.trim()}`)
        out.push('')

        // Act structural attributes
        const actAttrs: string[] = []
        const fn = attr(bd.attributes, 'function')
        const dq = attr(bd.attributes, 'dramatic_question')
        const sh = attr(bd.attributes, 'shift')
        if (fn) actAttrs.push(`Function: ${fn}`)
        if (dq) actAttrs.push(`Dramatic Question: ${dq}`)
        if (sh) actAttrs.push(`Shift: ${sh}`)

        // Direct-child cards (immediate parent = this Act, not inside a child backdrop)
        const directCards    = cardsInBackdrop(bd.id, cards, cardParent)
        const directNonScene = directCards.filter(c => c.type !== 'Scene')

        // Emit context block (attrs + non-Shot non-Scene cards); get Shot cards back
        const directShots = emitStructuralContext('Act context', actAttrs, directNonScene)

        // Shot cards at Act level (e.g., a shot list before any scenes)
        for (const c of directShots) out.push(formatShot(c))
        if (directShots.length > 0) out.push('')

        // Recurse into child backdrops (Sequences, Scenes, Beats)
        for (const child of backdropsInBackdrop(bd.id, backdrops, bdParent)) {
          emitBackdrop(child)
        }

        // Scene entity cards directly inside this Act (unusual but possible)
        for (const c of directCards.filter(c => c.type === 'Scene')) {
          emitSceneCard(c)
        }
        break
      }

      case 'Sequence': {
        out.push(`## ${bd.title}`)
        if (bd.note?.trim()) out.push(`= ${bd.note.trim()}`)
        out.push('')

        // Sequence structural attributes
        const seqAttrs: string[] = []
        const goal     = attr(bd.attributes, 'goal')
        const conflict = attr(bd.attributes, 'conflict')
        const outcome  = attr(bd.attributes, 'outcome')
        if (goal)     seqAttrs.push(`Goal: ${goal}`)
        if (conflict) seqAttrs.push(`Conflict: ${conflict}`)
        if (outcome)  seqAttrs.push(`Outcome: ${outcome}`)

        const directCards    = cardsInBackdrop(bd.id, cards, cardParent)
        const directNonScene = directCards.filter(c => c.type !== 'Scene')

        const directShots = emitStructuralContext('Sequence context', seqAttrs, directNonScene)

        for (const c of directShots) out.push(formatShot(c))
        if (directShots.length > 0) out.push('')

        for (const child of backdropsInBackdrop(bd.id, backdrops, bdParent)) {
          emitBackdrop(child)
        }

        for (const c of directCards.filter(c => c.type === 'Scene')) {
          emitSceneCard(c)
        }
        break
      }

      case 'Beat': {
        // Structural Beat (not nested inside a Scene backdrop)
        out.push(`### ${bd.title}`)
        if (bd.note?.trim()) out.push(`= ${bd.note.trim()}`)
        out.push('')

        const desc = attr(bd.attributes, 'description')
        if (desc) {
          out.push('[[')
          out.push('Beat context')
          out.push(`Description: ${desc}`)
          out.push(']]')
          out.push('')
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

  // Standalone Scene cards at root level (not inside any backdrop)
  const rootSceneCards = rowSort(rootCards(cards, cardParent).filter(c => c.type === 'Scene'))
  for (const c of rootSceneCards) {
    emitSceneCard(c)
  }

  // ── Loose Notes ───────────────────────────────────────────────────────────
  // Orphan cards not attached to any scene structure. Typically the entity
  // library reference cards (Character, Location, Prop columns outside the
  // Act layout). Emit with full attributes. Deduplicate by entityId.
  const handledAtRoot = new Set(['Scene', 'Theme', 'Arc', 'Thought'])
  const seenEntityIds = new Set<string>()
  const orphans = rowSort(
    rootCards(cards, cardParent).filter(c => !handledAtRoot.has(c.type))
  )

  if (orphans.length > 0) {
    out.push('# Loose Notes')
    out.push('')

    for (const c of orphans) {
      if (seenEntityIds.has(c.entityId)) continue
      seenEntityIds.add(c.entityId)

      const e     = eMap.get(c.entityId)
      const title = e?.title ?? c.title
      const eType = (e?.type ?? c.type) as keyof typeof ATTRIBUTE_SCHEMAS
      const schema = ATTRIBUTE_SCHEMAS[eType] ?? ATTRIBUTE_SCHEMAS[c.type as keyof typeof ATTRIBUTE_SCHEMAS] ?? []
      const note  = (e?.noteRaw ?? c.noteRaw)?.trim()

      const attrParts: string[] = []
      for (const f of schema) {
        if (f.key === 'status') continue
        const v = e?.attributes[f.key]
        if (typeof v === 'string' && v.trim()) {
          attrParts.push(`${f.label}: ${v.trim()}`)
        }
      }

      if (attrParts.length > 0 || note) {
        out.push('[[')
        out.push(`${c.type}: ${title}`)
        if (attrParts.length > 0) out.push(attrParts.join(' · '))
        if (note) out.push(note)
        out.push(']]')
      } else {
        out.push(`[[${c.type}: ${title}]]`)
      }
    }
    out.push('')
  }

  return out.join('\n')
}
