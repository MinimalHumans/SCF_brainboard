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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Safely read a string attribute from an entity or backdrop. */
function attr(
  attributes: Record<string, string | string[]> | Record<string, string> | undefined,
  key: string,
): string {
  if (!attributes) return ''
  const v = attributes[key]
  return typeof v === 'string' ? v.trim() : ''
}

/** Coerce a potentially multi-type record to the string-indexed variant. */
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
  // Fountain title pages use key: value pairs; multi-line values indent 4 spaces.
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
  // Root-level Theme, Arc, and Thought cards don't belong to any scene.
  // We emit them as a boneyard block so writers can see them while writing
  // without the block appearing as readable script content.
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

  // ── Recursive structural traversal ────────────────────────────────────────

  function emitBackdrop(bd: Backdrop) {
    switch (bd.type) {
      case 'Act':
        out.push(`# ${bd.title}`)
        if (bd.note?.trim()) out.push(`= ${bd.note.trim()}`)
        out.push('')
        for (const child of backdropsInBackdrop(bd.id, backdrops, bdParent)) {
          emitBackdrop(child)
        }
        for (const c of cardsInBackdrop(bd.id, cards, cardParent).filter(c => c.type === 'Scene')) {
          emitSceneCard(c)
        }
        break

      case 'Sequence':
        out.push(`## ${bd.title}`)
        if (bd.note?.trim()) out.push(`= ${bd.note.trim()}`)
        out.push('')
        for (const child of backdropsInBackdrop(bd.id, backdrops, bdParent)) {
          emitBackdrop(child)
        }
        for (const c of cardsInBackdrop(bd.id, cards, cardParent).filter(c => c.type === 'Scene')) {
          emitSceneCard(c)
        }
        break

      case 'Beat':
        // Structural Beat (not nested inside a Scene backdrop).
        // Beats inside Scene backdrops are collected as sidecar context instead.
        out.push(`### ${bd.title}`)
        if (bd.note?.trim()) out.push(`= ${bd.note.trim()}`)
        out.push('')
        for (const child of backdropsInBackdrop(bd.id, backdrops, bdParent)) {
          emitBackdrop(child)
        }
        break

      case 'Scene':
        emitSceneBackdrop(bd)
        break

      // 'Custom' is transparent — children are promoted by the parent map.
    }
  }

  function emitSceneBackdrop(bd: Backdrop) {
    const heading = assembleSceneHeadingFromBackdrop(bd, cards, eMap, cardParent)
    out.push(heading.raw)
    out.push('')
    if (bd.note?.trim()) {
      out.push(`= ${bd.note.trim()}`)
      out.push('')
    }

    const contained     = cardsInBackdrop(bd.id, cards, cardParent)
    const beatBackdrops = backdropsInBackdrop(bd.id, backdrops, bdParent).filter(b => b.type === 'Beat')

    emitSceneSidecar(contained, beatBackdrops)
  }

  function emitSceneCard(card: Card) {
    const entity  = eMap.get(card.entityId)
    const heading = assembleSceneHeadingFromCard(card, entity, cards, eMap, cardParent)
    out.push(heading.raw)
    out.push('')

    // Synopsis from the entity note or goal attribute
    const note     = (entity?.noteRaw ?? card.noteRaw)?.trim()
    const goal     = attr(strAttrs(entity?.attributes ?? {}), 'goal')
    const synopsis = note || goal
    if (synopsis) {
      out.push(`= ${synopsis}`)
      out.push('')
    }

    // For a Scene card, contextual data lives in its attributes, not in
    // spatially contained cards. Emit whatever is filled.
    const conflict = attr(strAttrs(entity?.attributes ?? {}), 'conflict')
    const outcome  = attr(strAttrs(entity?.attributes ?? {}), 'outcome')
    const ctxLines: string[] = []
    if (conflict) ctxLines.push(`Conflict: ${conflict}`)
    if (outcome)  ctxLines.push(`Outcome: ${outcome}`)

    if (ctxLines.length > 0) {
      out.push('[[')
      out.push('Scene context')
      for (const l of ctxLines) out.push(l)
      out.push(']]')
      out.push('')
    }

    // Writer space
    out.push('')
    out.push('')
  }

  /**
   * Emit the boneyard context block and shot action lines for a Scene backdrop.
   * Beat backdrops that are children of the scene are folded into the context
   * rather than emitted as structural `###` sections.
   */
  function emitSceneSidecar(contained: Card[], beatBackdrops: Backdrop[]) {
    const charCards    = contained.filter(c => c.type === 'Character')
    const propCards    = contained.filter(c => c.type === 'Prop')
    const themeCards   = contained.filter(c => c.type === 'Theme')
    const arcCards     = contained.filter(c => c.type === 'Arc')
    const thoughtCards = contained.filter(c => c.type === 'Thought')
    const beatCards    = contained.filter(c => c.type === 'Beat')
    const shotCards    = contained.filter(c => c.type === 'Shot')

    const hasSidecar =
      charCards.length    > 0 ||
      beatBackdrops.length > 0 ||
      beatCards.length    > 0 ||
      themeCards.length   > 0 ||
      arcCards.length     > 0 ||
      propCards.length    > 0 ||
      thoughtCards.length > 0

    if (hasSidecar) {
      out.push('[[')
      out.push('Scene context')

      if (charCards.length > 0) {
        const names = charCards.map(c => (eMap.get(c.entityId)?.title ?? c.title).toUpperCase())
        out.push(`Characters: ${names.join(', ')}`)
      }

      // Beat backdrops nested inside this scene
      for (const bd of beatBackdrops) {
        const desc = attr(bd.attributes, 'description')
        out.push(desc ? `Beat: ${bd.title} — ${desc}` : `Beat: ${bd.title}`)
      }

      // Beat entity cards inside this scene
      for (const c of beatCards) {
        const e    = eMap.get(c.entityId)
        const desc = attr(strAttrs(e?.attributes ?? {}), 'description') || (e?.noteRaw ?? c.noteRaw)?.trim() || ''
        const title = e?.title ?? c.title
        out.push(desc ? `Beat: ${title} — ${desc}` : `Beat: ${title}`)
      }

      for (const c of themeCards) {
        const e     = eMap.get(c.entityId)
        const stmt  = attr(strAttrs(e?.attributes ?? {}), 'statement')
        const title = e?.title ?? c.title
        out.push(stmt ? `Theme: ${title} — ${stmt}` : `Theme: ${title}`)
      }

      for (const c of arcCards) {
        const e       = eMap.get(c.entityId)
        const subject = attr(strAttrs(e?.attributes ?? {}), 'subject')
        const axis    = attr(strAttrs(e?.attributes ?? {}), 'axis')
        const title   = e?.title ?? c.title
        if (subject && axis) out.push(`Arc: ${title} — ${subject}: ${axis}`)
        else if (subject)    out.push(`Arc: ${title} — ${subject}`)
        else                 out.push(`Arc: ${title}`)
      }

      for (const c of propCards) {
        const e    = eMap.get(c.entityId)
        const desc = attr(strAttrs(e?.attributes ?? {}), 'description')
        const title = e?.title ?? c.title
        out.push(desc ? `Prop: ${title} — ${desc}` : `Prop: ${title}`)
      }

      const thoughtNotes = thoughtCards
        .map(c => (eMap.get(c.entityId)?.noteRaw ?? c.noteRaw)?.trim())
        .filter(Boolean)
      if (thoughtNotes.length) out.push(`Notes: ${thoughtNotes.join('; ')}`)

      out.push(']]')
      out.push('')
    }

    // Shot cards emit as forced uppercase action lines after the boneyard block.
    // Fountain treats any all-caps line as a potential scene heading unless it
    // starts with a known prefix. Using mixed-case avoids false positives here
    // while keeping the shots obviously readable.
    for (const c of shotCards) {
      const e       = eMap.get(c.entityId)
      const title   = e?.title ?? c.title
      const framing = attr(strAttrs(e?.attributes ?? {}), 'framing')
      const purpose = attr(strAttrs(e?.attributes ?? {}), 'purpose')
      const prefix  = framing ? framing.toUpperCase() : 'ANGLE ON'
      const line    = purpose
        ? `${prefix}: ${title.toUpperCase()}. ${purpose}`
        : `${prefix}: ${title.toUpperCase()}.`
      out.push(line)
    }
    if (shotCards.length > 0) out.push('')

    // Writer space — two blank lines
    out.push('')
    out.push('')
  }

  // ── Root-level traversal ──────────────────────────────────────────────────

  const topBackdrops = rootBackdrops(backdrops, bdParent)
  for (const bd of topBackdrops) {
    emitBackdrop(bd)
  }

  // Standalone Scene cards at root (not inside any backdrop)
  const rootSceneCards = rowSort(rootCards(cards, cardParent).filter(c => c.type === 'Scene'))
  for (const c of rootSceneCards) {
    emitSceneCard(c)
  }

  // ── Loose Notes — orphan cards that didn't fit anywhere else ──────────────
  // CLP cards (Character, Location, Prop) are structural references; they're
  // shown as sidecar context inside scenes. Root ones here have no scene context
  // so we still include them to avoid silent data loss.
  const handledAtRoot = new Set(['Scene'])
  const orphans = rowSort(
    rootCards(cards, cardParent).filter(c => !handledAtRoot.has(c.type)),
  )

  if (orphans.length > 0) {
    out.push('# Loose Notes')
    out.push('')
    for (const c of orphans) {
      const e     = eMap.get(c.entityId)
      const title = e?.title ?? c.title
      const note  = (e?.noteRaw ?? c.noteRaw)?.trim()
      const desc  = attr(strAttrs(e?.attributes ?? {}), 'description')
      const content = note || desc
      out.push(content ? `[[${c.type}: ${title} — ${content}]]` : `[[${c.type}: ${title}]]`)
    }
    out.push('')
  }

  return out.join('\n')
}
