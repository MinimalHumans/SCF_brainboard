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
  }
}
