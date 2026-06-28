/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Build-Zeit-Version aus apps/web/package.json (vite `define`, s. vite.config.ts). */
declare const __APP_VERSION__: string
