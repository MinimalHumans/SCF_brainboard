const FILES_URL  = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
// Legacy default name from the single-board era — still used as the
// find-or-create name for boards migrated from that era, since Drive files
// are addressed by id, not name, once linked (see driveManifest.ts).
export const LEGACY_BOARD_FILE_NAME = 'board.json'

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` }
}

async function assertOk(res: Response, action: string): Promise<Response> {
  if (!res.ok) {
    throw new Error(`Drive API ${action} failed: ${res.status} ${res.statusText}`)
  }
  return res
}

export async function findFileByName(token: string, name: string): Promise<{ fileId: string; modifiedTime: string } | null> {
  const url = `${FILES_URL}?spaces=appDataFolder&fields=files(id,modifiedTime)&q=${encodeURIComponent(`name='${name}'`)}`
  const res = await assertOk(await fetch(url, { headers: authHeaders(token) }), 'list')
  const data = await res.json() as { files: { id: string; modifiedTime: string }[] }
  const file = data.files[0]
  return file ? { fileId: file.id, modifiedTime: file.modifiedTime } : null
}

export async function listAppDataFiles(token: string): Promise<{ id: string; name: string; modifiedTime: string }[]> {
  const url = `${FILES_URL}?spaces=appDataFolder&pageSize=1000&fields=files(id,name,modifiedTime)`
  const res = await assertOk(await fetch(url, { headers: authHeaders(token) }), 'list')
  const data = await res.json() as { files: { id: string; name: string; modifiedTime: string }[] }
  return data.files
}

export async function downloadFile(token: string, fileId: string): Promise<string | null> {
  const res = await fetch(`${FILES_URL}/${fileId}?alt=media`, { headers: authHeaders(token) })
  if (res.status === 404) return null
  await assertOk(res, 'download')
  return res.text()
}

export async function getFileModifiedTime(token: string, fileId: string): Promise<string | null> {
  const res = await fetch(`${FILES_URL}/${fileId}?fields=modifiedTime`, { headers: authHeaders(token) })
  if (res.status === 404) return null
  await assertOk(res, 'metadata')
  const data = await res.json() as { modifiedTime: string }
  return data.modifiedTime
}

export async function createFile(token: string, content: string, name: string): Promise<{ fileId: string; modifiedTime: string }> {
  const metadata = { name, parents: ['appDataFolder'] }
  const boundary = `-------scriptyard-${crypto.randomUUID()}`
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n${content}\r\n` +
    `--${boundary}--`

  const res = await assertOk(await fetch(`${UPLOAD_URL}?uploadType=multipart&fields=id,modifiedTime`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  }), 'create')
  const data = await res.json() as { id: string; modifiedTime: string }
  return { fileId: data.id, modifiedTime: data.modifiedTime }
}

export async function updateFile(token: string, fileId: string, content: string): Promise<{ modifiedTime: string }> {
  const res = await assertOk(await fetch(`${UPLOAD_URL}/${fileId}?uploadType=media&fields=modifiedTime`, {
    method: 'PATCH',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: content,
  }), 'update')
  const data = await res.json() as { modifiedTime: string }
  return { modifiedTime: data.modifiedTime }
}

export async function deleteFile(token: string, fileId: string): Promise<void> {
  const res = await fetch(`${FILES_URL}/${fileId}`, { method: 'DELETE', headers: authHeaders(token) })
  if (res.status === 404) return
  await assertOk(res, 'delete')
}
