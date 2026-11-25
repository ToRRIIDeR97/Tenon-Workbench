export * as SessionRunner from "./index"

import type { LLMError } from "@tenon/llm"
import { Context, Effect } from "effect"
import type { Harness } from "@tenon/schema/harness"
import { SessionSchema } from "../schema"
import type { ContextSnapshotDecodeError, MessageDecodeError } from "../error"
import { SessionRunnerModel } from "./model"
import type { SystemContext } from "../../system-context/index"
import type { ToolOutputStore } from "../../tool-output-store"

export type RunError =
  | LLMError
  | SessionRunnerModel.Error
  | MessageDecodeError
  | ContextSnapshotDecodeError
  | SystemContext.InitializationBlocked
  | ToolOutputStore.Error

export type CompactResult =
  | { readonly status: "done" }
  | { readonly status: "native" }
  | { readonly status: "unavailable" }
  | { readonly status: "failed"; readonly message: string }

export interface Interface {
  readonly run: (input: {
    readonly sessionID: SessionSchema.ID
    readonly force: boolean
  }) => Effect.Effect<void, RunError>
  readonly compact: (input: {
    readonly sessionID: SessionSchema.ID
    readonly model?: Harness.ModelSelection
  }) => Effect.Effect<CompactResult>
}

export class Service extends Context.Service<Service, Interface>()("@tenon/v2/SessionRunner") {}
