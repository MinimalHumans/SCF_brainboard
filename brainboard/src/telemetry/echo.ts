/**
 * The app-wide Echo client, importable from anywhere — React components use
 * the hooks in echo-react.tsx (via <EchoProvider client={echo}>), and
 * non-React code (zustand stores, hooks, utils) imports `echo` directly.
 *
 * Anonymity rules (the server stores exactly what we send):
 *   - never put board names, card titles, notes, or attribute values in
 *     names, tags, or log messages
 *   - counts of things are fine, but bucket them (see sizeBucket) so tag
 *     values stay low-cardinality and can't fingerprint a specific board
 *
 * Disabled outside production builds, so dev sessions never pollute the
 * data. The API key is intentionally shipped in the bundle — it only scopes
 * events to the project, and the server restricts browser use by origin.
 */

import { EchoClient } from './echo-client'
import { IS_TOUCH_PRIMARY } from '@/utils/isTouchPrimary'

export const echo = new EchoClient({
  endpoint:  'https://echo.minimalhumans.com/collect',
  projectId: 'scriptyard-v1',
  apiKey:    '19fbfb42facd635668e944f99315977fd80243f0ef345cf7',
  enabled:   import.meta.env.PROD,
  baseTags: {
    app_version: __APP_VERSION__,
    platform:    IS_TOUCH_PRIMARY ? 'touch' : 'desktop',
  },
})

/** Bucket a count so tag values stay low-cardinality and anonymous. */
export function sizeBucket(n: number): string {
  if (n === 0)   return '0'
  if (n <= 10)   return '1-10'
  if (n <= 50)   return '11-50'
  if (n <= 200)  return '51-200'
  return '200+'
}
