import { http } from "./effect.js"
import { socket } from "./socket.js"

export const HttpRecorder = { http, socket } as const

export namespace HttpRecorder {
  export type CassetteMetadata = import("./types.js").CassetteMetadata
  export type RecorderOptions = import("./types.js").RecorderOptions
  export type RedactOptions = import("./types.js").RedactOptions
  export type RequestMatcher = import("./types.js").RequestMatcher
  export type RequestSnapshot = import("./types.js").RequestSnapshot
}
