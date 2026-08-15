const GIS_SRC = 'https://accounts.google.com/gsi/client'
const SCOPE    = 'https://www.googleapis.com/auth/drive.appdata'
// Reacquire a bit before actual expiry so a check-in-flight never races real expiration.
const EXPIRY_SAFETY_MARGIN_MS = 60_000
// Broker calls must fail fast — a hung/unreachable auth server should never
// stall the UI longer than this before we fall back to the no-broker path.
const BROKER_TIMEOUT_MS = 5_000

interface TokenResponse {
  access_token: string
  expires_in:   number
  error?:       string
}

interface CodeResponse {
  code?:              string
  error?:             string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(overrideConfig?: { prompt?: string }): void
}

interface CodeClient {
  requestCode(): void
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
            // Routes the silent (prompt:'') reacquire through the browser's
            // native FedCM API instead of GIS's third-party-cookie-dependent
            // popup. Without this, browsers that block 3P cookies (default in
            // current Chrome/Safari) can't complete the silent refresh
            // invisibly and fall back to a popup that still needs a click on
            // the account — even though no fresh consent is actually needed.
            use_fedcm_for_prompt?: boolean
          }): TokenClient
          initCodeClient(config: {
            client_id: string
            scope: string
            ux_mode: 'popup'
            callback: (resp: CodeResponse) => void
          }): CodeClient
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

interface CachedToken {
  accessToken: string
  expiresAt: number
  // Present only when the broker was reachable at link time. Opaque to us —
  // decryptable only by the broker's server-side key — and kept even when a
  // broker call later fails for availability reasons, since the blob itself
  // may still be good once the broker comes back.
  encryptedRefreshToken?: string
}

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

/* ── Broker (optional) ───────────────────────────────────────────────────
 *
 * The broker (php/auth) turns the one-time authorization code into a
 * refresh token and hands back only an access token + an encrypted refresh
 * token blob the client can't read. It's entirely optional infrastructure:
 * every function below still works with VITE_AUTH_BROKER_URL unset, falling
 * straight back to the plain implicit-token flow (see requestAccessToken).
 *
 * Two failure shapes matter and are handled differently:
 *   - BrokerUnavailableError: couldn't reach the broker, or it 5xx'd, or it
 *     isn't configured — say nothing about whether the refresh token is
 *     still good. Callers fall back to the implicit flow WITHOUT discarding
 *     the stored encrypted refresh token blob.
 *   - BrokerAuthError: the broker answered but rejected the request (bad
 *     code, dead/undecryptable refresh token). Callers discard whatever
 *     they sent and fall back to the implicit flow.
 */

class BrokerUnavailableError extends Error {}
class BrokerAuthError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message || code)
    this.code = code
  }
}

async function brokerFetch(action: 'exchange' | 'refresh', params: Record<string, string>): Promise<Record<string, unknown>> {
  const brokerUrl = import.meta.env.VITE_AUTH_BROKER_URL
  if (!brokerUrl) throw new BrokerUnavailableError('Auth broker is not configured')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BROKER_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(brokerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action, ...params }),
      signal: controller.signal,
    })
  } catch (err) {
    throw new BrokerUnavailableError(err instanceof Error ? err.message : 'Broker request failed')
  } finally {
    clearTimeout(timer)
  }

  // 5xx = broker/server trouble, not a verdict on the request — treat like unreachable.
  if (res.status >= 500) throw new BrokerUnavailableError(`Broker returned HTTP ${res.status}`)

  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new BrokerUnavailableError('Broker returned a non-JSON response')
  }
  const parsed = (body ?? {}) as Record<string, unknown>

  if (!res.ok) {
    const code = typeof parsed.error === 'string' ? parsed.error : 'broker_error'
    throw new BrokerAuthError(code, typeof parsed.error_description === 'string' ? parsed.error_description : '')
  }
  return parsed
}

function cacheFromBrokerResult(result: Record<string, unknown>, fallbackRefreshBlob?: string): string {
  const accessToken = result.access_token
  const expiresIn = result.expires_in
  if (typeof accessToken !== 'string' || typeof expiresIn !== 'number') {
    throw new BrokerAuthError('malformed_response', 'Broker response was missing access_token/expires_in')
  }
  const encryptedRefreshToken = typeof result.encrypted_refresh_token === 'string'
    ? result.encrypted_refresh_token
    : fallbackRefreshBlob
  cachedToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
    ...(encryptedRefreshToken ? { encryptedRefreshToken } : {}),
  }
  writeCachedToken(cachedToken)
  return accessToken
}

/*
 * requestAuthorizationCode — the GIS "code client" popup flow. Unlike the
 * token client, Google returns a one-time authorization code instead of an
 * access token; only a server holding the client secret (the broker) can
 * redeem it, and doing so is what yields a refresh token.
 */
function requestAuthorizationCode(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: SCOPE,
      ux_mode: 'popup',
      callback: (resp) => {
        if (resp.error || !resp.code) {
          reject(new Error(resp.error_description || resp.error || 'No authorization code returned'))
          return
        }
        resolve(resp.code)
      },
    })
    client.requestCode()
  })
}

