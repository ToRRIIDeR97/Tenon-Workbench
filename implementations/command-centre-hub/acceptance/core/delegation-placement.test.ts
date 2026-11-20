// Run from tenon/packages/core: bun test ../../../Implementations/command-centre-hub/acceptance/core
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "../../../../tenon/packages/core/node_modules/effect/dist/index.js"
import { HarnessRuntime } from "../../../../tenon/packages/core/src/harness"
import { HarnessAppTools } from "../../../../tenon/packages/core/src/harness/app-tools"
import { HarnessDelegation } from "../../../../tenon/packages/core/src/harness/delegation"
import { HarnessDelegationTasks } from "../../../../tenon/packages/core/src/harness/delegation-tasks"
import { LocationServiceMap } from "../../../../tenon/packages/core/src/location-service-map"
import { SessionV2 } from "../../../../tenon/packages/core/src/session"

type Fake = {
  id: string
  location: { directory: string }
  harnessInstanceID: string
  parentID?: string
  origin?: { sessionID: string; commandCentre: boolean }
}

// A session store in memory: the delegation layer only needs get, create, prompt, resume, interrupt, messages.
function world(seed: Fake[]) {
  const all = new Map(seed.map((item) => [item.id, item] as const))
  const created: Array<Record<string, unknown>> = []
  let next = 0
  // A run ends when it is interrupted, so cancel_task settles at once instead of waiting out its timeout.
  const stops = new Map<string, () => void>()
  const sessions = Layer.succeed(SessionV2.Service, {
    get: (id: string) => {
      const found = all.get(id)
      return found ? Effect.succeed(found) : Effect.fail(new SessionV2.NotFoundError({ sessionID: id as never }))
    },
    create: (input: Record<string, unknown>) =>
      Effect.sync(() => {
        created.push(input)
        const location = input.location as { directory: string }
        const child: Fake = {
          id: `ses_worker_${++next}`,
          location,
          harnessInstanceID: String(input.harnessInstanceID),
          ...(input.parentID ? { parentID: String(input.parentID) } : {}),
          ...(input.origin ? { origin: input.origin as Fake["origin"] } : {}),
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
    list: () => Effect.succeed([{ id: "codex", name: "Codex", status: "available", models: [] }]),
  } as unknown as HarnessRuntime.Interface)
  const locations = Layer.succeed(LocationServiceMap.Service, {
    get: () => runtime,
  } as unknown as LocationServiceMap.Service["Service"])
  return { created, all, layer: HarnessDelegationTasks.layer.pipe(Layer.provide(Layer.mergeAll(sessions, locations))) }
}

const projects: Record<string, { directory: string; name: string }> = {
  alpha: { directory: "/work/projects/Alpha X", name: "Alpha X" },
}
let uninstall: (() => void) | undefined
function provider() {
  uninstall = HarnessAppTools.install({
    list: () => [],
    call: () => Promise.resolve(undefined),
    projectFolder: (_caller: HarnessAppTools.Caller, id: string) => Promise.resolve(projects[id]),
  } as HarnessAppTools.Provider)
}
afterEach(() => {
  uninstall?.()
  uninstall = undefined
})

const command: Fake = { id: "ses_command", location: { directory: "/vault/.command-centre" }, harnessInstanceID: "claude-code" }
const projectThread: Fake = { id: "ses_project", location: { directory: "/work/projects/Beta" }, harnessInstanceID: "codex" }

function within<A>(layer: Layer.Layer<never>, body: () => Promise<A>) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(layer)
        return yield* Effect.promise(body)
      }),
    ),
  )
}

