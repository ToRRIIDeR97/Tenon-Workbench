import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/http"
import { layerWebSocketConstructorGlobal } from "effect/socket/Socket"
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
import { AgentAppTools } from "../../src/agents/app-tools"
import { CommandActionLog } from "../../src/agents/command-action-log"
import { CommandActions } from "../../src/agents/command-actions"
import { CommandMemory } from "../../src/agents/command-memory"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstanceEffect, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

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
  { disableListenLog: true, disableLogger: true },
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

const actions = (headers: Record<string, string>, since?: number) =>
  HttpClientRequest.get("/command-centre/actions").pipe(
    HttpClientRequest.setHeaders(headers),
    since === undefined ? (value) => value : HttpClientRequest.setUrlParam("since", String(since)),
    HttpClient.execute,
    Effect.flatMap(json<CommandActions.Action[]>),
  )

type Result = { isError: boolean; value: unknown }
type Overview = { threads: { id: string; title: string; project: string; projectId?: string; state: string }[] }

const say = (sessionID: SessionID, role: "user" | "assistant", text: string) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const id = MessageID.ascending()
    yield* sessions.updateMessage(
      (role === "user"
        ? {
            id,
            sessionID,
            role,
            time: { created: Date.now() },
            agent: "test",
            model: { providerID: "test", modelID: "test" },
            tools: {},
            mode: "",
          }
        : {
            id,
            sessionID,
            role,
            time: { created: Date.now() },
            parentID: id,
            modelID: "test",
            providerID: "test",
            mode: "",
            agent: "default",
            path: { cwd: "/", root: "/" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          }) as never,
    )
    yield* sessions.updatePart({ id: PartID.ascending(), sessionID, messageID: id, type: "text", text })
  })

const setup = Effect.gen(function* () {
  const test = yield* TestInstance
  const root = yield* tmpdirScoped()
  process.env.TENON_VAULT_DIR = root
  const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
  const commandDirectory = yield* CommandMemory.directory()
  const project = yield* request("/second-brain/projects", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Alpha", outcome: "x" }),
  }).pipe(Effect.flatMap(json<{ id: string; location?: { path?: string } }>))
  const folder = path.join(test.directory, project.location?.path ?? "projects/Alpha")
  yield* Effect.promise(() => mkdir(folder, { recursive: true }))
  const command = yield* Session.use.create({ title: "Command" }).pipe(provideInstanceEffect(commandDirectory))
  const other = yield* Session.use.create({ title: "Other command" }).pipe(provideInstanceEffect(commandDirectory))
  const alpha = yield* Session.use.create({ title: "Alpha sync" }).pipe(provideInstanceEffect(folder))
  const general = yield* Session.use.create({ title: "General notes" }).pipe(provideInstanceEffect(test.directory))
  const elsewhere = yield* tmpdirScoped()
  const stray = yield* Session.use.create({ title: "Stray" }).pipe(provideInstanceEffect(elsewhere))
  const call = (name: string, args: Record<string, unknown>, caller = command.id) =>
    AgentAppTools.call(name, { workspace: test.directory, ...args }, { sessionID: caller }) as Effect.Effect<
      Result,
      never,
      never
    >
  return { test, root, headers, project, command, other, alpha, general, stray, call }
})

afterEach(async () => {
  delete process.env.TENON_VAULT_DIR
  await disposeAllInstances()
  await resetDatabase()
})

