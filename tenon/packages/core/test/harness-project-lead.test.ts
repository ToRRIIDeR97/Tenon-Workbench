import { afterEach, expect, test } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { HarnessRuntime } from "@tenon/core/harness"
import { HarnessAppTools } from "@tenon/core/harness/app-tools"
import { HarnessDelegation } from "@tenon/core/harness/delegation"
import { HarnessDelegationTasks } from "@tenon/core/harness/delegation-tasks"
import { LocationServiceMap } from "@tenon/core/location-service-map"
import { SessionV2 } from "@tenon/core/session"
import { SessionTodo } from "@tenon/core/session/todo"

// The Command Centre runs Projects, not their agents: it gives a Project's goal to one lead thread in that Project,
// reuses that lead for later goals, and leaves the lead to run its own delegates.

type Row = {
  id: string
  title: string
  location: { directory: string }
  harnessInstanceID: string
  harnessModel?: { id: string; reasoningEffort?: string }
  parentID?: string
  origin?: { sessionID: string; commandCentre: boolean; lead?: boolean; handOff?: boolean }
  time: { created: DateTime.Utc; archived?: DateTime.Utc }
}

const commandFolder = "/vault/.command-centre"
const projectFolder = "/vault/projects/Alpha"

function fixture() {
  const rows = new Map<string, Row>()
  const add = (row: Omit<Row, "time">) =>
    rows.set(row.id, { ...row, time: { created: DateTime.makeUnsafe(rows.size) } })
  add({
    id: "ses_cc1",
    title: "Command Centre",
    location: { directory: commandFolder },
    harnessInstanceID: "claude-code",
    harnessModel: { id: "opus", reasoningEffort: "medium" },
  })
  add({
    id: "ses_cc2",
    title: "Command Centre 2",
    location: { directory: commandFolder },
    harnessInstanceID: "claude-code",
  })
  add({ id: "ses_worker", title: "Worker", location: { directory: projectFolder }, harnessInstanceID: "codex" })
  const prompts: Array<{ sessionID: string; text: string; delivery?: string }> = []
  const finish = new Map<string, () => void>()
  let created = 0
  const sessions = Layer.succeed(SessionV2.Service, {
    get: (id: string) => {
      const row = rows.get(id)
      return row ? Effect.succeed(row) : Effect.fail(new Error(`missing ${id}`))
    },
    create: (input: Omit<Row, "id" | "time">) =>
      Effect.sync(() => {
        const id = `ses_new${++created}`
        add({ ...input, id })
        return rows.get(id)!
      }),
    list: (input: { directory: string }) =>
      Effect.succeed([...rows.values()].filter((row) => row.location.directory === input.directory).toReversed()),
    prompt: (input: { sessionID: string; prompt: { text: string }; delivery?: string }) =>
      Effect.sync(
        () => void prompts.push({ sessionID: input.sessionID, text: input.prompt.text, delivery: input.delivery }),
      ),
    resume: (id: string) => Effect.promise(() => new Promise<void>((resolve) => finish.set(id, resolve))),
    interrupt: (id: string) => Effect.sync(() => finish.get(id)?.()),
    messages: () => Effect.succeed([{ type: "assistant", content: [{ type: "text", text: "Milestone done." }] }]),
    active: Effect.succeed(new Set()),
    queued: () => Effect.succeed([]),
    wakeQueued: () => Effect.succeed(0),
  } as unknown as SessionV2.Interface)
  const runtime = Layer.succeed(HarnessRuntime.Service, {
    list: () =>
      Effect.succeed([
        { id: "claude-code", name: "Claude Code", status: "available", models: [] },
        { id: "codex", name: "Codex", status: "available", models: [] },
      ]),
  } as unknown as HarnessRuntime.Interface)
  const todos = Layer.succeed(SessionTodo.Service, {
    get: () => Effect.succeed([]),
    update: () => Effect.void,
  } as unknown as SessionTodo.Interface)
  const locations = Layer.succeed(LocationServiceMap.Service, {
    get: () => Layer.mergeAll(runtime, todos),
  } as unknown as LocationServiceMap.Service["Service"])
  const uninstall = HarnessAppTools.install({
    list: () => [],
    call: () => Promise.reject(new Error("unused")),
    projectFolder: async (_caller, projectId) =>
      projectId === "project_alpha" ? { directory: projectFolder, name: "Alpha" } : undefined,
  })
  return {
    rows,
    prompts,
    finish,
    uninstall,
    layer: HarnessDelegationTasks.layerWith({ checkInMs: 60_000, wakeDelayMs: 0 }).pipe(
      Layer.provide(Layer.mergeAll(sessions, locations)),
    ),
  }
}

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

