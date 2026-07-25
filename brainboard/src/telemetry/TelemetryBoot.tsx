/**
 * One-shot session telemetry, mounted once inside <EchoProvider>.
 *
 *   page_load  (duration) — module-eval start to app mount, i.e. time-to-app
 *   heartbeat  (counter)  — one tick per minute while the tab is visible,
 *                           so active-time can be told apart from wall-time
 *
 * Board-size stats at load live in usePersistence, which owns the restore.
 */

import { useEffect } from 'react'
import { echo } from './echo'
import { useThemeStore } from '@/store/themeStore'

const HEARTBEAT_MS = 60_000

export function TelemetryBoot() {
  useEffect(() => {
    echo.duration('page_load', performance.now() / 1000, {
      theme: useThemeStore.getState().theme,
    })
    const beat = setInterval(() => {
      if (document.visibilityState === 'visible') echo.counter('heartbeat')
    }, HEARTBEAT_MS)
    return () => clearInterval(beat)
  }, [])
  return null
}
