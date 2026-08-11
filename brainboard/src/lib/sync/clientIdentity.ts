import { nanoid } from 'nanoid'

/*
 * clientIdentity — stable per-browser-profile identity used to label which
 * device/browser produced a given board revision. Persisted in localStorage
 * (device-level, not board-level) so it survives board switching/deletion
 * and OPFS being cleared independently of localStorage.
 */

const CLIENT_ID_KEY    = 'brainboard_client_id'
const CLIENT_LABEL_KEY = 'brainboard_client_label'

export function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY)
  if (!id) {
    id = nanoid()
    localStorage.setItem(CLIENT_ID_KEY, id)
  }
  return id
}

function derivePlatform(ua: string): string {
  if (/Windows/.test(ua))        return 'Windows'
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Mac OS X/.test(ua))       return 'Mac'
  if (/Android/.test(ua))        return 'Android'
  if (/Linux/.test(ua))          return 'Linux'
  return 'Unknown'
}

function deriveBrowser(ua: string): string {
  if (/Edg\//.test(ua))     return 'Edge'
  if (/OPR\//.test(ua))     return 'Opera'
  if (/Chrome\//.test(ua))  return 'Chrome'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Safari\//.test(ua))  return 'Safari'
  return 'Browser'
}

function deriveDefaultLabel(): string {
  const ua = navigator.userAgent
  return `${deriveBrowser(ua)} on ${derivePlatform(ua)}`
}

export function getClientLabel(): string {
  let label = localStorage.getItem(CLIENT_LABEL_KEY)
  if (!label) {
    label = deriveDefaultLabel()
    localStorage.setItem(CLIENT_LABEL_KEY, label)
  }
  return label
}

export function setClientLabel(label: string): void {
  localStorage.setItem(CLIENT_LABEL_KEY, label)
}
