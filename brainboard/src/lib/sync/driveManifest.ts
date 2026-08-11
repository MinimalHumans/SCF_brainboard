import { createFile, downloadFile, findFileByName, listAppDataFiles, updateFile } from './googleDriveApi'

/*
 * driveManifest — a small discovery index in the app-data folder so a
 * second device can find boards it doesn't have locally yet (board ids are
 * random per-device, so without this a fresh browser has no way to learn a
 * cloud board exists).
 *
 * Deliberately per-client, not one shared file: each client owns exactly
 * one file it is ever the writer for (`library-manifest-{clientId}.json`),
 * so two devices pushing near-simultaneously can never read-modify-write
 * over each other's entries. Discovery merges every client's manifest.
 * Content always comes from a fresh fetch of the board's own file — the
 * manifest is a pointer, never a source of truth for board content.
 */

export interface DriveManifestEntry {
  boardId:    string
  name:       string
  fileId:     string
  updatedAt:  string
  version:    number | null
}

export interface DriveManifest {
  schemaVersion: 1
  clientId:      string
  clientLabel:   string
  boards:        DriveManifestEntry[]
}

const MANIFEST_PREFIX = 'library-manifest-'
const MANIFEST_SUFFIX = '.json'

function manifestFileName(clientId: string): string {
  return `${MANIFEST_PREFIX}${clientId}${MANIFEST_SUFFIX}`
}

function parseManifest(raw: string): DriveManifest | null {
  try {
    const parsed = JSON.parse(raw) as DriveManifest
    if (parsed.schemaVersion === 1 && Array.isArray(parsed.boards)) return parsed
    return null
  } catch {
    return null
  }
}

export async function readOwnManifest(token: string, clientId: string): Promise<DriveManifest | null> {
  const found = await findFileByName(token, manifestFileName(clientId))
  if (!found) return null
  const raw = await downloadFile(token, found.fileId)
  return raw ? parseManifest(raw) : null
}

// Only this client ever writes its own manifest file, so this is never a
// cross-client race — worst case is losing a write against itself, which
// the next push repairs.
export async function writeOwnManifest(token: string, clientId: string, manifest: DriveManifest): Promise<void> {
  const name = manifestFileName(clientId)
  const content = JSON.stringify(manifest)
  const existing = await findFileByName(token, name)
  if (existing) {
    await updateFile(token, existing.fileId, content)
  } else {
    await createFile(token, content, name)
  }
}

// Read-modify-write against this client's own manifest — upserts one board
// entry, creating the manifest if this is the first board this client has
// ever pushed.
export async function upsertOwnManifestEntry(
  token: string, clientId: string, clientLabel: string, entry: DriveManifestEntry,
): Promise<void> {
  const existing = await readOwnManifest(token, clientId)
  const boards = existing
    ? [...existing.boards.filter(b => b.boardId !== entry.boardId), entry]
    : [entry]
  await writeOwnManifest(token, clientId, { schemaVersion: 1, clientId, clientLabel, boards })
}

export async function removeOwnManifestEntry(token: string, clientId: string, clientLabel: string, boardId: string): Promise<void> {
  const existing = await readOwnManifest(token, clientId)
  if (!existing) return
  const boards = existing.boards.filter(b => b.boardId !== boardId)
  await writeOwnManifest(token, clientId, { schemaVersion: 1, clientId, clientLabel, boards })
}

// Lists every app-data file matching the manifest name pattern and
// downloads+parses each — used for cross-device discovery.
export async function fetchAllManifests(token: string): Promise<DriveManifest[]> {
  const files = (await listAppDataFiles(token))
    .filter(f => f.name.startsWith(MANIFEST_PREFIX) && f.name.endsWith(MANIFEST_SUFFIX))
  const manifests = await Promise.all(files.map(async f => {
    const raw = await downloadFile(token, f.id)
    return raw ? parseManifest(raw) : null
  }))
  return manifests.filter((m): m is DriveManifest => m !== null)
}

// Merges every client's manifest into one boardId -> entry map, preferring
// the higher version / newer updatedAt when clients disagree (display hint
// only — the actual fetch always targets the entry's fileId directly).
export function mergeManifests(manifests: DriveManifest[]): Map<string, DriveManifestEntry> {
  const merged = new Map<string, DriveManifestEntry>()
  for (const manifest of manifests) {
    for (const entry of manifest.boards) {
      const existing = merged.get(entry.boardId)
      if (!existing) { merged.set(entry.boardId, entry); continue }
      const existingVersion = existing.version ?? -1
      const entryVersion    = entry.version ?? -1
      if (entryVersion > existingVersion ||
          (entryVersion === existingVersion && entry.updatedAt > existing.updatedAt)) {
        merged.set(entry.boardId, entry)
      }
    }
  }
  return merged
}
