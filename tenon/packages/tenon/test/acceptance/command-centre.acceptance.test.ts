import { afterEach, describe, expect, test as bunTest } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Config, Effect, Layer } from "effect"
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
import { AgentAppTools } from "../../src/agents/app-tools"
import { CommandMemory } from "../../src/agents/command-memory"
import { CommandThreads } from "../../src/agents/command-threads"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstanceEffect, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// P7 · Command Centre (implementations/notes-command-centre/implementation.md, AC-7.2, AC-7.5, AC-7.6)

const appLayer = AppNodeBuilder.build(
  LayerNode.group([InstanceStore.node, Project.node, Session.node, Workspace.node, Database.node, Ripgrep.node]),
  [[InstanceStore.bootstrapNode, Layer.succeed(InstanceBootstrapService.Service, InstanceBootstrapService.Service.of({ run: Effect.void }))]],
)
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(HttpApiApp.routes, {
  disableListenLog: true,
  disableLogger: true,
})
const it = testEffect(
  Layer.mergeAll(
    appLayer,
    servedRoutes.pipe(Layer.provide(layerWebSocketConstructorGlobal), Layer.provideMerge(NodeHttpServer.layerTest), Layer.provideMerge(NodeServices.layer)),
    AppNodeBuilder.build(CrossSpawnSpawner.node),
  ),
)
const request = (route: string, init?: RequestInit) => {
  const url = new URL(route, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, init)).pipe(HttpClientRequest.setUrl(url.pathname), HttpClient.execute)
}
const json = <T>(response: HttpClientResponse.HttpClientResponse) =>
  response.status >= 200 && response.status < 300
    ? response.json.pipe(Effect.map((value) => value as T))
    : response.text.pipe(Effect.flatMap((text) => Effect.die(new Error(`${response.status} ${text}`))))
type Result = { isError: boolean; value: unknown }
const DAY = 24 * 60 * 60 * 1000

const say = (sessionID: SessionID, text: string) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const id = MessageID.ascending()
    yield* sessions.updateMessage({
      id,
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "test",
      model: { providerID: "test", modelID: "test" },
      tools: {},
      mode: "",
    } as never)
    yield* sessions.updatePart({ id: PartID.ascending(), sessionID, messageID: id, type: "text", text })
  })

const setup = Effect.gen(function* () {
  const test = yield* TestInstance
  const root = yield* tmpdirScoped()
  process.env.TENON_VAULT_DIR = root
  const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
  const commandDirectory = yield* CommandMemory.directory()
  yield* Effect.promise(() => mkdir(commandDirectory, { recursive: true }))
  const project = yield* request("/second-brain/projects", { method: "POST", headers, body: JSON.stringify({ name: "Acme API", outcome: "x" }) }).pipe(
    Effect.flatMap(json<{ id: string; location?: { path?: string } }>),
  )
  const projectFolder = path.join(test.directory, project.location?.path ?? "projects/Acme API")
  yield* Effect.promise(() => mkdir(projectFolder, { recursive: true }))
  const command = yield* Session.use.create({ title: "Billing webhook plan" }).pipe(provideInstanceEffect(commandDirectory))
  yield* say(command.id, "Retry the billing webhook twice.").pipe(provideInstanceEffect(commandDirectory))
  const projectThread = yield* Session.use.create({ title: "Cookie migration" }).pipe(provideInstanceEffect(projectFolder))
  return { test, root, headers, project, commandDirectory, command, projectThread }
})

afterEach(async () => {
  delete process.env.TENON_VAULT_DIR
  await disposeAllInstances()
  await resetDatabase()
})

