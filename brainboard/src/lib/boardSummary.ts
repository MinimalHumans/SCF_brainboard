import type { Board } from '@/types/board'
import type { BoardSummary } from '@/lib/opfs/opfsStorage'

export function summaryOf(board: Board): BoardSummary {
  return {
    boardId:       board.boardId,
    name:          board.name,
    createdAt:     board.createdAt,
    updatedAt:     board.updatedAt,
    cardCount:     board.cards?.length ?? 0,
    backdropCount: board.backdrops?.length ?? 0,
    kind:          board.kind,
    trashed:       board.trashed,
    trashedAt:     board.trashedAt,
  }
}

// The contents of one of the two parallel trashes (boards' vs templates'),
// newest-trashed first — shared by the Trash view and the footer-link
// counts in the Boards modal.
export function trashedItemsOf(boards: BoardSummary[], kind: 'board' | 'template'): BoardSummary[] {
  return boards
    .filter(b => b.trashed && (kind === 'template' ? b.kind === 'template' : b.kind !== 'template'))
    .sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''))
}
