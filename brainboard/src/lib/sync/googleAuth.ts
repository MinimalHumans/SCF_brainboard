const GIS_SRC = 'https://accounts.google.com/gsi/client'
const SCOPE    = 'https://www.googleapis.com/auth/drive.appdata'
// Reacquire a bit before actual expiry so a check-in-flight never races real expiration.
const EXPIRY_SAFETY_MARGIN_MS = 60_000

interface TokenResponse {
  access_token: string
  expires_in:   number
  error?:       string
}

interface TokenClient {
  requestAccessToken(overrideConfig?: { prompt?: string }): void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (resp: TokenResponse) => void
          }): TokenClient
          revoke(token: string, done?: () => void): void
        }
      }
    }
  }
}

let scriptLoadPromise: Promise<void> | null = null

function loadGisScript(): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise
  scriptLoadPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return }
    const script  = document.createElement('script')
    script.src    = GIS_SRC
    script.async  = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Identity Services script'))
    document.head.appendChild(script)
  })
  return scriptLoadPromise
}

const TOKEN_STORAGE_KEY = 'scf-brainboard:drive-token'

interface CachedToken { accessToken: string; expiresAt: number }

// localStorage so it survives closing the tab or restarting the browser,
// not just a reload — still self-limiting since Google caps the access
// token itself at ~1hr regardless of where it's cached, and expiresAt is
// checked on every read so a stale entry is never reused past that.
function readCachedToken(): CachedToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedToken
    if (typeof parsed.accessToken !== 'string' || typeof parsed.expiresAt !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function writeCachedToken(token: CachedToken | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token))
    else localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // Storage unavailable (e.g. private browsing) — falls back to in-memory-only for this call.
  }
}

let cachedToken: CachedToken | null = readCachedToken()

/*
 * requestAccessToken — wraps GIS's callback-based flow in a Promise.
 * prompt:'consent' for the first interactive link (shows the Google
 * account/consent picker); prompt:'' for a silent reacquire once the user
 * has already granted access this browser session.
 */
export async function requestAccessToken(opts: { prompt: 'consent' | '' }): Promise<string> {
  await loadGisScript()
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID is not configured')

  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || 'No access token returned'))
          return
        }
        cachedToken = {
          accessToken: resp.access_token,
          expiresAt: Date.now() + resp.expires_in * 1000,
        }
        writeCachedToken(cachedToken)
        resolve(resp.access_token)
      },
    })
    client.requestAccessToken({ prompt: opts.prompt })
  })
}

/*
 * getValidAccessToken — returns the cached token if it's not near expiry,
 * otherwise silently reacquires. Cached in sessionStorage (survives a page
 * reload, cleared when the tab/browser closes) so a reload doesn't force a
 * fresh Google auth popup every time.
 */
export async function getValidAccessToken(): Promise<string> {
  if (!cachedToken) cachedToken = readCachedToken()
  if (cachedToken && cachedToken.expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now()) {
    return cachedToken.accessToken
  }
  return requestAccessToken({ prompt: '' })
}

export function hasCachedToken(): boolean {
  if (!cachedToken) cachedToken = readCachedToken()
  return cachedToken !== null && cachedToken.expiresAt > Date.now()
}

export function clearCachedToken(): void {
  cachedToken = null
  writeCachedToken(null)
}

export async function revokeToken(): Promise<void> {
  await loadGisScript()
  const token = cachedToken?.accessToken
  clearCachedToken()
  if (!token) return
  await new Promise<void>((resolve) => {
    window.google!.accounts.oauth2.revoke(token, () => resolve())
  })
}
