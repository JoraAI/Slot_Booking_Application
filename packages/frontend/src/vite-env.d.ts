/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Reservly API. Empty (local dev) → relative `/api` (vite proxy). */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
