import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Stream } from "effect"
import { Database } from "@tenon/core/database/database"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { EventV2 } from "@tenon/core/event"
import { Location } from "@tenon/core/location"
import { ProjectV2 } from "@tenon/core/project"
import { AbsolutePath } from "@tenon/core/schema"
import { SessionV2 } from "@tenon/core/session"
import { SessionExecution } from "@tenon/core/session/execution"
import { SessionInput } from "@tenon/core/session/input"
import { SessionProjector } from "@tenon/core/session/projector"
import { SessionStore } from "@tenon/core/session/store"
import { Harness } from "@tenon/schema/harness"
import { testEffect } from "./lib/effect"

// /compact on a harness thread runs the harness's own compaction. Given a model, the thread compacts on it and then
// switches back: a cold thread's compaction reloads the whole history, so a cheaper model reads it.

const busyID = SessionV2.ID.create()
const failingID = SessionV2.ID.create()
const gatedID = SessionV2.ID.create()
const resumed: string[] = []
const woken: string[] = []
// The gated thread's compaction turn runs until the test releases it.
let release: () => void = () => {}
const gate = new Promise<void>((resolve) => (release = resolve))
const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set([busyID])),
    resume: (sessionID) =>
      sessionID === failingID
        ? (Effect.fail(new Error("Claude Code is signed out.")) as never)
        : sessionID === gatedID
          ? Effect.promise(() => gate).pipe(Effect.tap(() => Effect.sync(() => void resumed.push(sessionID))))
          : Effect.sync(() => void resumed.push(sessionID)),
    wake: (sessionID) => Effect.sync(() => void woken.push(sessionID)),
    interrupt: () => Effect.void,
    compact: () => Effect.succeed({ status: "unavailable" as const }),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, execution],
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const opus = Harness.ModelSelection.make({ id: "opus", reasoningEffort: "medium" })
const haiku = Harness.ModelSelection.make({ id: "haiku" })

const switches = (session: SessionV2.Interface, sessionID: SessionV2.ID) =>
  session.events({ sessionID }).pipe(
    Stream.filter((event) => event.type === "session.next.harness.switched"),
    Stream.take(2),
    Stream.runCollect,
    Effect.map((events) => Array.from(events).map((event) => (event.data as { model?: { id: string } }).model?.id)),
  )

describe("SessionV2.compact", () => {
  it.effect("sends /compact on the given model, then switches the thread back to its own", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location, harnessInstanceID: Harness.ClaudeCode, harnessModel: opus })
      yield* session.compact({ sessionID: created.id, model: haiku })

      expect(yield* switches(session, created.id)).toEqual(["haiku", "opus"])
      expect((yield* session.get(created.id)).harnessModel).toEqual(opus)
      expect(resumed).toContain(created.id)
      const database = yield* Database.Service
      expect(yield* SessionInput.hasPending(database.db, created.id, "steer")).toBe(true)
      const admitted = yield* session.events({ sessionID: created.id }).pipe(
        Stream.filter((event) => event.type === "session.next.prompt.admitted"),
        Stream.take(1),
        Stream.runCollect,
      )
      expect(Array.from(admitted).map((event) => (event.data as { prompt: { text: string } }).prompt.text)).toEqual([
        "/compact",
      ])
    }),
  )

  it.effect("compacts on the thread's own model when none is given", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location, harnessInstanceID: Harness.ClaudeCode, harnessModel: opus })
      yield* session.compact({ sessionID: created.id })
      expect((yield* session.get(created.id)).harnessModel).toEqual(opus)
      expect(resumed).toContain(created.id)
    }),
  )

  it.effect("is unavailable for a harness without /compact and while the thread runs", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const codex = yield* session.create({ location, harnessInstanceID: Harness.Codex })
      const busy = yield* session.create({ id: busyID, location, harnessInstanceID: Harness.ClaudeCode })
      const operation = (sessionID: SessionV2.ID) =>
        session.compact({ sessionID, model: haiku }).pipe(
          Effect.flip,
          Effect.map((error) => (error instanceof SessionV2.OperationUnavailableError ? error.operation : error._tag)),
        )
      expect(yield* operation(codex.id)).toBe("compact")
      expect(yield* operation(busy.id)).toBe("compact")
      expect((yield* session.get(busy.id)).harnessModel).toBeUndefined()
    }),
  )

  it.effect("a compaction turn that fails reports the harness's reason and still switches back", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      yield* session.create({ id: failingID, location, harnessInstanceID: Harness.ClaudeCode, harnessModel: opus })
      const error = yield* session.compact({ sessionID: failingID, model: haiku }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(SessionV2.CompactFailedError)
      expect((error as SessionV2.CompactFailedError).message).toContain("signed out")
      expect((yield* session.get(failingID)).harnessModel).toEqual(opus)
    }),
  )

  it.live("a message sent during a compaction waits for it, then runs", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      yield* session.create({ id: gatedID, location, harnessInstanceID: Harness.ClaudeCode })
      const running = yield* Effect.forkChild(session.compact({ sessionID: gatedID }))
      yield* Effect.sleep("20 millis")
      const admitted = yield* session.prompt({ sessionID: gatedID, prompt: { text: "And the scope?" } })
      expect(admitted.delivery).toBe("queue")
      expect(woken).not.toContain(gatedID)
      release()
      yield* Fiber.join(running)
      expect(woken).toContain(gatedID)
      const admittedNow = yield* session.prompt({ sessionID: gatedID, prompt: { text: "Thanks" } })
      expect(admittedNow.delivery).toBe("steer")
    }),
  )
})
