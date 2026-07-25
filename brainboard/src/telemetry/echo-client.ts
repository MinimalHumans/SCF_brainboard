/**
 * Minimal browser client for the Echo telemetry service.
 *
 * TypeScript port of clients/js/echo-client.js from the Echo repo, plus a
 * `baseTags` option merged into every event (used for app_version/platform).
 *
 * Framework-agnostic ES module, no dependencies. Events are buffered and
 * flushed on an interval; when the tab is hidden or closing, the remaining
 * buffer is flushed with fetch keepalive so it survives page unload.
 * All failures are swallowed — telemetry must never break the app.
 */

export type EchoTags = Record<string, string | number | boolean>

export interface EchoConfig {
  endpoint:       string
  projectId:      string
  apiKey:         string
  /** ms between background flushes */
  flushInterval?: number
  /** events per request (server cap is 500) */
  maxBatch?:      number
  /** drop-oldest beyond this */
  maxBuffer?:     number
  /** set false in dev to disable entirely */
  enabled?:       boolean
  /** merged into every event's tags; event tags win on key collision */
  baseTags?:      EchoTags
  debug?:         boolean
}

interface EchoEvent {
  timestamp:  number
  type:       'counter' | 'duration' | 'log'
  name:       string
  value_num?: number
  value_str?: string
  tags?:      EchoTags
}

export class EchoClient {
  readonly sessionId: string
  private endpoint:  string
  private projectId: string
  private apiKey:    string
  private maxBatch:  number
  private maxBuffer: number
  private enabled:   boolean
  private baseTags:  EchoTags
  private debug:     boolean

  private _buffer:   EchoEvent[] = []
  private _inFlight = false
  private _intervalId?:   ReturnType<typeof setInterval>
  private _onVisibility?: () => void
  private _onPageHide?:   () => void

  constructor({
    endpoint,
    projectId,
    apiKey,
    flushInterval = 10000,
    maxBatch = 200,
    maxBuffer = 2000,
    enabled = true,
    baseTags = {},
    debug = false,
  }: EchoConfig) {
    this.endpoint  = endpoint
    this.projectId = projectId
    this.apiKey    = apiKey
    this.maxBatch  = maxBatch
    this.maxBuffer = maxBuffer
    this.enabled   = enabled
    this.baseTags  = baseTags
    this.debug     = debug

    // New random session per page load; never persisted, nothing identifying.
    this.sessionId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

    if (this.enabled && typeof window !== 'undefined') {
      this._intervalId = setInterval(() => this.flush(), flushInterval)
      // Tab hidden or navigating away: last chance to send.
      this._onVisibility = () => {
        if (document.visibilityState === 'hidden') this.flush({ final: true })
      }
      this._onPageHide = () => this.flush({ final: true })
      document.addEventListener('visibilitychange', this._onVisibility)
      window.addEventListener('pagehide', this._onPageHide)
    }
  }

  // -- public API ----------------------------------------------------

  counter(name: string, value = 1, tags?: EchoTags): void {
    this._enqueue({ type: 'counter', name, value_num: value, tags })
  }

  /** seconds: duration in seconds (float). */
  duration(name: string, seconds: number, tags?: EchoTags): void {
    this._enqueue({ type: 'duration', name, value_num: seconds, tags })
  }

  log(name: string, message: unknown, tags?: EchoTags): void {
    this._enqueue({
      type: 'log',
      name,
      value_str: String(message).slice(0, 8192),
      tags,
    })
  }

  /** Returns a stop() function that records the elapsed duration once. */
  startTimer(name: string, tags?: EchoTags): (extraTags?: EchoTags) => void {
    const start = performance.now()
    let done = false
    return (extraTags?: EchoTags) => {
      if (done) return
      done = true
      const seconds = (performance.now() - start) / 1000
      this.duration(name, seconds, { ...tags, ...extraTags })
    }
  }

  /**
   * Send buffered events. With {final: true}, uses fetch keepalive so the
   * request survives page unload (keepalive bodies are limited to ~64KB,
   * so the final flush sends at most one batch).
   */
  flush({ final = false }: { final?: boolean } = {}): void {
    if (!this.enabled || this._buffer.length === 0) return
    if (this._inFlight && !final) return // interval flush: wait for the previous one

    const events = this._buffer.splice(0, this.maxBatch)
    const body = JSON.stringify({
      project_id: this.projectId,
      session_id: this.sessionId,
      events,
    })

    this._inFlight = true
    fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body,
      keepalive: final,
    })
      .then((res) => {
        if (this.debug) console.debug('echo:', res.status)
      })
      .catch((err) => {
        if (this.debug) console.debug('echo: send failed', err)
      })
      .finally(() => {
        this._inFlight = false
        // More left over (e.g. buffer exceeded maxBatch)? Keep draining.
        if (this._buffer.length > 0 && !final) this.flush()
      })
  }

  /** Stop timers/listeners and flush what's left. */
  destroy(): void {
    if (this._intervalId) clearInterval(this._intervalId)
    if (typeof window !== 'undefined') {
      if (this._onVisibility) document.removeEventListener('visibilitychange', this._onVisibility)
      if (this._onPageHide)   window.removeEventListener('pagehide', this._onPageHide)
    }
    this.flush({ final: true })
  }

  // -- internals -----------------------------------------------------

  private _enqueue({ type, name, value_num, value_str, tags }: Omit<EchoEvent, 'timestamp'>): void {
    if (!this.enabled) return
    const event: EchoEvent = { timestamp: Date.now() / 1000, type, name }
    if (value_num !== undefined) event.value_num = value_num
    if (value_str !== undefined) event.value_str = value_str
    const merged = { ...this.baseTags, ...tags }
    if (Object.keys(merged).length > 0) event.tags = merged
    if (this._buffer.length >= this.maxBuffer) this._buffer.shift()
    this._buffer.push(event)
  }
}
