import { afterEach, describe, expect, test } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Config, Deferred, Effect, Fiber, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { CrossSpawnSpawner } from "@tenon/core/cross-spawn-spawner"
import { Database } from "@tenon/core/database/database"
import { Ripgrep } from "@tenon/core/ripgrep"
import { Workspace } from "../../src/control-plane/workspace"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import { Routines } from "../../src/agents/routines"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// P9 · Routines (implementations/notes-command-centre/implementation.md, AC-9.1 … AC-9.4)

const appLayer = AppNodeBuilder.build(
  LayerNode.group([InstanceStore.node, Project.node, Session.node, Workspace.node, Database.node, Ripgrep.node]),
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
  return { test, headers, write }
})

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
      const { write } = yield* setup
      yield* write("Daily", { schedule: "daily 08:00" })
      yield* write("Off", { schedule: "daily 08:00", enabled: false })
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
      const { headers, write } = yield* setup
      yield* write("Brief", { schedule: "daily 08:00" })
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
      const { headers, write } = yield* setup
      yield* write("Slow", { schedule: "daily 08:00" })
      yield* Routines.runDue({ now: local(2026, 11, 2, 7, 0), run: () => Effect.die("not due") })
      const started = yield* Deferred.make<void>()
      // The process "stops" mid-run: the run never answers and its fiber is interrupted.
      const fiber = yield* Routines.runDue({
        now: local(2026, 11, 2, 8, 5),
        run: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      }).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const list = () =>
        request("/second-brain/routines", { headers }).pipe(
          Effect.flatMap(json<{ lastRun: string | null; lastStatus: string | null }[]>),
        )
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
      const { write } = yield* setup
      yield* write("A", { schedule: "daily 08:00" })
      yield* write("B", { schedule: "daily 08:00" })
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

  it.instance("re-enabling a routine moves its baseline, so it doesn't catch up at once", () =>
    Effect.gen(function* () {
      const { write } = yield* setup
      yield* write("Toggle", { schedule: "daily 08:00" })
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
})
