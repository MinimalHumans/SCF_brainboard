import { clearCachedToken, getValidAccessToken, hasCachedToken, requestAccessToken, revokeToken } from './googleAuth'
import { createFile, downloadFile, getFileModifiedTime, updateFile } from './googleDriveApi'
import type { SyncProvider } from './types'

export const googleDriveProvider: SyncProvider = {
  id: 'google-drive',

  isLinked() {
    return hasCachedToken()
  },

  async link() {
    await requestAccessToken({ prompt: 'consent' })
  },

  async unlink() {
    await revokeToken()
    clearCachedToken()
  },

  async fetchRemote(fileId) {
    const token   = await getValidAccessToken()
    const content = await downloadFile(token, fileId)
    if (content === null) return null
    const modifiedTime = await getFileModifiedTime(token, fileId)
    if (modifiedTime === null) return null
    return { content, modifiedTime }
  },

  async createRemote(content, name) {
    const token = await getValidAccessToken()
    return createFile(token, content, name)
  },

  async updateRemote(fileId, content) {
    const token = await getValidAccessToken()
    return updateFile(token, fileId, content)
  },

  async getRemoteModifiedTime(fileId) {
    const token = await getValidAccessToken()
    return getFileModifiedTime(token, fileId)
  },
}