describe("Command Centre", () => {
  it.instance("AC-7.2 Command Centre threads live in the vault's .command-centre folder, not in project threads", () =>
    Effect.gen(function* () {
      const { root, headers, commandDirectory } = yield* setup
      expect(path.resolve(commandDirectory)).toBe(path.resolve(root, ".command-centre"))
      const threads = yield* request("/second-brain/project-threads", { headers }).pipe(
        Effect.flatMap(json<{ threadDirectory: string; rootSessionCount: number }[]>),
      )
      for (const entry of threads) expect(path.resolve(entry.threadDirectory)).not.toBe(path.resolve(commandDirectory))
    }),
  )

  it.instance("AC-7.5 memory search finds Command Centre threads; compaction summarises old ones then deletes them", () =>
    Effect.gen(function* () {
      const { command, projectThread } = yield* setup
      const before = yield* CommandMemory.search("billing webhook")
      expect(before.some((hit) => hit.sessionID === command.id)).toBe(true)
      expect(before.some((hit) => hit.sessionID === projectThread.id)).toBe(false)

      const summarised: string[] = []
      const now = Date.now() + 50 * DAY
      const result = yield* CommandMemory.compact({
        now,
        days: 45,
        summarize: (thread) => {
          summarised.push(thread.sessionID)
          return Effect.succeed(`Summary: ${thread.title}`)
        },
      })
      expect(result).toMatchObject({ summarised: 1, deleted: 1 })
      expect(summarised).toEqual([command.id])
      const gone = yield* Session.use.get(command.id).pipe(Effect.exit)
      expect(gone._tag).toBe("Failure")
      const kept = yield* Session.use.get(projectThread.id)
      expect(kept.id).toBe(projectThread.id)
      const after = yield* CommandMemory.search("billing webhook")
      expect(after.some((hit) => hit.text.includes("Summary: Billing webhook plan"))).toBe(true)

      const again = yield* CommandMemory.compact({ now, days: 45, summarize: () => Effect.succeed("x") })
      expect(again).toMatchObject({ summarised: 0, deleted: 0 })
    }),
  )

  it.instance("compaction keeps a thread with no text, and memory search runs during a model call", () =>
    Effect.gen(function* () {
      const { commandDirectory } = yield* setup
      const empty = yield* Session.use.create({ title: "Nothing said" }).pipe(provideInstanceEffect(commandDirectory))
      const result = yield* CommandMemory.compact({
        now: Date.now() + 50 * DAY,
        days: 45,
        // A search that waited for the compaction to end would hang here.
        summarize: (thread) => CommandMemory.search("billing").pipe(Effect.as(`Summary: ${thread.title}`)),
      })
      expect(result).toMatchObject({ summarised: 1, deleted: 1 })
      expect((yield* Session.use.get(empty.id)).id).toBe(empty.id)
    }),
  )

  bunTest("a long thread reaches the summariser as its start and end", () => {
    expect(CommandThreads.excerpt("short", 100)).toBe("short")
    const text = CommandThreads.excerpt(`start${"x".repeat(1_000)}end`, 200)
    expect(text.length).toBeLessThanOrEqual(200)
    expect(text.startsWith("start")).toBe(true)
    expect(text.endsWith("end")).toBe(true)
  })

  it.instance("AC-7.5 the memory routes search and compact", () =>
    Effect.gen(function* () {
      const { headers } = yield* setup
      const hits = yield* request("/command-centre/memory?search=billing", { headers }).pipe(Effect.flatMap(json<{ text: string }[]>))
      expect(hits.length).toBeGreaterThan(0)
      const compacted = yield* request("/command-centre/memory/compact", { method: "POST", headers, body: JSON.stringify({ days: 45 }) }).pipe(
        Effect.flatMap(json<{ summarised: number; deleted: number }>),
      )
      // Nothing is older than 45 days yet.
      expect(compacted).toMatchObject({ summarised: 0, deleted: 0 })
    }),
  )

  it.instance("AC-7.6 the Command Centre agent gets memory and setup tools and writes across Projects", () =>
    Effect.gen(function* () {
      const { project, command, projectThread } = yield* setup
      const commandTools = AgentAppTools.list({ sessionID: command.id }).map((tool) => tool.name)
      expect(commandTools).toContain("memory_search")
      expect(commandTools).toContain("project_setup")
      const projectTools = AgentAppTools.list({ sessionID: projectThread.id }).map((tool) => tool.name)
      expect(projectTools).not.toContain("project_setup")
      const write = (yield* AgentAppTools.call(
        "notes_write",
        { path: "From command.md", body: "cross-project", projectId: project.id, create: true },
        { sessionID: command.id },
      )) as Result
      expect(write.isError).toBe(false)
    }),
  )

  it.instance("AC-7.6 project_setup creates a git folder from the templates, a Project card and an empty timeline", () =>
    Effect.gen(function* () {
      const { test, headers, command } = yield* setup
      const folder = path.join(test.directory, "field-notes")
      const result = (yield* AgentAppTools.call(
        "project_setup",
        { workspace: test.directory, name: "Field notes app", folder },
        { sessionID: command.id },
      )) as Result
      expect(result.isError).toBe(false)
      const entries = yield* Effect.promise(() => readdir(folder))
      expect(entries).toContain(".git")
      expect(entries).toContain("AGENTS.md")
      const agents = yield* Effect.promise(() => readFile(path.join(folder, "AGENTS.md"), "utf8"))
      for (const skill of ["tor-project-setup", "tor-implementation", "tor-feature-map-verification", "tor-workflow"])
        expect(agents).toContain(skill)
      yield* Effect.promise(() => readFile(path.join(folder, "docs", "system.md"), "utf8"))
      yield* Effect.promise(() => readFile(path.join(folder, "docs", "security.md"), "utf8"))
      const projects = yield* request("/second-brain/projects", { headers }).pipe(Effect.flatMap(json<{ id: string; name: string }[]>))
      const created = projects.find((item) => item.name === "Field notes app")
      expect(created).toBeDefined()
      const timeline = yield* request(`/second-brain/vault/timeline?project=${created!.id}`, { headers }).pipe(
        Effect.flatMap(json<{ items: unknown[] }>),
      )
      expect(timeline.items).toEqual([])

      const busy = path.join(test.directory, "busy")
      yield* Effect.promise(async () => {
        await mkdir(busy, { recursive: true })
        await writeFile(path.join(busy, "keep.txt"), "mine")
      })
      const refused = (yield* AgentAppTools.call(
        "project_setup",
        { workspace: test.directory, name: "Busy", folder: busy },
        { sessionID: command.id },
      )) as Result
      expect(refused.isError).toBe(true)
      expect(yield* Effect.promise(() => readdir(busy))).toEqual(["keep.txt"])

      // A folder that can't be listed is refused, not treated as missing and later removed.
      const file = path.join(test.directory, "a-file")
      yield* Effect.promise(() => writeFile(file, "mine"))
      const unreadable = (yield* AgentAppTools.call(
        "project_setup",
        { workspace: test.directory, name: "Unreadable", folder: file },
        { sessionID: command.id },
      )) as Result
      expect(unreadable.isError).toBe(true)
      expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe("mine")
    }),
  )

  it.instance("AC-7.6 a Project card that can't be written removes only a folder setup created", () =>
    Effect.gen(function* () {
      const { test, command } = yield* setup
      const setUp = (folder: string) =>
        AgentAppTools.call(
          "project_setup",
          { workspace: test.directory, name: "Acme API", folder },
          { sessionID: command.id },
        ).pipe(Effect.exit)
      const fresh = path.join(test.directory, "fresh")
      yield* setUp(fresh)
      expect(yield* Effect.promise(() => readdir(fresh).catch(() => "removed"))).toBe("removed")

      const empty = path.join(test.directory, "empty")
      yield* Effect.promise(() => mkdir(empty))
      yield* setUp(empty)
      yield* Effect.promise(() => readdir(empty))
    }),
  )
})
