import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "../../../../tenon/packages/core/node_modules/effect/dist/index.js"
import { HarnessRuntime } from "../../../../tenon/packages/core/src/harness"
import { HarnessAppTools } from "../../../../tenon/packages/core/src/harness/app-tools"
import { HarnessDelegation } from "../../../../tenon/packages/core/src/harness/delegation"
import { HarnessDelegationTasks } from "../../../../tenon/packages/core/src/harness/delegation-tasks"
import { LocationServiceMap } from "../../../../tenon/packages/core/src/location-service-map"
import { SessionV2 } from "../../../../tenon/packages/core/src/session"

type Fake = { id: string; location: { directory: string }; harnessInstanceID: string; parentID?: string; origin?: unknown }

function world(seed: Fake[]) {
  const all = new Map(seed.map((item) => [item.id, item] as const))
  const created: Array<Record<string, unknown>> = []
  let next = 0
  const stops = new Map<string, () => void>()
  const sessions = Layer.succeed(SessionV2.Service, {
    get: (id: string) => {
      const found = all.get(id)
      return found ? Effect.succeed(found) : Effect.fail(new SessionV2.NotFoundError({ sessionID: id as never }))
    },
    create: (input: Record<string, unknown>) =>
      Effect.sync(() => {
        created.push(input)
        const child: Fake = {
          id: `ses_v_${++next}`,
          location: input.location as { directory: string },
          harnessInstanceID: String(input.harnessInstanceID),
          ...(input.parentID ? { parentID: String(input.parentID) } : {}),
          ...(input.origin ? { origin: input.origin } : {}),
        }
        all.set(child.id, child)
        return child
      }),
    prompt: () => Effect.void,
    resume: (id: string) => Effect.callback<void>((done) => void stops.set(id, () => done(Effect.void))),
    interrupt: (id: string) => Effect.sync(() => stops.get(id)?.()),
    messages: () => Effect.succeed([]),
    active: Effect.succeed(new Set()),
  } as unknown as SessionV2.Interface)
  const runtime = Layer.succeed(HarnessRuntime.Service, {
    list: () => Effect.succeed([{ id: "opencode-acp", name: "OpenCode", status: "available", models: [] }]),
  } as unknown as HarnessRuntime.Interface)
  const locations = Layer.succeed(LocationServiceMap.Service, { get: () => runtime } as unknown as LocationServiceMap.Service["Service"])
  return { created, layer: HarnessDelegationTasks.layer.pipe(Layer.provide(Layer.mergeAll(sessions, locations))) }
}

let uninstall: (() => void) | undefined
function provider(projectFolder: HarnessAppTools.Provider["projectFolder"]) {
  uninstall = HarnessAppTools.install({ list: () => [], call: () => Promise.resolve(undefined), projectFolder } as HarnessAppTools.Provider)
}
afterEach(() => {
  uninstall?.()
  uninstall = undefined
})

function within<A>(layer: Layer.Layer<never>, body: () => Promise<A>) {
  return Effect.runPromise(Effect.scoped(Effect.gen(function* () { yield* Layer.build(layer); return yield* Effect.promise(body) })))
}
const delegate = (caller: string, args: Record<string, unknown>) =>
  HarnessDelegation.invoke("delegate_task", { agent: "opencode-acp", task: "work", wait_seconds: 0, ...args }, caller).then(
    (value) => ({ ok: value as HarnessDelegation.TaskResult }),
    (cause: Error) => ({ error: cause.message }),
  )
const wick = () => Promise.resolve({ directory: "D:\\Games\\Wickfall", name: "Wickfall" })

describe("delegate_task placement, independent cases", () => {
  test("AC-1 a Windows Command Centre folder, with a trailing separator, counts as the Command Centre", async () => {
    provider(wick)
    const w = world([{ id: "ses_cc_win", location: { directory: "C:\\Users\\me\\Vault\\.command-centre\\" }, harnessInstanceID: "claude-code" }])
    await within(w.layer, () => delegate("ses_cc_win", { project_id: "wickfall" }))
    expect(w.created[0]!.origin).toEqual({ sessionID: "ses_cc_win", commandCentre: true })
    expect(w.created[0]!.location).toMatchObject({ directory: "D:\\Games\\Wickfall" })
  })

  test("AC-1 a folder that only starts with .command-centre is not the Command Centre", async () => {
    provider(wick)
    const w = world([{ id: "ses_lookalike", location: { directory: "/vault/.command-centre-old" }, harnessInstanceID: "codex" }])
    await within(w.layer, () => delegate("ses_lookalike", { project_id: "wickfall" }))
    expect(w.created[0]!.origin).toEqual({ sessionID: "ses_lookalike", commandCentre: false })
  })

  test("AC-2 with no provider installed, a project_id fails and nothing is created", async () => {
    const w = world([{ id: "ses_cc", location: { directory: "/v/.command-centre" }, harnessInstanceID: "codex" }])
    const outcome = await within(w.layer, () => delegate("ses_cc", { project_id: "proj_42" }))
    expect("error" in outcome && outcome.error).toContain("proj_42")
    expect(w.created).toHaveLength(0)
  })

  test("AC-2 a provider hook that throws fails the call, naming the id", async () => {
    provider(() => Promise.reject(new Error("vault offline")))
    const w = world([{ id: "ses_cc", location: { directory: "/v/.command-centre" }, harnessInstanceID: "codex" }])
    const outcome = await within(w.layer, () => delegate("ses_cc", { project_id: "proj_7" }))
    expect("error" in outcome && outcome.error).toContain("proj_7")
    expect(w.created).toHaveLength(0)
  })

  test("AC-3 a blank project_id is no project_id", async () => {
    provider(wick)
    const w = world([{ id: "ses_cc", location: { directory: "/v/.command-centre" }, harnessInstanceID: "codex" }])
    await within(w.layer, () => delegate("ses_cc", { project_id: "   " }))
    expect(w.created[0]!.parentID).toBe("ses_cc")
    expect(w.created[0]!.origin).toBeUndefined()
  })

  test("AC-4 a stranger cannot cancel a Project-placed task", async () => {
    provider(wick)
    const w = world([
      { id: "ses_cc", location: { directory: "/v/.command-centre" }, harnessInstanceID: "codex" },
      { id: "ses_stranger", location: { directory: "D:\\Games\\Wickfall" }, harnessInstanceID: "codex" },
    ])
    await within(w.layer, async () => {
      const started = await delegate("ses_cc", { project_id: "wickfall" })
      const taskID = "ok" in started ? started.ok.taskID : ""
      const outcome = await HarnessDelegation.invoke("cancel_task", { task_id: taskID }, "ses_stranger").then(
        () => "cancelled",
        (cause: Error) => cause.message,
      )
      expect(outcome).toContain("belongs to this thread")
    })
  })

  test("AC-6 Project-placed tasks count toward the running limit", async () => {
    provider(wick)
    const w = world([{ id: "ses_cc", location: { directory: "/v/.command-centre" }, harnessInstanceID: "codex" }])
    await within(w.layer, async () => {
      for (let index = 0; index < HarnessDelegationTasks.MAX_RUNNING; index++) {
        const started = await delegate("ses_cc", { project_id: "wickfall" })
        expect("ok" in started).toBe(true)
      }
      const over = await delegate("ses_cc", {})
      expect("error" in over && over.error).toContain(String(HarnessDelegationTasks.MAX_RUNNING))
    })
  })
})