const lead = (from: string, goal: string, extra: Record<string, unknown> = {}) =>
  Effect.promise(() =>
    HarnessDelegation.invoke("project_lead", { project_id: "project_alpha", goal, wait_seconds: 0, ...extra }, from),
  )
const tick = () => Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)))

test("the first goal starts a lead in the Project's folder on the Command Centre's harness and model", async () => {
  const world = fixture()
  cleanup = world.uninstall
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(world.layer)
        const result = (yield* lead("ses_cc1", "Ship M6")) as HarnessDelegation.TaskResult
        const row = world.rows.get(result.taskID)!
        expect(row.location.directory).toBe(projectFolder)
        expect(row.origin).toEqual({ sessionID: "ses_cc1", commandCentre: true, lead: true })
        expect(row.parentID).toBeUndefined()
        expect(row.harnessInstanceID).toBe("claude-code")
        expect(row.harnessModel).toEqual({ id: "opus", reasoningEffort: "medium" })
        expect(result.status).toBe("running")
        const brief = world.prompts.find((prompt) => prompt.sessionID === row.id)!
        expect(brief.text).toContain("You are this Project's lead agent")
        expect(brief.text).toContain("delegate_task")
        expect(brief.text.endsWith("Ship M6")).toBe(true)
      }),
    ),
  )
})

test("a later goal from another Command Centre thread goes to the same lead, which then reports there", async () => {
  const world = fixture()
  cleanup = world.uninstall
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(world.layer)
        const first = (yield* lead("ses_cc1", "Ship M6")) as HarnessDelegation.TaskResult
        world.finish.get(first.taskID)?.()
        yield* tick()
        const second = (yield* lead("ses_cc2", "Polish the HUD", { agent: "codex" })) as HarnessDelegation.TaskResult
        expect(second.taskID).toBe(first.taskID)
        // Agent and model only apply to a new lead.
        expect(world.rows.get(first.taskID)!.harnessInstanceID).toBe("claude-code")
        const goals = world.prompts.filter((prompt) => prompt.sessionID === first.taskID)
        expect(goals).toHaveLength(2)
        expect(goals[1]!.text.startsWith("New goal from the Command Centre:")).toBe(true)
        expect(goals[1]!.text).toContain("Polish the HUD")
        // Any Command Centre thread may read the lead.
        const read = yield* Effect.promise(() =>
          HarnessDelegation.invoke("task_result", { task_id: first.taskID, wait_seconds: 0 }, "ses_cc2"),
        )
        expect(read).toMatchObject({ taskID: first.taskID, status: "running" })
        world.finish.get(first.taskID)?.()
        yield* tick()
        const notice = world.prompts.findLast((prompt) => prompt.text.includes(`task_id ${first.taskID}`))
        expect(notice?.sessionID).toBe("ses_cc2")
      }),
    ),
  )
})

test("a goal for a lead that is still working steers it instead of starting a second lead", async () => {
  const world = fixture()
  cleanup = world.uninstall
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(world.layer)
        const first = (yield* lead("ses_cc1", "Ship M6")) as HarnessDelegation.TaskResult
        const second = (yield* lead("ses_cc1", "Also fix the jump")) as HarnessDelegation.TaskResult
        expect(second.taskID).toBe(first.taskID)
        expect([...world.rows.values()].filter((row) => row.origin?.lead)).toHaveLength(1)
        expect(world.prompts.findLast((prompt) => prompt.sessionID === first.taskID)?.delivery).toBe("steer")
      }),
    ),
  )
})

test("only the Command Centre gives goals to Project leads", async () => {
  const world = fixture()
  cleanup = world.uninstall
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(world.layer)
        const refused = yield* Effect.promise(() =>
          HarnessDelegation.invoke("project_lead", { project_id: "project_alpha", goal: "x" }, "ses_worker").then(
            () => "started",
            (error: Error) => error.message,
          ),
        )
        expect(refused).toContain("Only the Command Centre")
      }),
    ),
  )
})
