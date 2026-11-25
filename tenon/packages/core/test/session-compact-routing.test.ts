import { describe, expect, test } from "bun:test"
import { DateTime, Effect, Fiber, Layer, Stream } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@tenon/core/database/database"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { EventV2 } from "@tenon/core/event"
import { codexCompact, type CodexRuntime } from "@tenon/core/harness"
import { Location } from "@tenon/core/location"
import { ProjectV2 } from "@tenon/core/project"
import { AbsolutePath } from "@tenon/core/schema"
import { SessionV2 } from "@tenon/core/session"
import { SessionCompaction } from "@tenon/core/session/compaction"
import { SessionEvent } from "@tenon/core/session/event"
import { SessionExecution } from "@tenon/core/session/execution"
import { SessionMessage } from "@tenon/core/session/message"
import { SessionProjector } from "@tenon/core/session/projector"
import type { SessionRunner } from "@tenon/core/session/runner"
import { SessionStore } from "@tenon/core/session/store"
import { SessionTable } from "@tenon/core/session/sql"
import { Harness } from "@tenon/schema/harness"
import { testEffect } from "./lib/effect"

const outcomes = new Map<string, SessionRunner.CompactResult>()
const asked: Array<{ sessionID: string; model?: string }> = []
const woken: string[] = []
const gatedID = SessionV2.ID.create()
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
    active: Effect.succeed(new Set()),
    resume: () => Effect.void,
    wake: (sessionID) => Effect.sync(() => void woken.push(sessionID)),
    interrupt: () => Effect.void,
    compact: (input) =>
      (input.sessionID === gatedID ? Effect.promise(() => gate) : Effect.void).pipe(
        Effect.map(() => {
          asked.push({ sessionID: input.sessionID, model: input.model?.id })
          return outcomes.get(input.sessionID) ?? { status: "unavailable" as const }
        }),
      ),
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
const haiku = Harness.ModelSelection.make({ id: "haiku" })

const failure = (effect: Effect.Effect<void, unknown>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) =>
      error instanceof SessionV2.CompactFailedError
        ? `failed: ${error.message}`
        : error instanceof SessionV2.OperationUnavailableError
          ? "unavailable"
          : String(error),
    ),
  )

describe("SessionV2.compact routing", () => {
  it.effect("a Codex or custom-harness thread goes to the runner, with the cold-cache model", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const codex = yield* session.create({ location, harnessInstanceID: Harness.Codex })
      const custom = yield* session.create({ location, harnessInstanceID: Harness.InstanceID.make("gemini") })
      const broken = yield* session.create({ location, harnessInstanceID: Harness.Codex })
      outcomes.set(codex.id, { status: "done" })
      outcomes.set(broken.id, { status: "failed", message: "Codex is signed out." })

      yield* session.compact({ sessionID: codex.id })
      expect(yield* failure(session.compact({ sessionID: custom.id, model: haiku }))).toBe("unavailable")
      expect(yield* failure(session.compact({ sessionID: broken.id }))).toBe("failed: Codex is signed out.")
      expect(asked).toEqual([
        { sessionID: codex.id, model: undefined },
        { sessionID: custom.id, model: "haiku" },
        { sessionID: broken.id, model: undefined },
      ])
    }),
  )

  it.live("a message sent during a Codex compaction waits for it, then runs", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      yield* session.create({ id: gatedID, location, harnessInstanceID: Harness.Codex })
      outcomes.set(gatedID, { status: "done" })
      const running = yield* Effect.forkChild(session.compact({ sessionID: gatedID }))
      yield* Effect.sleep("20 millis")
      expect((yield* session.prompt({ sessionID: gatedID, prompt: { text: "Next?" } })).delivery).toBe("queue")
      expect(yield* failure(session.compact({ sessionID: gatedID }))).toBe("unavailable")
      expect(woken).not.toContain(gatedID)
      release()
      yield* Fiber.join(running)
      expect(woken).toContain(gatedID)
    }),
  )

  it.effect("an ACP agent the runner finds takes /compact gets it natively", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const agent = yield* session.create({ location, harnessInstanceID: Harness.InstanceID.make("goose") })
      outcomes.set(agent.id, { status: "native" })
      yield* session.compact({ sessionID: agent.id })
      const admitted = yield* session.events({ sessionID: agent.id }).pipe(
        Stream.filter((event) => event.type === "session.next.prompt.admitted"),
        Stream.take(1),
        Stream.runCollect,
      )
      expect(Array.from(admitted).map((event) => (event.data as { prompt: { text: string } }).prompt.text)).toEqual([
        "/compact",
      ])
    }),
  )

  it.effect("a compaction the user asked for drops the thread's native sessions; an automatic one keeps them", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const continuations = (id: SessionV2.ID) =>
        db
          .select({ metadata: SessionTable.metadata })
          .from(SessionTable)
          .where(eq(SessionTable.id, id))
          .get()
          .pipe(
            Effect.orDie,
            Effect.map((row) => row?.metadata?.harnessContinuations),
          )
      const compacted = (id: SessionV2.ID, reason: "auto" | "manual") =>
        Effect.gen(function* () {
          const messageID = SessionMessage.ID.create()
          yield* events.publish(SessionEvent.Compaction.Started, {
            sessionID: id,
            messageID,
            timestamp: yield* DateTime.now,
            reason,
          })
          yield* events.publish(SessionEvent.Compaction.Ended, {
            sessionID: id,
            messageID,
            timestamp: yield* DateTime.now,
            reason,
            text: "Summary",
            recent: "",
          })
        })
      for (const reason of ["auto", "manual"] as const) {
        const created = yield* session.create({ location, harnessInstanceID: Harness.InstanceID.make("gemini") })
        yield* events.publish(SessionEvent.HarnessContinuationSet, {
          sessionID: created.id,
          timestamp: yield* DateTime.now,
          instanceID: Harness.InstanceID.make("gemini"),
          continuation: "native-1",
        })
        yield* compacted(created.id, reason)
        const left = yield* continuations(created.id)
        if (reason === "auto") expect(left).toMatchObject({ gemini: { nativeID: "native-1" } })
        else expect(left).toBeUndefined()
      }
    }),
  )
})

