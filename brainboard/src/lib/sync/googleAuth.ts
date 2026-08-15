import { toast } from '@/store/toastStore'

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const SCOPE    = 'https://www.googleapis.com/auth/drive.appdata'
// Reacquire a bit before actual expiry so a check-in-flight never races real expiration.
const EXPIRY_SAFETY_MARGIN_MS = 60_000
// Broker calls must fail fast — a hung/unreachable auth server should never
// stall the UI longer than this before we fall back to the no-broker path.
const BROKER_TIMEOUT_MS = 5_000
// Shorter budget for the pre-link health precheck — it gates whether we
// bother showing the broker's popup at all, so it must resolve well before
// a user would notice a delay in clicking "Connect".
const BROKER_HEALTH_TIMEOUT_MS = 2_000

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

/*
 * brokerHealthy — best-effort GET ?action=health precheck, used only before
 * the INTERACTIVE link flow. Its one job is to keep the common failure mode
 * (broker unconfigured/unreachable) from being discovered only after the
 * user has already clicked through one Google consent popup and is then hit
 * with a second, unexplained one for the implicit-flow fallback. A cheap GET
 * with no popup attached can run first and route straight to the implicit
 * flow instead. Doesn't eliminate the double popup entirely — the broker can
 * still fail between this check and the real exchange — just the common case.
 */
async function brokerHealthy(brokerUrl: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BROKER_HEALTH_TIMEOUT_MS)
  try {
    const res = await fetch(`${brokerUrl}?action=health`, { method: 'GET', signal: controller.signal })
    if (!res.ok) return false
    const body = (await res.json()) as { config?: unknown }
    return body.config === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function brokerFetch(action: 'exchange' | 'refresh', params: Record<string, string>): Promise<Record<string, unknown>> {
  const brokerUrl = import.meta.env.VITE_AUTH_BROKER_URL
  if (!brokerUrl) throw new BrokerUnavailableError('Auth broker is not configured')

  // Keeps the abort armed across both the fetch() call and the res.json()
  // body read — clearing it as soon as fetch() resolves (headers received)
  // would leave a stalled-body response with no timeout at all.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), BROKER_TIMEOUT_MS)
  try {
    const res = await fetch(brokerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action, ...params }),
      signal: controller.signal,
    })

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
  } catch (err) {
    if (err instanceof BrokerUnavailableError || err instanceof BrokerAuthError) throw err
    throw new BrokerUnavailableError(err instanceof Error ? err.message : 'Broker request failed')
  } finally {
    clearTimeout(timer)
  }
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
 *   prompt: 'consent'  Interactive link. Precedes the broker's own popup
 *                       with a cheap health check so an unconfigured/
 *                       unreachable broker (the common case, e.g. before the
 *                       one-time server-side config exists) is routed
 *                       straight to the plain implicit consent popup —
 *                       just one popup, not two. If the health check passes
 *                       but the broker still fails during the real exchange
 *                       (rarer — e.g. it goes down in that exact window),
 *                       falls back to the implicit popup same as before,
 *                       with a toast since the user already saw one popup.
 *   prompt: ''          Silent reacquire. Only ever used directly as a
 *                       fallback from getValidAccessToken below, or by a
 *                       caller that already knows no broker renewal path
 *                       exists for this session.
 */
export async function requestAccessToken(opts: { prompt: 'consent' | '' }): Promise<string> {
  await loadGisScript()
  const clientId = requiredClientId()

  if (opts.prompt === 'consent') {
    const brokerUrl = import.meta.env.VITE_AUTH_BROKER_URL
    if (!brokerUrl || !(await brokerHealthy(brokerUrl))) {
      if (brokerUrl) console.warn('Auth broker failed health check, using the plain implicit consent flow.')
      return await requestAccessTokenImplicit(clientId, opts)
    }

    try {
      return await linkAccountViaBroker(clientId)
    } catch (err) {
      if (err instanceof BrokerUnavailableError || err instanceof BrokerAuthError) {
        console.warn('Auth broker unavailable for interactive link, falling back to implicit flow.', err)
        // The user already completed one Google popup (requestAuthorizationCode)
        // by the time we get here — the implicit-flow fallback below shows a
        // second one. Without this, that second prompt looks like a glitch.
        toast.info('Reconnecting to Google — you may see a second sign-in prompt.')
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

/* ── Opportunistic broker upgrade ────────────────────────────────────────
 * A session that fell back to the implicit flow (broker was down/unconfigured
 * at link time) has no refresh token and stays that way forever unless the
 * user happens to go through an interactive re-link. This lets the app try
 * for a refresh token without asking the user to reconnect: a cheap health
 * check can run anytime (e.g. on page load), but the actual exchange needs
 * requestCode()'s popup, which browsers only allow inside a real user
 * gesture — so it has to ride one the app already has (e.g. the click that
 * opens the Boards modal), not fire on its own from a timer or effect.
 */

let brokerHealthCache: boolean | null = null
let upgradeAttempted = false

export function isImplicitOnly(): boolean {
  if (!cachedToken) cachedToken = readCachedToken()
  return cachedToken !== null && cachedToken.expiresAt > Date.now() && !cachedToken.encryptedRefreshToken
}

// No user gesture involved — safe to call from an effect on mount/reconnect.
export async function precheckBrokerHealth(): Promise<void> {
  const brokerUrl = import.meta.env.VITE_AUTH_BROKER_URL
  brokerHealthCache = brokerUrl ? await brokerHealthy(brokerUrl) : false
}

/*
 * attemptBrokerUpgrade — MUST be called synchronously from within a user
 * gesture handler (e.g. a button onClick), with nothing awaited beforehand
 * that could consume the gesture. Silently no-ops unless we're actually
 * stuck on implicit-only auth with a broker that just passed its health
 * check, and only ever tries once per page load (repeated failures would
 * otherwise mean a popup flash on every single click of the trigger).
 */
export function attemptBrokerUpgrade(): void {
  if (upgradeAttempted) return
  if (!isImplicitOnly() || brokerHealthCache !== true) return
  if (!window.google?.accounts?.oauth2) return // GIS not loaded yet — try again on a later trigger
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) return
  upgradeAttempted = true
  linkAccountViaBroker(clientId)
    .then(() => console.info('Upgraded Google Drive connection to the auth broker.'))
    .catch(err => console.warn('Opportunistic broker upgrade failed, staying on implicit auth.', err))
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