/*
 * linkAccountViaBroker — Flow 1 (initial authorization). Interactive: shows
 * Google's account/consent popup. Throws BrokerUnavailableError /
 * BrokerAuthError on any broker-side problem; callers are expected to fall
 * back to requestAccessTokenImplicit({ prompt: 'consent' }) in that case,
 * which still links the account, just without a refresh token.
 */
async function linkAccountViaBroker(clientId: string): Promise<string> {
  const code = await requestAuthorizationCode(clientId)
  const result = await brokerFetch('exchange', { code })
  return cacheFromBrokerResult(result)
}

/*
 * renewViaBroker — Flow 2 (silent renewal). No user interaction: exchanges
 * the locally-stored encrypted refresh token for a fresh access token.
 */
async function renewViaBroker(encryptedRefreshToken: string): Promise<string> {
  const result = await brokerFetch('refresh', { encrypted_refresh_token: encryptedRefreshToken })
  return cacheFromBrokerResult(result, encryptedRefreshToken)
}

/* ── Implicit flow (no broker required) ──────────────────────────────────
 * The original mechanism, kept as-is: GIS hands back an access token
 * directly, no refresh token, silent renewal via FedCM. This is both the
 * whole story when no broker is configured, and the failover path when one
 * is configured but unreachable.
 */

/*
 * requestAccessTokenImplicit — wraps GIS's callback-based flow in a Promise.
 * prompt:'consent' for an interactive link/re-link (shows the Google
 * account/consent picker); prompt:'' for a silent reacquire once the user
 * has already granted access this browser session.
 */
async function requestAccessTokenImplicit(clientId: string, opts: { prompt: 'consent' | '' }): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      use_fedcm_for_prompt: true,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || 'No access token returned'))
          return
        }
        // Plain implicit renewal never carries a refresh token, but if we
        // already have an (unrelated) encrypted blob on file from a prior
        // broker-backed link, keep it — this call doesn't invalidate it.
        cachedToken = {
          accessToken: resp.access_token,
          expiresAt: Date.now() + resp.expires_in * 1000,
          ...(cachedToken?.encryptedRefreshToken ? { encryptedRefreshToken: cachedToken.encryptedRefreshToken } : {}),
        }
        writeCachedToken(cachedToken)
        resolve(resp.access_token)
      },
    })
    client.requestAccessToken({ prompt: opts.prompt })
  })
}

function requiredClientId(): string {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID is not configured')
  return clientId
}

/*
 * requestAccessToken — public entry point used throughout the sync layer.
 *
 *   prompt: 'consent'  Interactive link. Tries the broker-backed
 *                       authorization-code flow first (so future renewals
 *                       can be silent even across FedCM/3P-cookie
 *                       restrictions); if the broker is unconfigured,
 *                       unreachable, or errors, falls back to the plain
 *                       implicit consent popup so linking still succeeds.
 *   prompt: ''          Silent reacquire. Only ever used directly as a
 *                       fallback from getValidAccessToken below, or by a
 *                       caller that already knows no broker renewal path
 *                       exists for this session.
 */
export async function requestAccessToken(opts: { prompt: 'consent' | '' }): Promise<string> {
  await loadGisScript()
  const clientId = requiredClientId()

  if (opts.prompt === 'consent') {
    try {
      return await linkAccountViaBroker(clientId)
    } catch (err) {
      if (err instanceof BrokerUnavailableError || err instanceof BrokerAuthError) {
        console.warn('Auth broker unavailable for interactive link, falling back to implicit flow.', err)
        return await requestAccessTokenImplicit(clientId, opts)
      }
      throw err
    }
  }

  return requestAccessTokenImplicit(clientId, opts)
}

/*
 * getValidAccessToken — returns the cached token if it's not near expiry.
 * Otherwise renews silently, preferring the broker (if we hold an encrypted
 * refresh token) and always falling back to the implicit FedCM reacquire —
 * so a down broker degrades to today's behavior rather than breaking sync.
 */
export async function getValidAccessToken(): Promise<string> {
  if (!cachedToken) cachedToken = readCachedToken()
  if (cachedToken && cachedToken.expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now()) {
    return cachedToken.accessToken
  }

  const refreshBlob = cachedToken?.encryptedRefreshToken
  if (refreshBlob) {
    try {
      await loadGisScript() // not needed for the broker call itself, but keeps GIS warm for a possible fallback below
      return await renewViaBroker(refreshBlob)
    } catch (err) {
      if (err instanceof BrokerAuthError) {
        // Refresh token is confirmed dead (revoked / undecryptable) — drop it,
        // an implicit silent reacquire is our only remaining shot.
        console.warn('Stored refresh token rejected by broker, discarding it.', err)
        clearCachedToken()
      } else if (err instanceof BrokerUnavailableError) {
        console.warn('Auth broker unreachable for silent renewal, falling back to implicit reacquire.', err)
      } else {
        throw err
      }
    }
  }

  const clientId = requiredClientId()
  await loadGisScript()
  return requestAccessTokenImplicit(clientId, { prompt: '' })
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
    // Revoking any token tied to a grant revokes the whole grant on Google's
    // side, so this also kills the refresh token the broker may be holding
    // an encrypted copy of — no separate broker call needed (it's stateless
    // and never had the plaintext token to begin with).
    window.google!.accounts.oauth2.revoke(token, () => resolve())
  })
}
