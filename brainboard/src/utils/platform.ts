/*
 * `__TAURI_INTERNALS__` is injected into the webview by the Tauri runtime
 * unconditionally (unlike `window.__TAURI__`, which requires
 * `app.withGlobalTauri` and isn't set here) — so its presence reliably
 * distinguishes the packaged desktop app from the plain website.
 */
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
