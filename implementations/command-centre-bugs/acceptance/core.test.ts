// Acceptance tests for AC-2 and AC-5.
// Run from tenon/packages/core: bun test test/command-centre-bugs.test.ts
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
const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
// The session is always executing, as a Command Centre lead busy with check-ins is.
const busy = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set([id])),
    resume: () => Effect.void,
    wake: () => Effect.void,
    interrupt: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, busy],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("AC-2 switchHarness while running", () => {
  it.effect("accepts a model change on the same harness and refuses a harness change", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({
        id,
        location,
        harnessInstanceID: Harness.ClaudeCode,
        harnessModel: Harness.ModelSelection.make({ id: "haiku" }),
      })
      expect(created.id).toBe(id)

      const opus = Harness.ModelSelection.make({ id: "opus", reasoningEffort: "medium" })
      yield* session.switchHarness({ sessionID: id, instanceID: Harness.ClaudeCode, model: opus })
      expect((yield* session.get(id)).harnessModel).toEqual(opus)

      const refused = yield* session.switchHarness({ sessionID: id, instanceID: Harness.Codex }).pipe(Effect.flip)
      expect(refused).toBeInstanceOf(SessionV2.OperationUnavailableError)
      expect((refused as SessionV2.OperationUnavailableError).operation).toBe("switchHarness")
      expect((yield* session.get(id)).harnessInstanceID).toBe(Harness.ClaudeCode)
    }),
  )
})

describe("AC-5 framedTask", () => {
  test("frames the brief as a scoped delegate and keeps the task verbatim", () => {
    const task = "Fix the jump bug in player.ts.\nRun bun test after."
    const text = framedTask("Claude Code", task)
    expect(text).toContain("delegated to you by Claude Code")
    expect(text).toContain(task)
    expect(text.toLowerCase()).toContain("delegate")
    expect(text).toMatch(/only (the files|what) .*task needs/i)
    expect(text).toMatch(/code style/i)
    expect(text).toMatch(/safety/i)
    expect(text).toMatch(/checks/i)
    expect(text.indexOf(task)).toBeGreaterThan(text.indexOf("delegated to you"))
  })
})