describe("SessionCompaction.record", () => {
  const entries = [
    { seq: 1, message: { type: "user", text: "Build the rifle" } },
    { seq: 2, message: { type: "assistant", content: [{ type: "text", text: "Built it." }] } },
    { seq: 3, message: { type: "user", text: "Now the scope" } },
  ] as unknown as Parameters<typeof SessionCompaction.record>[1]["entries"]

  const recorder = () => {
    const published: Array<{ type: string; reason: unknown; text?: unknown }> = []
    const events = {
      publish: (definition: { type: string }, data: { reason: unknown; text?: unknown }) =>
        Effect.sync(() => void published.push({ type: definition.type, reason: data.reason, text: data.text })),
    } as unknown as EventV2.Interface
    return { events, published }
  }

  test("summarizes the older history with any summarizer and records a manual compaction", async () => {
    const { events, published } = recorder()
    const prompts: string[] = []
    const done = await Effect.runPromise(
      SessionCompaction.record(events, {
        sessionID: SessionV2.ID.create(),
        entries,
        reason: "manual",
        keepTokens: 5,
        summarize: (prompt) => Effect.sync(() => (prompts.push(prompt), "The rifle is built; the scope is next.")),
      }),
    )
    expect(done).toBe(true)
    expect(prompts[0]).toContain("[User]: Build the rifle")
    expect(published).toEqual([
      { type: "session.next.compaction.started", reason: "manual", text: undefined },
      { type: "session.next.compaction.ended", reason: "manual", text: "The rifle is built; the scope is next." },
    ])
  })

  test("an empty summary records no compaction", async () => {
    const { events, published } = recorder()
    const done = await Effect.runPromise(
      SessionCompaction.record(events, {
        sessionID: SessionV2.ID.create(),
        entries,
        reason: "manual",
        keepTokens: 5,
        summarize: () => Effect.succeed(undefined),
      }),
    )
    expect(done).toBe(false)
    expect(published.map((event) => event.type)).toEqual(["session.next.compaction.started"])
  })
})

describe("codexCompact", () => {
  test("starts Codex's compaction and waits for that thread's turn to complete", async () => {
    const requests: Array<{ method: string; params: unknown }> = []
    const runtime = {
      threadID: "thr_1",
      client: {
        request: (method: string, params: unknown) => Effect.sync(() => (requests.push({ method, params }), {})),
        notifications: Stream.make(
          { method: "item/started", params: { threadId: "thr_1" } },
          { method: "turn/completed", params: { threadId: "thr_other" } },
          { method: "turn/completed", params: { threadId: "thr_1" } },
          { method: "never/read", params: {} },
        ),
      },
    } as unknown as CodexRuntime
    await Effect.runPromise(codexCompact(Effect.succeed(runtime)))
    expect(requests).toEqual([{ method: "thread/compact/start", params: { threadId: "thr_1" } }])
  })

  test("a refused request fails with Codex's message", async () => {
    const runtime = {
      threadID: "thr_1",
      client: {
        request: () => Effect.fail(new Error("not signed in")),
        notifications: Stream.empty,
      },
    } as unknown as CodexRuntime
    const error = await Effect.runPromise(Effect.flip(codexCompact(Effect.succeed(runtime))))
    expect(error.message).toContain("not signed in")
  })
})
