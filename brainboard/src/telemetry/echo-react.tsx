/**
 * React bindings for the Echo telemetry client.
 *
 * TypeScript port of clients/js/echo-react.jsx from the Echo repo, with one
 * addition: <EchoProvider> accepts an existing `client` instance so the same
 * client can be shared with non-React code (zustand stores, hooks). A client
 * passed in is owned by the caller and is NOT destroyed on unmount; a client
 * built from `config` is owned by the provider and destroyed on teardown.
 */

/* eslint-disable react-refresh/only-export-components --
 * vendor-style module: provider + hooks share one file by design, and
 * telemetry is disabled in dev so HMR staleness here is a non-issue. */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { EchoClient } from './echo-client'
import type { EchoConfig, EchoTags } from './echo-client'

const EchoContext = createContext<EchoClient | null>(null)

interface EchoProviderProps {
  client?:  EchoClient
  config?:  EchoConfig
  children: React.ReactNode
}

export function EchoProvider({ client, config, children }: EchoProviderProps) {
  // Lazy state initializer: the client is created exactly once per provider
  // lifetime, even across re-renders.
  const [owned] = useState(() => {
    if (client) return { client, destroyOnUnmount: false }
    if (config) return { client: new EchoClient(config), destroyOnUnmount: true }
    throw new Error('EchoProvider needs a client or a config')
  })
  useEffect(() => {
    return () => { if (owned.destroyOnUnmount) owned.client.destroy() }
  }, [owned])
  return (
    <EchoContext.Provider value={owned.client}>
      {children}
    </EchoContext.Provider>
  )
}

/** The EchoClient instance: useEcho().counter("button_click", 1, {...}) */
export function useEcho(): EchoClient {
  const client = useContext(EchoContext)
  if (!client) throw new Error('useEcho must be used inside <EchoProvider>')
  return client
}

/**
 * Records how long a component was mounted, as a duration event.
 * Drop into any screen, modal, or menu you care about:
 *
 *   function SettingsMenu() {
 *     useScreenTime('settings_menu')
 *     ...
 *   }
 */
export function useScreenTime(name: string, tags?: EchoTags): void {
  const echo = useEcho()
  const tagsRef = useRef(tags)
  // Track the latest tags without re-timing on tag identity changes.
  useEffect(() => { tagsRef.current = tags })
  useEffect(() => {
    const stop = echo.startTimer(name)
    return () => stop(tagsRef.current)
  }, [echo, name])
}

/**
 * Counts a view once per mount (e.g. modal/menu opens):
 *
 *   useViewCount('menu_open', { menu: 'tab' })
 */
export function useViewCount(name: string, tags?: EchoTags): void {
  const echo = useEcho()
  const tagsRef = useRef(tags)
  useEffect(() => { tagsRef.current = tags })
  useEffect(() => {
    echo.counter(name, 1, tagsRef.current)
  }, [echo, name])
}

/**
 * Reports uncaught errors and unhandled promise rejections as log events.
 * Mount once, anywhere inside the provider: <EchoErrorReporter />
 */
export function EchoErrorReporter() {
  const echo = useEcho()
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      echo.log('uncaught_error', e.message ?? String(e), {
        severity: 'error',
        source: 'window.onerror',
      })
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      echo.log('unhandled_rejection', String(e.reason ?? 'unknown'), {
        severity: 'error',
        source: 'unhandledrejection',
      })
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [echo])
  return null
}
