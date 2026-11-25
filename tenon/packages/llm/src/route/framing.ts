import type { Stream } from "effect"
import * as ProviderShared from "../protocols/shared"
import type { LLMError } from "../schema"

export interface Framing<Frame> {
  readonly id: string
  readonly frame: (bytes: Stream.Stream<Uint8Array, LLMError>) => Stream.Stream<Frame, LLMError>
}

export const sse: Framing<string> = { id: "sse", frame: ProviderShared.sseFraming }

export * as Framing from "./framing"