describe("Command Centre thread tools", () => {
  it.instance("threads_overview lists the root threads of every Project and the General group", () =>
    Effect.gen(function* () {
      const { project, command, alpha, general, call } = yield* setup
      const result = yield* call("threads_overview", {})
      expect(result.isError).toBe(false)
      const threads = (result.value as Overview).threads
      expect(threads.map((thread) => thread.id).toSorted()).toEqual([alpha.id, general.id].toSorted())
      const byID = new Map(threads.map((thread) => [thread.id as string, thread]))
      expect(byID.get(alpha.id)).toMatchObject({ title: "Alpha sync", project: "Alpha", projectId: project.id })
      expect(byID.get(general.id)).toMatchObject({ title: "General notes", project: "General" })
      expect(byID.get(alpha.id)?.state).toBe("idle")
      expect(threads.map((thread) => thread.id)).not.toContain(command.id)

      const only = (yield* call("threads_overview", { projectId: project.id })).value as Overview
      expect(only.threads.map((thread) => thread.id)).toEqual([alpha.id])
      expect((yield* call("threads_overview", { projectId: "project_missing" })).isError).toBe(true)
    }),
  )

  it.instance("threads_overview lists every Project's id, threads or not, for delegate_to_project's project_id", () =>
    Effect.gen(function* () {
      const { project, headers, call } = yield* setup
      const empty = yield* request("/second-brain/projects", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Beta", outcome: "y" }),
      }).pipe(Effect.flatMap(json<{ id: string }>))
      const overview = (yield* call("threads_overview", {})).value as Overview & {
        projects: { id: string; name: string; folder: string }[]
      }
      expect(overview.projects.map((item) => item.id).toSorted()).toEqual([project.id, empty.id].toSorted())
      expect(overview.projects.find((item) => item.id === empty.id)).toMatchObject({ name: "Beta" })
      expect(overview.threads.some((thread) => thread.projectId === empty.id)).toBe(false)
    }),
  )

  it.instance("project_id takes a Project's id, or its exact name when no other Project has it", () =>
    Effect.gen(function* () {
      const { project, headers, command, alpha } = yield* setup
      const folder = (id: string) => AgentAppTools.projectFolder({ sessionID: command.id }, id)
      expect(yield* folder(project.id)).toMatchObject({ name: "Alpha" })
      expect((yield* folder(" alpha "))?.directory).toBe((yield* folder(project.id))?.directory)
      expect((yield* folder("alpha"))?.directory.toLowerCase()).toBe(path.resolve(alpha.directory).toLowerCase())
      expect(yield* folder("Gamma")).toBeUndefined()
      const second = yield* tmpdirScoped()
      const twin = yield* request("/second-brain/projects", {
        method: "POST",
        headers: { ...headers, "x-opencode-directory": second },
        body: JSON.stringify({ name: "alpha", outcome: "z" }),
      }).pipe(Effect.flatMap(json<{ id: string; location?: { path?: string } }>))
      const twinFolder = path.join(second, twin.location?.path ?? "projects/alpha")
      yield* Effect.promise(() => mkdir(twinFolder, { recursive: true }))
      yield* Session.use.create({ title: "Twin" }).pipe(provideInstanceEffect(twinFolder))
      expect(yield* folder(twin.id)).toMatchObject({ name: "alpha" })
      expect(yield* folder("Alpha")).toBeUndefined()
      expect(yield* folder(project.id)).toMatchObject({ name: "Alpha" })
    }),
  )

  it.instance("thread_read returns a thread's latest messages as text", () =>
    Effect.gen(function* () {
      const { alpha, call } = yield* setup
      yield* say(alpha.id, "user", "Retry the sync twice.").pipe(provideInstanceEffect(alpha.directory))
      yield* say(alpha.id, "assistant", "Retried; both attempts failed.").pipe(provideInstanceEffect(alpha.directory))
      const result = yield* call("thread_read", { threadId: alpha.id })
      expect(result.isError).toBe(false)
      const read = result.value as { text: string; title: string; project: string }
      expect(read.title).toBe("Alpha sync")
      expect(read.project).toBe("Alpha")
      expect(read.text).toContain("USER:\nRetry the sync twice.")
      expect(read.text).toContain("ASSISTANT:\nRetried; both attempts failed.")
    }),
  )

  it.instance("thread_read caps what it returns", () =>
    Effect.gen(function* () {
      const { alpha, call } = yield* setup
      for (let index = 0; index < 10; index++)
        yield* say(alpha.id, "user", `${index}:${"x".repeat(1_900)}`).pipe(provideInstanceEffect(alpha.directory))
      const read = (yield* call("thread_read", { threadId: alpha.id })).value as { text: string; omitted: number }
      expect(read.text.length).toBeLessThanOrEqual(12_000 + 100)
      expect(read.omitted).toBeGreaterThan(0)
      expect(read.text).toContain("9:")
    }),
  )

  it.instance("refuse a thread outside the workspace, a Command Centre thread and the caller's own", () =>
    Effect.gen(function* () {
      const { command, other, stray, call } = yield* setup
      for (const name of ["thread_read", "thread_message", "thread_stop"]) {
        for (const target of [stray, other, command]) {
          const result = yield* call(name, { threadId: target.id, text: "hello" })
          expect(`${name} ${target.title}: ${result.isError}`).toBe(`${name} ${target.title}: true`)
        }
      }
      expect(String((yield* call("thread_stop", { threadId: command.id })).value)).toContain("own thread")
      expect(String((yield* call("thread_stop", { threadId: other.id })).value)).toContain("Command Centre thread")
      expect(String((yield* call("thread_read", { threadId: stray.id })).value)).toContain("root threads")
      expect(String((yield* call("thread_read", { threadId: "ses_missing" })).value)).toContain("doesn't exist")
      expect(yield* CommandActionLog.read).toEqual([])
    }),
  )

  it.instance("refuse a subagent thread and an archived thread of a Project", () =>
    Effect.gen(function* () {
      const { alpha, call } = yield* setup
      const child = yield* Session.use
        .create({ title: "Subagent", parentID: alpha.id })
        .pipe(provideInstanceEffect(alpha.directory))
      expect((yield* call("thread_read", { threadId: child.id })).isError).toBe(true)
      yield* Session.use
        .setArchived({ sessionID: alpha.id, time: Date.now() })
        .pipe(provideInstanceEffect(alpha.directory))
      expect((yield* call("thread_read", { threadId: alpha.id })).isError).toBe(true)
    }),
  )

  it.instance("a Project thread is not given the thread tools and cannot call them", () =>
    Effect.gen(function* () {
      const { alpha, general, call } = yield* setup
      for (const caller of [alpha, general]) {
        const names = AgentAppTools.list({ sessionID: caller.id }).map((tool) => tool.name)
        expect(names).not.toContain("thread_message")
        const result = yield* call("thread_stop", { threadId: general.id }, caller.id)
        expect(result.isError).toBe(true)
        expect(String(result.value)).toContain("only available in the Command Centre")
      }
      expect(yield* CommandActionLog.read).toEqual([])
    }),
  )

  it.instance("thread_message and thread_stop append to a log that is kept in the Command Centre's folder", () =>
    Effect.gen(function* () {
      const { root, headers, command, alpha, general, call } = yield* setup
      const sent = yield* call("thread_message", { threadId: alpha.id, text: "  Use the staging database.  " })
      expect(sent.isError).toBe(false)
      const stopped = yield* call("thread_stop", { threadId: general.id })
      expect(stopped.isError).toBe(false)

      const log = yield* CommandActionLog.read
      expect(log.map((action) => action.kind)).toEqual(["stop", "message"])
      expect(log[1]).toMatchObject({
        sessionID: alpha.id,
        title: "Alpha sync",
        project: "Alpha",
        text: "Use the staging database.",
        by: command.id,
      })
      expect(log[0]).toMatchObject({ sessionID: general.id, title: "General notes", by: command.id })
      expect(log[0].project).toBeUndefined()
      expect(log[0].text).toBeUndefined()

      const file = path.join(root, ".command-centre", "actions.json")
      const stored = JSON.parse(yield* Effect.promise(() => readFile(file, "utf8"))) as CommandActions.Action[]
      expect(stored.map((action) => action.id)).toEqual(log.map((action) => action.id))

      const all = yield* actions(headers)
      expect(all.map((action) => action.id)).toEqual(log.map((action) => action.id))
      const recent = yield* actions(headers, log[0].at)
      expect(recent.map((action) => action.id)).toEqual(CommandActions.since(log, log[0].at).map((action) => action.id))
      const none = yield* actions(headers, log[0].at + 1)
      expect(none).toEqual([])
    }),
  )

  it.instance("refuse threads in a child folder, a string-prefix sibling and the parent of the workspace", () =>
    Effect.gen(function* () {
      const { test, alpha, call } = yield* setup
      const folder = alpha.directory
      const outside = {
        "child folder of a Project": path.join(folder, "child"),
        "sibling whose path starts with the Project's": `${folder}-old`,
        "parent of the workspace": path.dirname(test.directory),
        "folder inside the workspace that is no Project's": path.join(test.directory, "notes"),
      }
      const stray = yield* Effect.forEach(Object.entries(outside), ([label, directory]) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => mkdir(directory, { recursive: true }))
          return {
            label,
            session: yield* Session.use.create({ title: label }).pipe(provideInstanceEffect(directory)),
          }
        }),
      )
      for (const item of stray) {
        for (const name of ["thread_read", "thread_message", "thread_stop"]) {
          const result = yield* call(name, { threadId: item.session.id, text: "hello" })
          expect(`${name} ${item.label}: ${result.isError}`).toBe(`${name} ${item.label}: true`)
          expect(String(result.value)).toContain("root threads")
        }
        expect(
          yield* Session.use
            .messages({ sessionID: item.session.id })
            .pipe(provideInstanceEffect(item.session.directory)),
        ).toEqual([])
      }
      expect(yield* CommandActionLog.read).toEqual([])
      expect((yield* call("thread_read", { threadId: alpha.id })).isError).toBe(false)
    }),
  )

  it.instance("a Project folder spelled with other separators or a trailing separator is still reached", () =>
    Effect.gen(function* () {
      const { alpha, call } = yield* setup
      const spellings = [`${alpha.directory}${path.sep}`, alpha.directory.replaceAll(path.sep, "/")]
      for (const spelling of spellings) {
        const thread = yield* Session.use.create({ title: `spelled ${spelling}` }).pipe(provideInstanceEffect(spelling))
        const read = yield* call("thread_read", { threadId: thread.id })
        expect(`${spelling}: ${read.isError} ${String(read.value)}`).toBe(`${spelling}: false ${String(read.value)}`)
        expect(read.value).toMatchObject({ project: "Alpha" })
      }
    }),
  )

  it.instance("a file that is not a valid log is kept aside and the tools still work", () =>
    Effect.gen(function* () {
      const { root, alpha, call } = yield* setup
      const file = path.join(root, ".command-centre", "actions.json")
      const asides = () =>
        Effect.promise(() => readdir(path.dirname(file))).pipe(
          Effect.map((names) => names.filter((name) => name.startsWith("actions.json.corrupt-"))),
        )
      for (const [index, content] of ["{ this is not json", JSON.stringify([{ id: 1 }])].entries()) {
        yield* Effect.promise(() => writeFile(file, content))
        const result = yield* call("thread_message", { threadId: alpha.id, text: `after ${index}` })
        expect(result.isError).toBe(false)
        const stored = JSON.parse(yield* Effect.promise(() => readFile(file, "utf8"))) as CommandActions.Action[]
        expect(stored.map((action) => action.text)).toEqual([`after ${index}`])
        const names = yield* asides()
        expect(names).toHaveLength(index + 1)
        const kept = yield* Effect.promise(() =>
          Promise.all(names.map((name) => readFile(path.join(path.dirname(file), name), "utf8"))),
        )
        expect(kept).toContain(content)
        yield* Effect.sleep("5 millis")
      }
    }),
  )

  it.instance("a missing log starts empty, and one that cannot be read is never overwritten", () =>
    Effect.gen(function* () {
      const { root, alpha, general, call } = yield* setup
      const file = path.join(root, ".command-centre", "actions.json")
      expect(yield* CommandActionLog.read).toEqual([])
      expect((yield* call("thread_stop", { threadId: alpha.id })).isError).toBe(false)
      expect((yield* CommandActionLog.read).map((action) => action.kind)).toEqual(["stop"])

      yield* Effect.promise(() => rm(file))
      yield* Effect.promise(() => mkdir(file))
      const result = yield* call("thread_stop", { threadId: general.id })
      expect(result.isError).toBe(false)
      expect((yield* Effect.promise(() => stat(file))).isDirectory()).toBe(true)
      expect((yield* Effect.promise(() => readdir(path.dirname(file)))).some((name) => name.includes("corrupt"))).toBe(
        false,
      )
    }),
  )

  it.instance("thread_message needs text and a thread id", () =>
    Effect.gen(function* () {
      const { alpha, call } = yield* setup
      expect((yield* call("thread_message", { threadId: alpha.id, text: "   " })).isError).toBe(true)
      expect((yield* call("thread_message", { text: "hi" })).isError).toBe(true)
      expect((yield* call("thread_stop", {})).isError).toBe(true)
      expect(yield* CommandActionLog.read).toEqual([])
    }),
  )
})
