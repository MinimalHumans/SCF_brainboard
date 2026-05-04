import type { Board, Backdrop, Card, Entity } from '@/types/board'
import { ATTRIBUTE_SCHEMAS } from '@/config/attributeSchemas'
import { BACKDROP_SCHEMAS } from '@/config/backdropSchemas'
import {
  CARD_W, CARD_H, ROW_SNAP, RANK,
  fullyInside, innermostParent, rowSort,
} from './screenplayCommon'

// ─── Constants ────────────────────────────────────────────────────────────────

const CONTAINS_ORDER = [
  'Character', 'Location', 'Prop', 'Shot',
  'Arc', 'Theme', 'Beat', 'Scene', 'Thought',
]

const CARD_GROUP_ORDER = ['Arc', 'Theme', 'Beat', 'Scene', 'Shot', 'Thought']

// ─── Markdown primitives ──────────────────────────────────────────────────────

function blockquoteLines(text: string): string[] {
  return text.trim().split('\n').map(l => `> ${l}`)
}

function hashes(depth: number): string {
  return '#'.repeat(Math.min(depth, 6))
}

// ─── Entity content renderer ──────────────────────────────────────────────────

/**
 * Emit non-empty attribute bullets then noteRaw as blockquote.
 * Caller is responsible for the blank line BEFORE this block.
 */
function emitAttrsAndNote(entity: Entity, out: string[]): void {
  const schema = ATTRIBUTE_SCHEMAS[entity.type] ?? []
  for (const f of schema) {
    const v = entity.attributes[f.key]
    if (typeof v === 'string' && v.trim()) {
      out.push(`- **${f.label}:** ${v.trim()}`)
    }
  }
  if (entity.noteRaw?.trim()) {
    out.push('')
    out.push(...blockquoteLines(entity.noteRaw))
  }
  out.push('')
}

// ─── Shot line ────────────────────────────────────────────────────────────────

function shotLine(card: Card, entity: Entity | undefined): string {
  const title  = entity?.title ?? card.title
  const schema = ATTRIBUTE_SCHEMAS['Shot']
  const parts  = schema
    .map(f => [f.label, (entity?.attributes[f.key] as string | undefined)?.trim()] as const)
    .filter(([, v]) => !!v)
    .map(([l, v]) => `*${l}:* ${v}`)
  let line = `- **${title}**`
  if (parts.length) line += ` — ${parts.join(' · ')}`
  if (card.instanceNote?.trim()) line += `  *(${card.instanceNote.trim()})*`
  return line
}

// ─── Contains block ───────────────────────────────────────────────────────────

interface ContainsEntry { type: string; title: string; note: string }

function emitContains(items: ContainsEntry[], out: string[]): void {
  if (!items.length) return
  out.push('**Contains:**')
  const sorted = [...items].sort((a, b) => {
    const oa = CONTAINS_ORDER.indexOf(a.type) + 1 || 999
    const ob = CONTAINS_ORDER.indexOf(b.type) + 1 || 999
    if (oa !== ob) return oa - ob
    return a.title.localeCompare(b.title)
  })
  for (const { type, title, note } of sorted) {
    let line = `- **${title}** *(${type})*`
    if (note?.trim()) line += ` — ${note.trim()}`
    out.push(line)
  }
  out.push('')
}

// ─── Backdrop section ─────────────────────────────────────────────────────────

