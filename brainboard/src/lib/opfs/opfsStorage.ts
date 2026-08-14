export interface BoardSummary {
  boardId:   string
  name:      string
  createdAt: string
  updatedAt: string
  // Optional because summaries written before these fields existed won't
  // have them on disk — callers should treat a missing value as 0.
  cardCount?:     number
  backdropCount?: number
  // Mirrors Board.kind — absent (or 'board') is a normal board, 'template'
  // is a user-saved template. See types/board.ts.
  kind?: 'board' | 'template'
  // Mirrors Board.trashed/trashedAt so lists and the retention sweep can
  // work off the index alone without opening every board file.
  trashed?:   boolean
  trashedAt?: string
}

const LEGACY_BOARD_FILE_NAME = 'board.json'
const BOARDS_DIR_NAME        = 'boards'
const BOARD_INDEX_FILE_NAME  = 'index.json'

export function isOpfsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

async function getBoardsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await getRoot()
  return root.getDirectoryHandle(BOARDS_DIR_NAME, { create: true })
}

async function readFileFrom(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    const handle = await dir.getFileHandle(name)
    const file = await handle.getFile()
    return await file.text()
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') return null
    throw err
  }
}

async function writeFileTo(dir: FileSystemDirectoryHandle, name: string, contents: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(contents)
  } finally {
    await writable.close()
  }
}

async function readFile(name: string): Promise<string | null> {
  return readFileFrom(await getRoot(), name)
}

async function writeFile(name: string, contents: string): Promise<void> {
  return writeFileTo(await getRoot(), name, contents)
}

/*
 * writeFileVerified — writes then reads the file back and compares it
 * byte-for-byte before trusting the write. Used for one-time migrations,
 * where a silent write failure would mean losing a user's only copy of
 * their board.
 */
async function writeFileVerified(dir: FileSystemDirectoryHandle, name: string, contents: string): Promise<void> {
  await writeFileTo(dir, name, contents)
  const readBack = await readFileFrom(dir, name)
  if (readBack !== contents) {
    throw new Error(`OPFS write verification failed for "${name}": read-back did not match written content`)
  }
}

/* ── Legacy single-board file (pre-multi-board) — migration-only ────────── */

export function readLegacyBoardFile(): Promise<string | null> {
  return readFile(LEGACY_BOARD_FILE_NAME)
}

/* ── Per-board files ──────────────────────────────────────────────────── */

function boardFileName(boardId: string): string {
  return `${boardId}.json`
}

export async function readBoardFileById(boardId: string): Promise<string | null> {
  return readFileFrom(await getBoardsDir(), boardFileName(boardId))
}

export async function writeBoardFileById(boardId: string, json: string): Promise<void> {
  return writeFileTo(await getBoardsDir(), boardFileName(boardId), json)
}

// Used only for the one-time legacy->multi-board migration, where a silent
// write failure would look like the user's board vanished.
export async function writeBoardFileByIdVerified(boardId: string, json: string): Promise<void> {
  return writeFileVerified(await getBoardsDir(), boardFileName(boardId), json)
}

export async function deleteBoardFileById(boardId: string): Promise<void> {
  try {
    await (await getBoardsDir()).removeEntry(boardFileName(boardId))
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') return
    throw err
  }
}

// Repair fallback if index.json is ever missing/stale — scans the boards/
// directory directly for the ids that actually have files on disk.
export async function listBoardFileIds(): Promise<string[]> {
  const dir = await getBoardsDir()
  const ids: string[] = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && name !== BOARD_INDEX_FILE_NAME && name.endsWith('.json')) {
      ids.push(name.slice(0, -'.json'.length))
    }
  }
  return ids
}

/* ── Board index (name/timestamps cache for the Boards modal list) ──────── */

export async function readBoardIndex(): Promise<BoardSummary[] | null> {
  const raw = await readFileFrom(await getBoardsDir(), BOARD_INDEX_FILE_NAME)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as BoardSummary[] : null
  } catch {
    return null
  }
}

export async function writeBoardIndex(summaries: BoardSummary[]): Promise<void> {
  return writeFileTo(await getBoardsDir(), BOARD_INDEX_FILE_NAME, JSON.stringify(summaries))
}

// Verified write used only during the one-time legacy migration.
export async function writeBoardIndexVerified(summaries: BoardSummary[]): Promise<void> {
  return writeFileVerified(await getBoardsDir(), BOARD_INDEX_FILE_NAME, JSON.stringify(summaries))
}

/* ── Sync-state bookkeeping (unrelated to board content) ─────────────────── */

export function readSyncStateFile(): Promise<string | null> {
  return readFile('sync-state.json')
}

export function writeSyncStateFile(json: string): Promise<void> {
  return writeFile('sync-state.json', json)
}

/* ── Trash bookkeeping (retention setting + offline deletion log) ────────── */

export function readTrashStateFile(): Promise<string | null> {
  return readFile('trash-state.json')
}

export function writeTrashStateFile(json: string): Promise<void> {
  return writeFile('trash-state.json', json)
}
