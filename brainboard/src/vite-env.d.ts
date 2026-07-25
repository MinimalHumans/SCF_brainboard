/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Git tag for a prod build (e.g. "v0.2.7"), or "dev" for a main-branch build. Unset locally. */
  readonly VITE_APP_VERSION?: string
  /** Full commit SHA the build was made from. Unset locally. */
  readonly VITE_BUILD_SHA?: string
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