function renderBackdrop(
  bd:       Backdrop,
  depth:    number,
  n:        number,
  bdKids:   Map<string, Backdrop[]>,
  cardKids: Map<string, Card[]>,
  eMap:     Map<string, Entity>,
  seen:     Set<string>,
  out:      string[],
): void {
  out.push(`${hashes(depth)} ${bd.type} ${n} — ${bd.title}`)
  out.push('')

  if (bd.note?.trim()) {
    out.push(...blockquoteLines(bd.note))
    out.push('')
  }

  const schema = BACKDROP_SCHEMAS[bd.type] ?? []
  let hadAttr  = false
  for (const f of schema) {
    const v = bd.attributes[f.key]
    if (v?.trim()) { out.push(`- **${f.label}:** ${v.trim()}`); hadAttr = true }
  }
  if (hadAttr) out.push('')

  // Child backdrops (recursive)
  rowSort(bdKids.get(bd.id) ?? []).forEach((child, i) =>
    renderBackdrop(child, depth + 1, i + 1, bdKids, cardKids, eMap, seen, out),
  )

  // Cards
  const cards = rowSort(cardKids.get(bd.id) ?? [])
  if (!cards.length) return

  const inline:   Card[]          = []
  const shots:    Card[]          = []
  const contains: ContainsEntry[] = []

  for (const c of cards) {
    const e     = eMap.get(c.entityId)
    const title = e?.title ?? c.title

    if (['Character', 'Location', 'Prop'].includes(c.type)) {
      contains.push({ type: c.type, title, note: c.instanceNote })
    } else if (c.type === 'Shot') {
      if (!seen.has(c.entityId)) { seen.add(c.entityId); shots.push(c) }
      else contains.push({ type: c.type, title, note: c.instanceNote })
    } else {
      if (!seen.has(c.entityId)) { seen.add(c.entityId); inline.push(c) }
      else contains.push({ type: c.type, title, note: c.instanceNote })
    }
  }

  // Full-content inline cards (Arc, Theme, Thought, Beat, Scene)
  for (const c of inline) {
    const e     = eMap.get(c.entityId)
    const title = e?.title ?? c.title
    out.push(`**${title}** *(${c.type})*`)
    out.push('')
    if (e) emitAttrsAndNote(e, out)
    else   out.push('')
    if (c.instanceNote?.trim()) {
      out.push(...blockquoteLines(c.instanceNote))
      out.push('')
    }
  }

  // Shots subsection
  if (shots.length) {
    out.push('**Shots:**')
    out.push('')
    for (const c of shots) out.push(shotLine(c, eMap.get(c.entityId)))
    out.push('')
  }

  emitContains(contains, out)
}

// ─── Root card groups ─────────────────────────────────────────────────────────

