import { afterEach, describe, expect, test } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Config, Deferred, Effect, Fiber, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { CrossSpawnSpawner } from "@tenon/core/cross-spawn-spawner"
import { Database } from "@tenon/core/database/database"
import { Global } from "@tenon/core/global"
import { Ripgrep } from "@tenon/core/ripgrep"
import { Workspace } from "../../src/control-plane/workspace"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import { CommandThreads } from "../../src/agents/command-threads"
import { Routines } from "../../src/agents/routines"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Permission } from "@/permission"
import { KnowledgeVault } from "../../src/knowledge/vault"
import { Session } from "@/session/session"
import { PermissionV1 } from "@tenon/core/v1/permission"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// P9 · Routines (implementations/notes-command-centre/implementation.md, AC-9.1 … AC-9.4)

const appLayer = AppNodeBuilder.build(
  LayerNode.group([
    InstanceStore.node,
    Project.node,
    Session.node,
    Workspace.node,
    Database.node,
    Ripgrep.node,
    Permission.node,
    EventV2Bridge.node,
  ]),
  [
    [
      InstanceStore.bootstrapNode,
      Layer.succeed(InstanceBootstrapService.Service, InstanceBootstrapService.Service.of({ run: Effect.void })),
    ],
  ],
)
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  {
    disableListenLog: true,
    disableLogger: true,
  },
)
const it = testEffect(
  Layer.mergeAll(
    appLayer,
    servedRoutes.pipe(
      Layer.provide(layerWebSocketConstructorGlobal),
      Layer.provideMerge(NodeHttpServer.layerTest),
      Layer.provideMerge(NodeServices.layer),
    ),
    AppNodeBuilder.build(CrossSpawnSpawner.node),
  ),
)
const request = (route: string, init?: RequestInit) => {
  const url = new URL(route, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, init)).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}
const json = <T>(response: HttpClientResponse.HttpClientResponse) =>
  response.status >= 200 && response.status < 300
    ? response.json.pipe(Effect.map((value) => value as T))
    : response.text.pipe(Effect.flatMap((text) => Effect.die(new Error(`${response.status} ${text}`))))
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min)

describe("Routines.nextRun (AC-9.1)", () => {
  test("daily runs the next day once today's time has passed", () => {
    expect(Routines.nextRun("daily 08:30", local(2026, 11, 2, 9, 0)).getTime()).toBe(
      local(2026, 11, 3, 8, 30).getTime(),
    )
    expect(Routines.nextRun("daily 08:30", local(2026, 11, 2, 7, 0)).getTime()).toBe(
      local(2026, 11, 2, 8, 30).getTime(),
    )
  })
  test("weekdays skips the weekend", () => {
    // 6 Nov 2026 is a Friday.
    expect(Routines.nextRun("weekdays 17:30", local(2026, 11, 6, 18, 0)).getTime()).toBe(
      local(2026, 11, 9, 17, 30).getTime(),
    )
  })
  test("weekly picks the named day", () => {
    expect(Routines.nextRun("weekly mon 09:00", local(2026, 11, 3, 12, 0)).getTime()).toBe(
      local(2026, 11, 9, 9, 0).getTime(),
    )
  })
  test("five-field cron is supported", () => {
    expect(Routines.nextRun("*/15 * * * *", local(2026, 11, 2, 10, 7)).getTime()).toBe(
      local(2026, 11, 2, 10, 15).getTime(),
    )
  })
})

