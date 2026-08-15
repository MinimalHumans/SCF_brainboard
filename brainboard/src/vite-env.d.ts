/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Git tag for a prod build (e.g. "v0.2.7"), or "dev" for a main-branch build. Unset locally. */
  readonly VITE_APP_VERSION?: string
  /** Full commit SHA the build was made from. Unset locally. */
  readonly VITE_BUILD_SHA?: string
  /** Google OAuth client ID used for the Drive appdata sync token flow. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
  /**
   * URL of the stateless PHP auth broker (php/auth/index.php) used to
   * exchange authorization codes / refresh tokens for access tokens. Not a
   * secret — safe to commit. Optional: unset means Drive sync uses the
   * plain implicit-token flow only, same as before the broker existed.
   */
  readonly VITE_AUTH_BROKER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '@fontsource-variable/inter' {
  const content: any;
  export default content;
}

declare module '@fontsource-variable/fraunces' {
  const content: any;
  export default content;
}