function renderCardGroups(
  cards: Card[],
  depth: number,
  eMap:  Map<string, Entity>,
  out:   string[],
): void {
  const h      = hashes(depth)
  const groups = new Map<string, Card[]>()
  for (const c of cards) {
    if (!groups.has(c.type)) groups.set(c.type, [])
    groups.get(c.type)!.push(c)
  }

  for (const type of CARD_GROUP_ORDER) {
    const group = groups.get(type)
    if (!group?.length) continue

    out.push(`${h} ${type}s`)
    out.push('')

    for (const c of rowSort(group)) {
      const e = eMap.get(c.entityId)
      if (c.type === 'Shot') {
        out.push(shotLine(c, e))
        out.push('')
      } else {
        const title = e?.title ?? c.title
        out.push(`**${title}** *(${c.type})*`)
        out.push('')
        if (e) emitAttrsAndNote(e, out)
        else   out.push('')
      }
    }
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildOutline(board: Board): string {
  const { cards, entities, backdrops } = board
  const out: string[] = []

  // Frontmatter
  const nonCustomBds = backdrops.filter(b => b.type !== 'Custom')
  out.push('---')
  out.push(`board: ${board.name}`)
  out.push(`generated: ${new Date().toISOString()}`)
  out.push(`cards: ${cards.length}`)
  out.push(`entities: ${entities.length}`)
  out.push(`backdrops: ${nonCustomBds.length}`)
  out.push('---')
  out.push('')

  out.push(`# ${board.name}`)
  out.push('')

  if (!cards.length && !backdrops.length) {
    out.push('*This board is empty.*')
    out.push('')
    return out.join('\n')
  }

  const eMap = new Map<string, Entity>(entities.map(e => [e.id, e]))

  // ── Assign each non-Custom backdrop to its innermost non-Custom parent ──────
  const bdParent = new Map<string, string | null>()
  for (const bd of nonCustomBds) {
    const p = innermostParent(
      bd.position.x, bd.position.y, bd.size.width, bd.size.height,
      backdrops, bd.id,
    )
    bdParent.set(bd.id, p?.id ?? null)
  }

  // ── Assign each card to its innermost non-Custom parent ─────────────────────
  const cParent = new Map<string, string | null>()
  for (const c of cards) {
    const p = innermostParent(c.position.x, c.position.y, CARD_W, CARD_H, backdrops)
    cParent.set(c.id, p?.id ?? null)
  }

  // ── Build child maps (keyed by parent backdrop id) ───────────────────────────
  const bdKids   = new Map<string, Backdrop[]>()
  const cardKids = new Map<string, Card[]>()

  for (const bd of nonCustomBds) {
    const pid = bdParent.get(bd.id)
    if (pid != null) {
      if (!bdKids.has(pid)) bdKids.set(pid, [])
      bdKids.get(pid)!.push(bd)
    }
  }
  for (const c of cards) {
    const pid = cParent.get(c.id)
    if (pid != null) {
      if (!cardKids.has(pid)) cardKids.set(pid, [])
      cardKids.get(pid)!.push(c)
    }
  }

  // ── Root-level items ─────────────────────────────────────────────────────────
  const rootBds   = nonCustomBds.filter(b => bdParent.get(b.id) === null)
  const rootCards = cards.filter(c => cParent.get(c.id) === null)

  // ── Orphan determination ─────────────────────────────────────────────────────
  const maxRank = nonCustomBds.length
    ? Math.max(...nonCustomBds.map(b => RANK[b.type] ?? 0))
    : 0

  const topBds   = rootBds.filter(b => (RANK[b.type] ?? 0) === maxRank)
  const looseBds = maxRank > 0
    ? rootBds.filter(b => (RANK[b.type] ?? 0) < maxRank)
    : []

  const seen = new Set<string>()

  // ── Top-level backdrop hierarchy ─────────────────────────────────────────────
  rowSort(topBds).forEach((bd, i) =>
    renderBackdrop(bd, 2, i + 1, bdKids, cardKids, eMap, seen, out),
  )

  // ── Loose Backdrops ───────────────────────────────────────────────────────────
  if (looseBds.length) {
    out.push('## Loose Backdrops')
    out.push('')
    rowSort(looseBds).forEach((bd, i) =>
      renderBackdrop(bd, 3, i + 1, bdKids, cardKids, eMap, seen, out),
    )
  }

  // ── Root content cards (non-CLP) ─────────────────────────────────────────────
  const rootContent = rootCards.filter(c => !['Character', 'Location', 'Prop'].includes(c.type))
  if (rootContent.length) {
    if (!nonCustomBds.length) {
      // No structural backdrops — render as top-level sections
      renderCardGroups(rootContent, 2, eMap, out)
    } else {
      out.push('## Orphan Cards')
      out.push('')
      renderCardGroups(rootContent, 3, eMap, out)
    }
  }

  // ── Entity Library ────────────────────────────────────────────────────────────
  const clpCards  = cards.filter(c => ['Character', 'Location', 'Prop'].includes(c.type))
  const libSeen   = new Set<string>()
  const libEntities: Entity[] = []
  for (const c of clpCards) {
    if (!libSeen.has(c.entityId)) {
      libSeen.add(c.entityId)
      const e = eMap.get(c.entityId)
      if (e) libEntities.push(e)
    }
  }

  if (libEntities.length) {
    out.push('# Entity Library')
    out.push('')
    for (const type of ['Character', 'Location', 'Prop'] as const) {
      const group = libEntities
        .filter(e => e.type === type)
        .sort((a, b) => a.title.localeCompare(b.title))
      for (const e of group) {
        out.push(`## ${e.title}`)
        out.push('')
        out.push(`*${e.type}*`)
        out.push('')
        emitAttrsAndNote(e, out)
      }
    }
  }

  return out.join('\n')
}