const setup = Effect.gen(function* () {
  const test = yield* TestInstance
  process.env.TENON_VAULT_DIR = yield* tmpdirScoped()
  const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
  const write = (name: string, properties: Record<string, unknown>, create = true) =>
    request(`/second-brain/vault/page?path=${encodeURIComponent(`Routines/${name}.md`)}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ body: `Prompt for ${name}`, properties, ...(create ? { create: true } : {}) }),
    }).pipe(Effect.flatMap(json<unknown>))
  // Pages run only once approved; approve what is there, as the Routines page does.
  const approveAll = Effect.gen(function* () {
    const routines = yield* request("/second-brain/routines", { headers }).pipe(Effect.flatMap(json<Routines.Info[]>))
    yield* Effect.forEach(routines, (routine) =>
      request(`/second-brain/routines/${routine.id}/approve`, {
        method: "POST",
        headers,
        body: JSON.stringify({ hash: routine.hash }),
      }).pipe(Effect.flatMap(json<unknown>)),
    )
  })
  const list = () =>
    request("/second-brain/routines", { headers }).pipe(
      Effect.flatMap(json<{ id: string; name: string; lastRun: string | null; lastStatus: string | null }[]>),
    )
  return { test, headers, write, approveAll, list }
})

/** The workspace's folder in the vault; a routine must have been written first. */
const vaultFolder = async () => {
  const root = process.env.TENON_VAULT_DIR!
  const [folder] = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith("."),
  )
  return path.join(root, folder.name)
}

afterEach(async () => {
  delete process.env.TENON_VAULT_DIR
  await disposeAllInstances()
  await resetDatabase()
})

describe("Routines", () => {
  it.instance("AC-9.2 routine pages are listed with their schedule and next run", () =>
    Effect.gen(function* () {
      const { headers, write } = yield* setup
      yield* write("Morning brief", { schedule: "weekdays 08:30", enabled: true })
      const routines = yield* request("/second-brain/routines", { headers }).pipe(
        Effect.flatMap(
          json<{ id: string; name: string; schedule: string; enabled: boolean; nextRun: string | number }[]>,
        ),
      )
      expect(routines).toHaveLength(1)
      expect(routines[0]).toMatchObject({ name: "Morning brief", schedule: "weekdays 08:30", enabled: true })
      expect(new Date(routines[0].nextRun).getTime()).toBeGreaterThan(Date.now() - 60_000)
    }),
  )

  it.instance("AC-9.3 missed runs catch up once; disabled routines never run", () =>
    Effect.gen(function* () {
      const { write, approveAll } = yield* setup
      yield* write("Daily", { schedule: "daily 08:00" })
      yield* write("Off", { schedule: "daily 08:00", enabled: false })
      yield* approveAll
      const ran: string[] = []
      const run = (routine: { id: string; name: string }) =>
        Effect.sync(() => {
          ran.push(routine.name)
          return { threadId: `ses_${ran.length}`, text: `Result ${ran.length}` }
        })
      const first = yield* Routines.runDue({ now: local(2026, 11, 2, 7, 0), run })
      expect(first.ran).toEqual([])
      const catchUp = yield* Routines.runDue({ now: local(2026, 11, 5, 9, 0), run })
      expect(catchUp.ran).toHaveLength(1)
      expect(ran).toEqual(["Daily"])
      const again = yield* Routines.runDue({ now: local(2026, 11, 5, 9, 0), run })
      expect(again.ran).toEqual([])
      const nextDay = yield* Routines.runDue({ now: local(2026, 11, 6, 8, 30), run })
      expect(nextDay.ran).toHaveLength(1)
      expect(ran).toEqual(["Daily", "Daily"])
    }),
  )

  it.instance("AC-9.4 results land in the Inbox page and announce routine.finished", () =>
    Effect.gen(function* () {
      const { headers, write, approveAll } = yield* setup
      yield* write("Brief", { schedule: "daily 08:00" })
      yield* approveAll
      const events: GlobalEvent[] = []
      const listen = (event: GlobalEvent) => {
        if (event.payload?.type === "routine.finished") events.push(event)
      }
      GlobalBus.on("event", listen)
      yield* Effect.gen(function* () {
        yield* Routines.runDue({
          now: local(2026, 11, 2, 7, 0),
          run: () => Effect.succeed({ threadId: "ses_x", text: "n/a" }),
        })
        yield* Routines.runDue({
          now: local(2026, 11, 2, 8, 5),
          run: () => Effect.succeed({ threadId: "ses_brief", text: "Two meetings today; one invoice to pay." }),
        })
      }).pipe(Effect.ensuring(Effect.sync(() => GlobalBus.off("event", listen))))
      expect(events).toHaveLength(1)
      expect(events[0].payload.properties).toMatchObject({ threadId: "ses_brief" })
      const inbox = yield* request("/second-brain/vault/page?path=Inbox.md", { headers }).pipe(
        Effect.flatMap(json<{ body: string }>),
      )
      expect(inbox.body).toContain("Two meetings today; one invoice to pay.")
    }),
  )

  it.instance("an interrupted run is marked failed at scheduler start and runs again", () =>
    Effect.gen(function* () {
      const { write, approveAll } = yield* setup
      yield* write("Slow", { schedule: "daily 08:00" })
      yield* approveAll
      yield* Routines.runDue({ now: local(2026, 11, 2, 7, 0), run: () => Effect.die("not due") })
      const started = yield* Deferred.make<void>()
      // The process "stops" mid-run: the run never answers and its fiber is interrupted.
      const fiber = yield* Routines.runDue({
        now: local(2026, 11, 2, 8, 5),
        run: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      }).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      // Read at the run's own time: from today's clock this run would be past its limit.
      const list = () => Routines.list(local(2026, 11, 2, 8, 6))
      expect((yield* list())[0]).toMatchObject({ lastRun: null, lastStatus: "running" })
      yield* Fiber.interrupt(fiber)
      yield* Routines.recoverInterrupted
      expect((yield* list())[0]).toMatchObject({ lastRun: null, lastStatus: "failed" })
      const retry = yield* Routines.runDue({
        now: local(2026, 11, 2, 8, 6),
        run: () => Effect.succeed({ threadId: "ses_retry", text: "Done" }),
      })
      expect(retry.ran).toHaveLength(1)
      expect((yield* list())[0].lastStatus).toBe("done")
    }),
  )

  it.instance("due routines run concurrently, and a routine in flight is not started twice", () =>
    Effect.gen(function* () {
      const { write, approveAll } = yield* setup
      yield* write("A", { schedule: "daily 08:00" })
      yield* write("B", { schedule: "daily 08:00" })
      yield* approveAll
      yield* Routines.runDue({ now: local(2026, 11, 2, 7, 0), run: () => Effect.die("not due") })
      const bDone = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const aStarted = yield* Deferred.make<void>()
      // A finishes only after B has run, so a serial loop over A then B would never finish.
      const run = (routine: { name: string }) =>
        routine.name === "A"
          ? Deferred.succeed(aStarted, undefined).pipe(
              Effect.andThen(Deferred.await(bDone)),
              Effect.andThen(Deferred.await(release)),
              Effect.as({ threadId: "ses_a", text: "A" }),
            )
          : Deferred.succeed(bDone, undefined).pipe(Effect.as({ threadId: "ses_b", text: "B" }))
      const fiber = yield* Routines.runDue({ now: local(2026, 11, 2, 8, 5), run }).pipe(Effect.forkChild)
      yield* Deferred.await(aStarted)
      yield* Deferred.await(bDone)
      // A later tick while A is still running starts nothing.
      const again = yield* Routines.runDue({ now: local(2026, 11, 2, 8, 6), run: () => Effect.die("double start") })
      expect(again.ran).toEqual([])
      yield* Deferred.succeed(release, undefined)
      const first = yield* Fiber.join(fiber)
      expect(first.ran).toHaveLength(2)
    }),
  )

  it.instance("routines are found past the vault's page limit, in only the workspaces that have them", () =>
    Effect.gen(function* () {
      const { list, write } = yield* setup
      yield* write("Recent", { schedule: "daily 08:00" })
      const folder = yield* Effect.promise(vaultFolder)
      yield* Effect.promise(async () => {
        // No updated_at, so a list cut to the newest 1,000 pages would drop it.
        await writeFile(path.join(folder, "Routines", "Old.md"), "---\nschedule: daily 09:00\n---\nOld prompt\n")
        await Promise.all(
          Array.from({ length: 1_001 }, (_, index) =>
            writeFile(path.join(folder, `page-${index}.md`), "---\nupdated_at: 2026-01-01T00:00:00.000Z\n---\nText\n"),
          ),
        )
      })
      expect((yield* list()).map((routine) => routine.name)).toEqual(["Old", "Recent"])

      const root = process.env.TENON_VAULT_DIR!
      const { id } = yield* Effect.promise(async () =>
        JSON.parse(await readFile(path.join(folder, "workspace.json"), "utf8")),
      )
      yield* Effect.promise(async () => {
        await mkdir(path.join(root, "Other", "routines"), { recursive: true })
        await writeFile(
          path.join(root, "Other", "workspace.json"),
          JSON.stringify({ version: 1, id: "lower", name: "Other" }),
        )
        await mkdir(path.join(root, "Plain"), { recursive: true })
        await writeFile(
          path.join(root, "Plain", "workspace.json"),
          JSON.stringify({ version: 1, id: "plain", name: "Plain" }),
        )
      })
      const found = yield* Effect.promise(() => KnowledgeVault.workspacesWithFolder(root, Routines.folder))
      expect([...found].sort()).toEqual([id, "lower"].sort())
    }),
  )

  it.instance("a check with nothing to record leaves the state file alone", () =>
    Effect.gen(function* () {
      const { write } = yield* setup
      yield* write("Quiet", { schedule: "daily 08:00" })
      const run = () => Effect.die("not due")
      yield* Routines.runDue({ now: local(2026, 11, 2, 7, 0), run })
      const file = path.join(Global.make().data, "routines-state.json")
      // A trailing space survives only if nothing rewrites the file.
      const marked = (yield* Effect.promise(() => readFile(file, "utf8"))) + " "
      yield* Effect.promise(() => writeFile(file, marked))
      yield* Routines.runDue({ now: local(2026, 11, 2, 7, 1), run })
      expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe(marked)
    }),
  )

  it.instance("a run past its timeout is marked failed", () =>
    Effect.gen(function* () {
      const { approveAll, list, write } = yield* setup
      yield* write("Hung", { schedule: "daily 08:00", timeout: 0.001 })
      yield* approveAll
      yield* Routines.runDue({ now: local(2026, 11, 2, 7, 0), run: () => Effect.die("not due") })
      const result = yield* Routines.runDue({ now: local(2026, 11, 2, 8, 5), run: () => Effect.never })
      expect(result.ran).toHaveLength(1)
      expect((yield* list())[0].lastStatus).toBe("failed")
    }),
  )

  it.instance("a run left running past its limit stops blocking the routine", () =>
    Effect.gen(function* () {
      const { approveAll, write } = yield* setup
      yield* write("Stuck", { schedule: "daily 08:00" })
      yield* approveAll
      yield* Routines.runDue({ now: local(2026, 11, 2, 7, 0), run: () => Effect.die("not due") })
      const started = yield* Deferred.make<void>()
      const fiber = yield* Routines.runDue({
        now: local(2026, 11, 2, 8, 5),
        run: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      }).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
      const run = () => Effect.succeed({ threadId: "ses_next", text: "Done" })
      const statusAt = (now: Date) => Routines.list(now).pipe(Effect.map((items) => items[0]?.lastStatus))
      expect(yield* statusAt(local(2026, 11, 2, 9, 0))).toBe("running")
      expect(yield* statusAt(local(2026, 11, 2, 11, 0))).toBe("failed")
      expect((yield* Routines.runDue({ now: local(2026, 11, 2, 9, 0), run })).ran).toEqual([])
      expect((yield* Routines.runDue({ now: local(2026, 11, 2, 11, 0), run })).ran).toHaveLength(1)
    }),
  )

  it.instance("Run now refuses a routine already in flight", () =>
    Effect.gen(function* () {
      const { approveAll, headers, list, write } = yield* setup
      yield* write("Busy", { schedule: "daily 08:00" })
      yield* approveAll
      const [routine] = yield* list()
      const release = yield* Deferred.make<void>()
      yield* Routines.runNow({
        id: routine.id,
        start: () =>
          Effect.succeed({ threadId: "ses_now", reply: Deferred.await(release).pipe(Effect.as({ text: "Done" })) }),
      })
      const second = yield* request(`/second-brain/routines/${routine.id}/run`, { method: "POST", headers, body: "{}" })
      expect(second.status).toBe(409)
      expect(yield* second.text).toContain("routine_running")
      yield* Deferred.succeed(release, undefined)
      while ((yield* list())[0].lastStatus === "running") yield* Effect.sleep("10 millis")
      expect((yield* list())[0].lastStatus).toBe("done")
    }),
  )

  it.instance("a full Inbox moves to an archive page, and a reply too big to file shows as unfiled", () =>
    Effect.gen(function* () {
      const { approveAll, headers, list, write } = yield* setup
      yield* write("Brief", { schedule: "daily 08:00" })
      yield* approveAll
      const old = "x".repeat(1024 * 1024)
      yield* request("/second-brain/vault/page?path=Inbox.md", {
        method: "PUT",
        headers,
        body: JSON.stringify({ body: old, create: true }),
      }).pipe(Effect.flatMap(json<unknown>))
      const page = (route: string) =>
        request(`/second-brain/vault/page?path=${encodeURIComponent(route)}`, { headers }).pipe(
          Effect.flatMap(json<{ body: string }>),
        )
      yield* Routines.runDue({ now: local(2026, 11, 2, 7, 0), run: () => Effect.die("not due") })
      yield* Routines.runDue({
        now: local(2026, 11, 2, 8, 5),
        run: () => Effect.succeed({ threadId: "ses_a", text: "Fresh reply" }),
      })
      const inbox = yield* page("Inbox.md")
      expect(inbox.body).toContain("Fresh reply")
      expect(inbox.body).not.toContain(old)
      expect((yield* page("Inbox/2026-11.md")).body).toContain(old)
      expect((yield* list())[0].lastStatus).toBe("done")

      yield* Routines.runDue({
        now: local(2026, 11, 3, 8, 5),
        run: () => Effect.succeed({ threadId: "ses_b", text: "y".repeat(6 * 1024 * 1024), denied: ["bash"] }),
      })
      expect((yield* list())[0]).toMatchObject({ lastStatus: "unfiled", denied: ["bash"] })
    }),
  )

  it.instance("re-enabling a routine moves its baseline, so it doesn't catch up at once", () =>
    Effect.gen(function* () {
      const { write, approveAll } = yield* setup
      yield* write("Toggle", { schedule: "daily 08:00" })
      yield* approveAll
      const ran: string[] = []
      const run = (routine: { name: string }) =>
        Effect.sync(() => {
          ran.push(routine.name)
          return { threadId: "ses_t", text: "ok" }
        })
      yield* Routines.runDue({ now: local(2026, 11, 2, 7, 0), run })
      yield* write("Toggle", { schedule: "daily 08:00", enabled: false }, false)
      yield* Routines.runDue({ now: local(2026, 11, 3, 9, 0), run })
      yield* write("Toggle", { schedule: "daily 08:00", enabled: true }, false)
      const enabled = yield* Routines.runDue({ now: local(2026, 11, 5, 9, 0), run })
      expect(enabled.ran).toEqual([])
      const next = yield* Routines.runDue({ now: local(2026, 11, 6, 8, 1), run })
      expect(next.ran).toHaveLength(1)
      expect(ran).toEqual(["Toggle"])
    }),
  )

  it.instance("a page runs only once approved, and an edit needs approving again", () =>
    Effect.gen(function* () {
      const { headers, write, approveAll } = yield* setup
      yield* write("Brief", { schedule: "daily 08:00" })
      const ran: string[] = []
      const run = (routine: { name: string }) =>
        Effect.sync(() => {
          ran.push(routine.name)
          return { threadId: "ses_b", text: "ok", denied: ["bash"] }
        })
      const list = () => request("/second-brain/routines", { headers }).pipe(Effect.flatMap(json<Routines.Info[]>))
      const [listed] = yield* list()
      expect(listed.needsApproval).toBe(true)
      yield* Routines.runDue({ now: local(2026, 11, 2, 7, 0), run })
      yield* Routines.runDue({ now: local(2026, 11, 3, 9, 0), run })
      expect(ran).toEqual([])
      const runNow = yield* request(`/second-brain/routines/${listed.id}/run`, {
        method: "POST",
        headers,
        body: "{}",
      })
      expect(runNow.status).toBe(409)
      expect(yield* runNow.text).toContain("routine_needs_approval")
      expect(Routines.isRoutinePath("routines/Brief.md")).toBe(true)
      expect(Routines.isRoutinePath("Routines.md")).toBe(false)

      yield* write("Brief", { schedule: "daily 09:00" }, false)
      const stale = yield* request(`/second-brain/routines/${listed.id}/approve`, {
        method: "POST",
        headers,
        body: JSON.stringify({ hash: listed.hash }),
      })
      expect(stale.status).toBe(409)

      // Approving takes the next check as the baseline, so a missed time doesn't run at once.
      yield* approveAll
      expect((yield* list())[0].needsApproval).toBe(false)
      yield* Routines.runDue({ now: local(2026, 11, 4, 8, 0), run })
      expect(ran).toEqual([])
      yield* Routines.runDue({ now: local(2026, 11, 4, 9, 5), run })
      expect(ran).toEqual(["Brief"])
      expect((yield* list())[0].denied).toEqual(["bash"])

      yield* write("Brief", { schedule: "daily 09:00", enabled: false }, false)
      expect((yield* list())[0].needsApproval).toBe(false)
      yield* write("Brief", { schedule: "daily 09:30" }, false)
      expect((yield* list())[0].needsApproval).toBe(true)
      yield* approveAll
      yield* write("Brief", { schedule: "daily 09:30", timeout: 600 }, false)
      expect((yield* list())[0].needsApproval).toBe(true)
    }),
  )

  it.instance("an unattended run answers no to its thread's and subagents' prompts, and only those", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const permission = yield* Permission.Service
      const thread = yield* sessions.create({ title: "run" })
      const child = yield* sessions.create({ title: "subagent", parentID: thread.id })
      const other = yield* sessions.create({ title: "someone else's" })
      const ask = (sessionID: typeof thread.id, name: string) =>
        permission.ask({ sessionID, permission: name, patterns: ["*"], metadata: {}, always: [], ruleset: [] })
      const watch = yield* CommandThreads.refusePrompts(thread.id)
      expect(yield* ask(thread.id, "bash").pipe(Effect.flip)).toBeInstanceOf(PermissionV1.CorrectedError)
      expect(yield* ask(child.id, "webfetch").pipe(Effect.flip)).toBeInstanceOf(PermissionV1.CorrectedError)
      const untouched = yield* ask(other.id, "edit").pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect((yield* permission.list()).map((item) => item.permission)).toEqual(["edit"])
      expect([...watch.denied]).toEqual(["bash", "webfetch"])
      yield* watch.stop
      yield* Fiber.interrupt(untouched)
    }),
  )
})
