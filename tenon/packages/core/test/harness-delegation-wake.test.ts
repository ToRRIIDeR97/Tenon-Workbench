import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { HarnessRuntime } from "@tenon/core/harness"
import { HarnessDelegation } from "@tenon/core/harness/delegation"
import { HarnessDelegationTasks } from "@tenon/core/harness/delegation-tasks"
import { LocationServiceMap } from "@tenon/core/location-service-map"
import { SessionV2 } from "@tenon/core/session"

// A delegating thread that ends its turn while a task runs must hear when the task finishes, or nothing carries the
// work on: the Command Centre lead sat idle after its workers finished.

const parent = { id: "ses_lead", location: { directory: "/work" }, harnessInstanceID: "claude-code" }

function fixture() {
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
  } as unknown as SessionV2.Interface)
  const runtime = Layer.succeed(HarnessRuntime.Service, {
    list: () => Effect.succeed([{ id: "codex", name: "Codex", status: "available", models: [] }]),
  } as unknown as HarnessRuntime.Interface)
  const locations = Layer.succeed(LocationServiceMap.Service, {
    get: () => runtime,
  } as unknown as LocationServiceMap.Service["Service"])
  return {
    finish,
    prompts,
    notices: () => prompts.filter((prompt) => prompt.sessionID === parent.id),
    layer: HarnessDelegationTasks.layer.pipe(Layer.provide(Layer.mergeAll(sessions, locations))),
  }
}

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
