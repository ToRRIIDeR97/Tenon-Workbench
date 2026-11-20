import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { HarnessRuntime } from "@tenon/core/harness"
import { HarnessDelegation } from "@tenon/core/harness/delegation"
import { HarnessDelegationTasks } from "@tenon/core/harness/delegation-tasks"
import { LocationServiceMap } from "@tenon/core/location-service-map"
import { SessionV2 } from "@tenon/core/session"
import { SessionTodo } from "@tenon/core/session/todo"

// A delegating thread that ends its turn while a task runs must hear when the task finishes, or nothing carries the
// work on: the Command Centre lead sat idle after its workers finished. While a task runs, the delegating thread is
// also checked in with on an interval, can read the task's progress and can steer it.

const parent = { id: "ses_lead", location: { directory: "/work" }, harnessInstanceID: "claude-code" }

function fixture(options: { checkInMs?: number } = {}) {
  const finish = new Map<string, () => void>()
  const prompts: Array<{ sessionID: string; text: string; delivery?: string; resume?: boolean }> = []
  let created = 0
  const sessions = Layer.succeed(SessionV2.Service, {
    get: (id: string) =>
      Effect.succeed(id === parent.id ? parent : { ...parent, id, parentID: parent.id, harnessInstanceID: "codex" }),
    create: (input: { parentID: string; title: string }) =>
      Effect.succeed({ ...parent, id: `ses_task${++created}`, parentID: input.parentID, title: input.title }),
    prompt: (input: { sessionID: string; prompt: { text: string }; delivery?: string; resume?: boolean }) =>
      Effect.sync(() => {
        prompts.push({
          sessionID: input.sessionID,
          text: input.prompt.text,
          delivery: input.delivery,
          resume: input.resume,
        })
      }),
    resume: (id: string) => Effect.promise(() => new Promise<void>((resolve) => finish.set(id, resolve))),
    interrupt: (id: string) => Effect.sync(() => finish.get(id)?.()),
    messages: () =>
      Effect.succeed([{ type: "assistant", content: [{ type: "text", text: "Built the rifle." }], error: undefined }]),
    active: Effect.succeed(new Set()),
    // Nothing here ever promotes an input, so every queued prompt stays pending.
    queued: (id: string) =>
      Effect.succeed(
        prompts
          .filter((prompt) => prompt.sessionID === id && prompt.delivery === "queue")
          .map((prompt) => ({ prompt: { text: prompt.text } })),
      ),
  } as unknown as SessionV2.Interface)
  const runtime = Layer.succeed(HarnessRuntime.Service, {
    list: () => Effect.succeed([{ id: "codex", name: "Codex", status: "available", models: [] }]),
  } as unknown as HarnessRuntime.Interface)
  const todos = Layer.succeed(SessionTodo.Service, {
    get: () =>
      Effect.succeed([
        { content: "Model the receiver", status: "completed", priority: "medium" },
        { content: "Bake the textures", status: "in_progress", priority: "medium" },
      ]),
    update: () => Effect.void,
  } as unknown as SessionTodo.Interface)
  const locations = Layer.succeed(LocationServiceMap.Service, {
    get: () => Layer.mergeAll(runtime, todos),
  } as unknown as LocationServiceMap.Service["Service"])
  const tasks =
    options.checkInMs === undefined
      ? HarnessDelegationTasks.layer
      : HarnessDelegationTasks.layerWith({ checkInMs: options.checkInMs })
  return {
    finish,
    prompts,
    notices: () => prompts.filter((prompt) => prompt.sessionID === parent.id),
    checkIns: () => prompts.filter((prompt) => prompt.sessionID === parent.id && prompt.text.includes("Check-in")),
    layer: tasks.pipe(Layer.provide(Layer.mergeAll(sessions, locations))),
  }
}

const start = (title = "Guns A") =>
  Effect.promise(() =>
    HarnessDelegation.invoke(
      "delegate_task",
      { agent: "codex", task: "Model the rifle", title, wait_seconds: 0 },
      parent.id,
    ),
  )

const tick = () => Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)))

