import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@tenon/core/database/database"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { EventV2 } from "@tenon/core/event"
import { Location } from "@tenon/core/location"
import { ProjectV2 } from "@tenon/core/project"
import { AbsolutePath } from "@tenon/core/schema"
import { SessionV2 } from "@tenon/core/session"
import { SessionProjector } from "@tenon/core/session/projector"
import { SessionExecution } from "@tenon/core/session/execution"
import { SessionStore } from "@tenon/core/session/store"
import { Harness } from "@tenon/schema/harness"
import { framedTask } from "@tenon/core/harness/delegation-tasks"
import { testEffect } from "./lib/effect"

const id = SessionV2.ID.create()
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [
        ProjectV2.node,
        Layer.succeed(
          ProjectV2.Service,
          ProjectV2.Service.of({
            resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
            directories: () => Effect.succeed([]),
            commit: () => Effect.void,
          }),
        ),
      ],
      [
        SessionExecution.node,
        Layer.succeed(
          SessionExecution.Service,
          SessionExecution.Service.of({
            active: Effect.succeed(new Set([id])),
            resume: () => Effect.void,
            wake: () => Effect.void,
            interrupt: () => Effect.void,
            compact: () => Effect.succeed({ status: "unavailable" as const }),
          }),
        ),
      ],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("switchHarness while running, edge cases", () => {
  it.effect("an effort-only change is accepted and an unchanged pick is a no-op", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      yield* session.create({
        id,
        location,
        harnessInstanceID: Harness.ClaudeCode,
        harnessModel: Harness.ModelSelection.make({ id: "opus", reasoningEffort: "medium" }),
      })
      const high = Harness.ModelSelection.make({ id: "opus", reasoningEffort: "high" })
      yield* session.switchHarness({ sessionID: id, instanceID: Harness.ClaudeCode, model: high })
      yield* session.switchHarness({ sessionID: id, instanceID: Harness.ClaudeCode, model: high })
      expect((yield* session.get(id)).harnessModel).toEqual(high)
      expect((yield* session.get(id)).harnessRevision ?? 0).toBe(0)
    }),
  )
})

describe("framedTask edge cases", () => {
  test("still asks for a complete final report", () => {
    expect(framedTask("x", "do it")).toMatch(/final reply/)
    expect(framedTask("x", "do it")).toMatch(/complete report/)
  })
})
