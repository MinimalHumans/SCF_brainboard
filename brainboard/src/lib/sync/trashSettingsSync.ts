import { createFile, downloadFile, findFileByName, updateFile } from './googleDriveApi'
import { useTrashStore } from '@/store/trashStore'

/*
 * trashSettingsSync — mirrors the single global trash-retention setting into
 * a tiny file in the Drive app-data folder, so every device a user syncs
 * agrees on how long trashed boards survive. Last-write-wins on the user's
 * own change timestamp (retentionUpdatedAt), not Drive's modifiedTime — a
 * device that merely *mirrored* the value shouldn't beat one where the user
 * actually changed it. A device where the user has never touched the setting
 * (retentionUpdatedAt === null) always defers to whatever Drive has.
 */

const SETTINGS_FILE_NAME = 'trash-settings.json'

interface RemoteTrashSettings {
  schemaVersion: 1
  retentionDays: number
  updatedAt:     string
}

function parseSettings(raw: string): RemoteTrashSettings | null {
  try {
    const parsed = JSON.parse(raw) as RemoteTrashSettings
    if (parsed.schemaVersion === 1 && Number.isFinite(parsed.retentionDays)) return parsed
    return null
  } catch {
    return null
  }
}

export async function reconcileTrashSettings(token: string): Promise<void> {
  const { retentionDays, retentionUpdatedAt, adoptRemoteRetention } = useTrashStore.getState()

  const found = await findFileByName(token, SETTINGS_FILE_NAME)
  if (!found) {
    // Nothing remote yet — only publish if the user has actually customized
    // the setting; there's no point mirroring the untouched default.
    if (retentionUpdatedAt) {
      await createFile(token, JSON.stringify({ schemaVersion: 1, retentionDays, updatedAt: retentionUpdatedAt }), SETTINGS_FILE_NAME)
    }
    return
  }

  const raw = await downloadFile(token, found.fileId)
  const remote = raw ? parseSettings(raw) : null
  if (!remote) {
    // Corrupt/unreadable remote file — overwrite with whatever we have.
    await updateFile(token, found.fileId, JSON.stringify({
      schemaVersion: 1, retentionDays, updatedAt: retentionUpdatedAt ?? new Date().toISOString(),
    }))
    return
  }

  if (!retentionUpdatedAt || remote.updatedAt > retentionUpdatedAt) {
    adoptRemoteRetention(remote.retentionDays, remote.updatedAt)
  } else if (retentionUpdatedAt > remote.updatedAt) {
    await updateFile(token, found.fileId, JSON.stringify({ schemaVersion: 1, retentionDays, updatedAt: retentionUpdatedAt }))
  }
}