test("a task that finishes after the delegating turn ended queues a notice to the delegating thread", async () => {
  const world = fixture()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(world.layer)
        const started = yield* Effect.promise(() =>
          HarnessDelegation.invoke(
            "delegate_task",
            { agent: "codex", task: "Model the rifle", title: "Guns A", wait_seconds: 0 },
            parent.id,
          ),
        )
        expect(JSON.stringify(started)).toContain("running")
        expect(world.notices()).toHaveLength(0)
        world.finish.get("ses_task1")?.()
        yield* tick()
        const notices = world.notices()
        expect(notices).toHaveLength(1)
        // Queued, so a turn already running finishes first; resume left on, so an idle thread wakes.
        expect(notices[0]!.delivery).toBe("queue")
        expect(notices[0]!.resume).not.toBe(false)
        expect(notices[0]!.text).toContain("ses_task1")
        expect(notices[0]!.text).toContain("Guns A")
        expect(notices[0]!.text).toContain("task_result")
      }),
    ),
  )
})

test("a task whose result a call is waiting for sends no notice", async () => {
  const world = fixture()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(world.layer)
        yield* Effect.promise(() =>
          HarnessDelegation.invoke("delegate_task", { agent: "codex", task: "Research", wait_seconds: 0 }, parent.id),
        )
        const waiting = HarnessDelegation.invoke("task_result", { task_id: "ses_task1", wait_seconds: 30 }, parent.id)
        yield* tick()
        world.finish.get("ses_task1")?.()
        const result = yield* Effect.promise(() => waiting)
        expect(JSON.stringify(result)).toContain("completed")
        yield* tick()
        expect(world.notices()).toHaveLength(0)
      }),
    ),
  )
})

test("a task the delegating thread cancelled sends no notice", async () => {
  const world = fixture()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(world.layer)
        yield* Effect.promise(() =>
          HarnessDelegation.invoke("delegate_task", { agent: "codex", task: "Research", wait_seconds: 0 }, parent.id),
        )
        yield* Effect.promise(() => HarnessDelegation.invoke("cancel_task", { task_id: "ses_task1" }, parent.id))
        yield* tick()
        expect(world.notices()).toHaveLength(0)
      }),
    ),
  )
})

const wait = (ms: number) => Effect.promise(() => new Promise((resolve) => setTimeout(resolve, ms)))

test("a running task checks in with the delegating thread on an interval, without piling up", async () => {
  const world = fixture({ checkInMs: 40 })
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(world.layer)
        yield* start()
        yield* wait(60)
        const first = world.checkIns()
        expect(first).toHaveLength(1)
        expect(first[0]!.delivery).toBe("queue")
        expect(first[0]!.text).toContain("ses_task1")
        expect(first[0]!.text).toContain("Guns A")
        expect(first[0]!.text).toContain("task_result")
        expect(first[0]!.text).toContain("message_task")
        // The first check-in is still waiting for the thread, so later intervals add none.
        yield* wait(120)
        expect(world.checkIns()).toHaveLength(1)
      }),
    ),
  )
})

test("check-ins stop when the task finishes", async () => {
  const world = fixture({ checkInMs: 40 })
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(world.layer)
        yield* start()
        world.finish.get("ses_task1")?.()
        yield* wait(150)
        expect(world.checkIns()).toHaveLength(0)
        expect(world.notices()).toHaveLength(1)
      }),
    ),
  )
})

test("task_result on a running task reports its checklist and latest note", async () => {
  const world = fixture()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(world.layer)
        yield* start()
        const result = (yield* Effect.promise(() =>
          HarnessDelegation.invoke("task_result", { task_id: "ses_task1", wait_seconds: 0 }, parent.id),
        )) as HarnessDelegation.TaskResult
        expect(result.status).toBe("running")
        expect(result.progress?.todos).toEqual([
          { content: "Model the receiver", status: "completed" },
          { content: "Bake the textures", status: "in_progress" },
        ])
        expect(result.progress?.latest).toBe("Built the rifle.")
        expect(result.progress?.runningMinutes).toBe(0)
      }),
    ),
  )
})

test("message_task steers a running task and refuses a finished one", async () => {
  const world = fixture()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(world.layer)
        yield* start()
        yield* Effect.promise(() =>
          HarnessDelegation.invoke(
            "message_task",
            { task_id: "ses_task1", text: "Use the shared material library." },
            parent.id,
          ),
        )
        const steer = world.prompts.find(
          (prompt) => prompt.sessionID === "ses_task1" && prompt.text.includes("shared material"),
        )
        expect(steer?.delivery).toBe("steer")
        world.finish.get("ses_task1")?.()
        yield* tick()
        const late = yield* Effect.promise(() =>
          HarnessDelegation.invoke("message_task", { task_id: "ses_task1", text: "One more thing." }, parent.id).then(
            () => "sent",
            (error: Error) => error.message,
          ),
        )
        expect(late).toContain("not running")
      }),
    ),
  )
})
