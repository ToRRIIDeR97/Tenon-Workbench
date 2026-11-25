export * as SessionExecution from "./execution"

import { Context, Effect, Layer } from "effect"
import { LayerNode } from "../effect/layer-node"
import { Node } from "../effect/app-node"
import { SessionRunner } from "./runner/index"
import { SessionSchema } from "./schema"
import type { Harness } from "@tenon/schema/harness"

export interface Interface {
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, SessionRunner.RunError>
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly compact: (input: {
    readonly sessionID: SessionSchema.ID
    readonly model?: Harness.ModelSelection
  }) => Effect.Effect<SessionRunner.CompactResult>
}

export class Service extends Context.Service<Service, Interface>()("@tenon/v2/SessionExecution") {}

export const node = LayerNode.unbound(Service, Node.tags.values.global)

export const noopLayer = Layer.succeed(
  Service,
  Service.of({
    active: Effect.succeed(new Set()),
    resume: () => Effect.void,
    wake: () => Effect.void,
    interrupt: () => Effect.void,
    compact: () => Effect.succeed({ status: "unavailable" } as const),
  }),
)