describe("delegate_task with project_id", () => {
  test("AC-1 a Command Centre task runs as a root thread in the Project's folder, linked by origin", async () => {
    provider()
    const w = world([command])
    const result = (await within(w.layer, () =>
      HarnessDelegation.invoke(
        "delegate_task",
        { agent: "codex", task: "Build the harness", project_id: "alpha", model: "gpt-5.5", title: "M0", wait_seconds: 0 },
        command.id,
      ),
    )) as HarnessDelegation.TaskResult
    expect(result.status).toBe("running")
    expect(w.created).toHaveLength(1)
    const input = w.created[0]!
    expect(input.parentID).toBeUndefined()
    expect(input.location).toMatchObject({ directory: "/work/projects/Alpha X" })
    expect(input.harnessInstanceID).toBe("codex")
    expect(input.harnessModel).toMatchObject({ id: "gpt-5.5" })
    expect(input.origin).toEqual({ sessionID: command.id, commandCentre: true })
  })

  test("AC-1 a task from a Project thread carries origin with commandCentre false", async () => {
    provider()
    const w = world([projectThread])
    await within(w.layer, () =>
      HarnessDelegation.invoke("delegate_task", { agent: "codex", task: "t", project_id: "alpha", wait_seconds: 0 }, projectThread.id),
    )
    expect(w.created[0]!.origin).toEqual({ sessionID: projectThread.id, commandCentre: false })
  })

  test("AC-2 an unknown Project fails, naming the id, and creates nothing", async () => {
    provider()
    const w = world([command])
    const error = await within(w.layer, () =>
      HarnessDelegation.invoke("delegate_task", { agent: "codex", task: "t", project_id: "missing-project", wait_seconds: 0 }, command.id).then(
        () => undefined,
        (cause: Error) => cause,
      ),
    )
    expect(error?.message).toContain("missing-project")
    expect(w.created).toHaveLength(0)
  })

  test("AC-3 without project_id the task stays a child in the caller's folder", async () => {
    provider()
    const w = world([command])
    await within(w.layer, () =>
      HarnessDelegation.invoke("delegate_task", { agent: "codex", task: "t", wait_seconds: 0 }, command.id),
    )
    expect(w.created[0]!.parentID).toBe(command.id)
    expect(w.created[0]!.location).toMatchObject({ directory: "/vault/.command-centre" })
    expect(w.created[0]!.origin).toBeUndefined()
  })

  test("AC-4 only the delegating thread reads and cancels a Project-placed task", async () => {
    provider()
    const w = world([command, projectThread])
    await within(w.layer, async () => {
      const started = (await HarnessDelegation.invoke(
        "delegate_task",
        { agent: "codex", task: "t", project_id: "alpha", wait_seconds: 0 },
        command.id,
      )) as HarnessDelegation.TaskResult
      const read = (await HarnessDelegation.invoke("task_result", { task_id: started.taskID, wait_seconds: 0 }, command.id)) as HarnessDelegation.TaskResult
      expect(read.taskID).toBe(started.taskID)
      const stranger = await HarnessDelegation.invoke("task_result", { task_id: started.taskID, wait_seconds: 0 }, projectThread.id).then(
        () => undefined,
        (cause: Error) => cause,
      )
      expect(stranger?.message).toContain("belongs to this thread")
      const cancelled = (await HarnessDelegation.invoke("cancel_task", { task_id: started.taskID }, command.id)) as HarnessDelegation.TaskResult
      expect(cancelled.taskID).toBe(started.taskID)
    })
  })

  test("AC-5 depth follows origin: a placed worker may delegate once, its own worker may not", async () => {
    provider()
    const first: Fake = { id: "ses_first", location: { directory: "/work/projects/Alpha X" }, harnessInstanceID: "codex", origin: { sessionID: command.id, commandCentre: true } }
    const second: Fake = { id: "ses_second", location: { directory: "/work/projects/Alpha X" }, harnessInstanceID: "codex", origin: { sessionID: first.id, commandCentre: false } }
    const w = world([command, first, second])
    await within(w.layer, async () => {
      const allowed = await HarnessDelegation.invoke("delegate_task", { agent: "codex", task: "t", wait_seconds: 0 }, first.id).then(
        () => "started",
        (cause: Error) => cause.message,
      )
      expect(allowed).toBe("started")
      const refused = await HarnessDelegation.invoke("delegate_task", { agent: "codex", task: "t", wait_seconds: 0 }, second.id).then(
        () => "started",
        (cause: Error) => cause.message,
      )
      expect(refused).toContain("cannot delegate further")
    })
  })
})
