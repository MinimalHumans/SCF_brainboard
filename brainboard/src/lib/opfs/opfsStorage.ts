const BOARD_FILE_NAME = 'board.json'

export function isOpfsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

async function readFile(name: string): Promise<string | null> {
  try {
    const root = await getRoot()
    const handle = await root.getFileHandle(name)
    const file = await handle.getFile()
    return await file.text()
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') return null
    throw err
  }
}

async function writeFile(name: string, contents: string): Promise<void> {
  const root = await getRoot()
  const handle = await root.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(contents)
  } finally {
    await writable.close()
  }
}

export function readBoardFile(): Promise<string | null> {
  return readFile(BOARD_FILE_NAME)
}

export function writeBoardFile(json: string): Promise<void> {
  return writeFile(BOARD_FILE_NAME, json)
}

/*
 * writeBoardFileVerified — writes then reads the file back and compares it
 * byte-for-byte before trusting the write. Used for the localStorage->OPFS
 * migration, where a silent write failure would mean losing a user's only
 * copy of their board.
 */
export async function writeBoardFileVerified(json: string): Promise<void> {
  await writeFile(BOARD_FILE_NAME, json)
  const readBack = await readFile(BOARD_FILE_NAME)
  if (readBack !== json) {
    throw new Error('OPFS write verification failed: read-back did not match written content')
  }
}

export function readSyncStateFile(): Promise<string | null> {
  return readFile('sync-state.json')
}

export function writeSyncStateFile(json: string): Promise<void> {
  return writeFile('sync-state.json', json)
}
