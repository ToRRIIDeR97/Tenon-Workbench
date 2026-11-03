/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TENON_SERVER_HOST: string
  readonly VITE_TENON_SERVER_PORT: string
  readonly VITE_TENON_CHANNEL?: "dev" | "beta" | "prod"

  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SENTRY_ENVIRONMENT?: string
  readonly VITE_SENTRY_RELEASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "*.png" {
  const src: string
  export default src
}

declare module "*.mp4" {
  const src: string
  export default src
}

// Keeps this file a module, as it was when it declared the solid-dnd directive.
export {}
