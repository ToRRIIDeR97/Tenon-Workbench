interface ImportMetaEnv {
  readonly TENON_CHANNEL: string
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:tenon-server" {
  export namespace Server {
    export const listen: typeof import("../../../tenon/dist/types/src/node").Server.listen
    export type Listener = import("../../../tenon/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../tenon/dist/types/src/node").Config.get
    export type Info = import("../../../tenon/dist/types/src/node").Config.Info
  }
  export const bootstrap: typeof import("../../../tenon/dist/types/src/node").bootstrap
}
