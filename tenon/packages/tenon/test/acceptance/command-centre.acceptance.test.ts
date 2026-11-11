import { afterEach, describe, expect, spyOn, test as bunTest } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { Config, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/http"
import { layerWebSocketConstructorGlobal } from "effect/socket/Socket"
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
  const project = yield* request("/second-brain/projects", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Acme API", outcome: "x" }),
  }).pipe(Effect.flatMap(json<{ id: string; location?: { path?: string } }>))
  const projectFolder = path.join(test.directory, project.location?.path ?? "projects/Acme API")
  yield* Effect.promise(() => mkdir(projectFolder, { recursive: true }))
  const command = yield* Session.use
    .create({ title: "Billing webhook plan" })
    .pipe(provideInstanceEffect(commandDirectory))
  yield* say(command.id, "Retry the billing webhook twice.").pipe(provideInstanceEffect(commandDirectory))
  const projectThread = yield* Session.use
    .create({ title: "Cookie migration" })
    .pipe(provideInstanceEffect(projectFolder))
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

  it.instance(
    "AC-7.5 memory search finds Command Centre threads; compaction summarises old ones then deletes them",
    () =>
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

  it.instance("an earlier root reached through a link matches once its real path is known", () =>
    Effect.gen(function* () {
      const { headers } = yield* setup
      yield* request("/second-brain/vault", { headers }).pipe(Effect.flatMap(json))
      const file = path.join(Global.make().data, "vault-machine.json")
      const before = yield* Effect.promise(() => readFile(file, "utf8"))
      const target = yield* tmpdirScoped()
      const parent = yield* tmpdirScoped()
      const link = path.join(parent, "earlier-root")
      const real = path.join(yield* Effect.promise(() => realpath(target)), ".command-centre")
      yield* Effect.promise(() => mkdir(real, { recursive: true }))
      yield* Effect.promise(() => symlink(target, link, "junction"))
      const machine = JSON.parse(before)
      yield* Effect.promise(() =>
        writeFile(file, JSON.stringify({ ...machine, roots: { ...machine.roots, [link]: {} } })),
      )
      yield* Effect.gen(function* () {
        expect(CommandMemory.isCommandDirectory(path.join(link, ".command-centre"))).toBe(true)
        expect(CommandMemory.isCommandDirectory(real)).toBe(false)
        expect(yield* CommandMemory.isCommandDirectoryResolved(real)).toBe(true)
      }).pipe(Effect.ensuring(Effect.promise(() => writeFile(file, before))))
    }),
  )

  it.instance("threads from before a vault move still count as Command Centre threads", () =>
    Effect.gen(function* () {
      const { root, headers } = yield* setup
      yield* request("/second-brain/vault", { headers }).pipe(Effect.flatMap(json))
      const file = path.join(Global.make().data, "vault-machine.json")
      const before = yield* Effect.promise(() => readFile(file, "utf8"))
      const earlier = yield* tmpdirScoped()
      const folder = path.join(earlier, ".command-centre")
      yield* Effect.promise(() => mkdir(folder, { recursive: true }))
      const machine = JSON.parse(before)
      yield* Effect.promise(() =>
        writeFile(file, JSON.stringify({ ...machine, roots: { ...machine.roots, [earlier]: {} } })),
      )
      const moved = yield* Session.use.create({ title: "Vault move notes" }).pipe(provideInstanceEffect(folder))
      yield* Effect.gen(function* () {
        expect(CommandMemory.isCommandDirectory(folder)).toBe(true)
        expect(CommandMemory.isCommandDirectory(root)).toBe(false)
        const hits = yield* CommandMemory.search("vault move")
        expect(hits.some((hit) => hit.sessionID === moved.id)).toBe(true)
        const listed = yield* request("/command-centre/folders", { headers }).pipe(
          Effect.flatMap(json<{ folders: string[] }>),
        )
        expect(listed.folders[0]).toBe(path.join(root, ".command-centre"))
        expect(listed.folders).toContain(folder)
      }).pipe(Effect.ensuring(Effect.promise(() => writeFile(file, before))))
    }),
  )

  it.instance("memory search indexes every summary when there are more than one insert batch of them", () =>
    Effect.gen(function* () {
      const { commandDirectory, command } = yield* setup
      const folder = path.join(commandDirectory, "memory")
      yield* Effect.promise(() => mkdir(folder, { recursive: true }))
      // 450 summaries span three index inserts; the last one written is the only "zebra" match.
      yield* Effect.promise(() =>
        Promise.all(
          Array.from({ length: 450 }, (_, index) =>
            writeFile(
              path.join(folder, `old_${index}.md`),
              `<!-- at: ${1_000 + index} -->\nSummary ${index} about billing${index === 449 ? " zebra" : ""}.\n`,
            ),
          ),
        ),
      )
      const zebra = yield* CommandMemory.search("zebra")
      expect(zebra).toEqual([{ text: "Summary 449 about billing zebra.", at: 1_449 }])
      const billing = yield* CommandMemory.search("billing")
      expect(billing).toHaveLength(20)
      expect(billing.some((hit) => hit.sessionID === command.id)).toBe(true)
    }),
  )

  it.instance("memory search reads only new or changed threads again, and forgets removed ones", () =>
    Effect.gen(function* () {
      const { commandDirectory, command } = yield* setup
      const sessions = yield* Session.Service
      const reads: string[] = []
      const counted = Effect.provideService(Session.Service, {
        ...sessions,
        messages: (input) => {
          reads.push(input.sessionID)
          return sessions.messages(input)
        },
      })
      const survey = yield* Session.use
        .create({ title: "Kestrel survey" })
        .pipe(provideInstanceEffect(commandDirectory))
      const messageID = MessageID.ascending()
      const partID = PartID.ascending()
      const write = (text: string) =>
        Effect.gen(function* () {
          yield* sessions.updateMessage({
            id: messageID,
            sessionID: survey.id,
            role: "user",
            time: { created: Date.now() },
            agent: "test",
            model: { providerID: "test", modelID: "test" },
            tools: {},
            mode: "",
          } as never)
          yield* sessions.updatePart({ id: partID, sessionID: survey.id, messageID, type: "text", text })
        })
      yield* write("Count the kestrel nests by the quarry.")
      // A thread written in the millisecond a search reads it is read again by the next search; step past it
      // so the second search below can show an unchanged thread isn't.
      yield* Effect.sleep("2 millis")

      const first = yield* CommandMemory.search("kestrel").pipe(counted)
      expect(first.map((hit) => hit.sessionID)).toEqual([survey.id])
      expect(reads.toSorted()).toEqual([command.id, survey.id].toSorted())

      // Nothing changed, so nothing is read again.
      reads.length = 0
      expect((yield* CommandMemory.search("kestrel").pipe(counted)).map((hit) => hit.sessionID)).toEqual([survey.id])
      expect(reads).toEqual([])

      // An in-place edit and a rename: the new text matches, the old no longer does, and only that thread is read.
      yield* write("Count the osprey nests by the quarry.")
      yield* sessions.setTitle({ sessionID: survey.id, title: "Osprey survey" })
      expect(yield* CommandMemory.search("kestrel").pipe(counted)).toEqual([])
      expect(reads).toEqual([survey.id])
      const osprey = yield* CommandMemory.search("osprey")
      expect(osprey).toHaveLength(1)
      expect(osprey[0]).toMatchObject({ sessionID: survey.id })
      expect(osprey[0]?.text).toBe("Osprey survey\n\nCount the osprey nests by the quarry.")

      // A removed thread no longer matches.
      yield* sessions.remove(survey.id)
      expect(yield* CommandMemory.search("osprey")).toEqual([])
      expect((yield* CommandMemory.search("billing")).map((hit) => hit.sessionID)).toEqual([command.id])
    }),
  )

  it.instance("memory search sees a part rewritten in the same millisecond it was indexed", () =>
    Effect.gen(function* () {
      const { commandDirectory } = yield* setup
      const sessions = yield* Session.Service
      const thread = yield* Session.use.create({ title: "Field notes" }).pipe(provideInstanceEffect(commandDirectory))
      const messageID = MessageID.ascending()
      const partID = PartID.ascending()
      const write = (text: string) =>
        Effect.gen(function* () {
          yield* sessions.updateMessage({
            id: messageID,
            sessionID: thread.id,
            role: "user",
            time: { created: Date.now() },
            agent: "test",
            model: { providerID: "test", modelID: "test" },
            tools: {},
            mode: "",
          } as never)
          yield* sessions.updatePart({ id: partID, sessionID: thread.id, messageID, type: "text", text })
        })
      // Every write and search below happens in one frozen millisecond.
      const now = Date.now()
      const clock = spyOn(Date, "now").mockReturnValue(now)
      yield* Effect.gen(function* () {
        yield* write("Count the kestrel nests.")
        expect((yield* CommandMemory.search("kestrel")).map((hit) => hit.sessionID)).toEqual([thread.id])
        yield* write("Count the osprey nests.")
        expect(yield* CommandMemory.search("kestrel")).toEqual([])
        expect((yield* CommandMemory.search("osprey")).map((hit) => hit.text)).toEqual([
          "Field notes\n\nCount the osprey nests.",
        ])
      }).pipe(Effect.ensuring(Effect.sync(() => clock.mockRestore())))
    }),
  )

  it.instance("memory search picks up rewritten summaries and forgets deleted ones", () =>
    Effect.gen(function* () {
      const { commandDirectory } = yield* setup
      const folder = path.join(commandDirectory, "memory")
      const file = path.join(folder, "old.md")
      yield* Effect.promise(() => mkdir(folder, { recursive: true }))
      yield* Effect.promise(() => writeFile(file, "<!-- at: 5 -->\nThe heron count ran long.\n"))
      expect(yield* CommandMemory.search("heron")).toEqual([{ text: "The heron count ran long.", at: 5 }])

      yield* Effect.promise(() => writeFile(file, "<!-- at: 6 -->\nThe egret count ran over time.\n"))
      expect(yield* CommandMemory.search("heron")).toEqual([])
      expect(yield* CommandMemory.search("egret")).toEqual([{ text: "The egret count ran over time.", at: 6 }])

      yield* Effect.promise(() => rm(file))
      expect(yield* CommandMemory.search("egret")).toEqual([])
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
      const hits = yield* request("/command-centre/memory?search=billing", { headers }).pipe(
        Effect.flatMap(json<{ text: string }[]>),
      )
      expect(hits.length).toBeGreaterThan(0)
      const compacted = yield* request("/command-centre/memory/compact", {
        method: "POST",
        headers,
        body: JSON.stringify({ days: 45 }),
      }).pipe(Effect.flatMap(json<{ summarised: number; deleted: number }>))
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

  it.instance(
    "AC-7.6 project_setup creates a git folder from the templates, a Project card and an empty timeline",
    () =>
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
        const projects = yield* request("/second-brain/projects", { headers }).pipe(
          Effect.flatMap(json<{ id: string; name: string }[]>),
        )
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
