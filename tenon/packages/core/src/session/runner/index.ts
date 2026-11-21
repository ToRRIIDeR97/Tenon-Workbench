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

/**
 * What `/compact` did for a thread whose harness has no `/compact` command: compacted it, found the harness does
 * take `/compact` after all (an ACP agent that reported it), found nothing to compact, or failed with a reason.
 */
export type CompactResult =
  | { readonly status: "done" }
  | { readonly status: "native" }
  | { readonly status: "unavailable" }
  | { readonly status: "failed"; readonly message: string }

/** Runs one local continuation from already-recorded Session history. */
export interface Interface {
  /** Drains eligible durable work. Explicit runs perform one provider attempt even when no work is eligible. */
  readonly run: (input: {
    readonly sessionID: SessionSchema.ID
    readonly force: boolean
  }) => Effect.Effect<void, RunError>
  /** Compacts an idle thread on demand: Codex on its own side, the built-in agent and other harnesses on Tenon's. */
  readonly compact: (input: {
    readonly sessionID: SessionSchema.ID
    /** The harness model a summary on Tenon's side is written with; the thread's own when unset. */
    readonly model?: Harness.ModelSelection
  }) => Effect.Effect<CompactResult>
}

export class Service extends Context.Service<Service, Interface>()("@tenon/v2/SessionRunner") {}
