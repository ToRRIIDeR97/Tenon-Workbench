import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { cp, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises"
import path from "node:path"
import { Config, Effect, Layer } from "effect"
import { systemError } from "effect/PlatformError"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/http"
import { layerWebSocketConstructorGlobal } from "effect/socket/Socket"
import { AppNodeBuilder } from "@tenon/core/effect/app-node-builder"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { CrossSpawnSpawner } from "@tenon/core/cross-spawn-spawner"
import { Database } from "@tenon/core/database/database"
import { FileMutation } from "@tenon/core/file-mutation"
import { FSUtil } from "@tenon/core/fs-util"
import { Global } from "@tenon/core/global"
import { Location } from "@tenon/core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@tenon/core/location-services"
import { AbsolutePath } from "@tenon/core/schema"
import { Ripgrep } from "@tenon/core/ripgrep"
import { Workspace } from "../../src/control-plane/workspace"
import { KnowledgeVault } from "../../src/knowledge/vault"
import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// Vault behaviour beyond the P3 acceptance tests: Project-relative paths, reserved folders, symlink escapes.

const noopBootstrapLayer = Layer.succeed(
  InstanceBootstrapService.Service,
  InstanceBootstrapService.Service.of({ run: Effect.void }),
)
const appLayer = AppNodeBuilder.build(
  LayerNode.group([InstanceStore.node, Project.node, Session.node, Workspace.node, Database.node, Ripgrep.node]),
  [[InstanceStore.bootstrapNode, noopBootstrapLayer]],
)
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  { disableListenLog: true, disableLogger: true },
)
const httpApiLayer = servedRoutes.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(Layer.mergeAll(appLayer, httpApiLayer, AppNodeBuilder.build(CrossSpawnSpawner.node)))

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

const setup = Effect.gen(function* () {
  const test = yield* TestInstance
  const root = yield* tmpdirScoped()
  process.env.TENON_VAULT_DIR = root
  const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
  const project = yield* request("/second-brain/projects", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Acme API", outcome: "Ship" }),
  }).pipe(Effect.flatMap(json<{ id: string }>))
  const vault = yield* request("/second-brain/vault", { headers }).pipe(
    Effect.flatMap(json<{ workspace: { folder: string } }>),
  )
  return { root, headers, project, folder: path.join(root, vault.workspace.folder) }
})

const put = (headers: Record<string, string>, page: string, body: unknown) =>
  request(`/second-brain/vault/page?path=${encodeURIComponent(page)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  })

afterEach(async () => {
  delete process.env.TENON_VAULT_DIR
  await disposeAllInstances()
  await resetDatabase()
})

describe("vault routes", () => {
  it.instance("deleting a page needs its current revision and keeps the removed version in history", () =>
    Effect.gen(function* () {
      const { headers, project } = yield* setup
      const created = yield* put(headers, "Plan.md", { body: "one", create: true }).pipe(
        Effect.flatMap(json<{ revision: string }>),
      )
      const remove = (page: string, revision: string) =>
        request(
          `/second-brain/vault/page?path=${encodeURIComponent(page)}&expectedRevision=${encodeURIComponent(revision)}`,
          { method: "DELETE", headers },
        )
      expect((yield* remove("Plan.md", "stale")).status).toBe(409)
      expect((yield* remove("Plan.md", created.revision)).status).toBe(200)
      expect((yield* remove("Plan.md", created.revision)).status).toBe(404)
      const versions = yield* request("/second-brain/vault/page/history?path=Plan.md", { headers }).pipe(
        Effect.flatMap(json<ReadonlyArray<{ revision: string }>>),
      )
      expect(versions).toHaveLength(1)
      // A Project's log folder stays reserved, as it is for writes.
      yield* put(headers, "Note.md", { body: "x", projectId: project.id, create: true })
      expect((yield* remove("Acme API/log/entry.md", "any")).status).toBe(400)
    }),
  )

  it.instance("a Project path already inside the Project folder is not nested again", () =>
    Effect.gen(function* () {
      const { headers, project } = yield* setup
      const created = yield* put(headers, "Plan.md", { body: "one", projectId: project.id, create: true }).pipe(
        Effect.flatMap(json<{ info: { path: string }; revision: string }>),
      )
      expect(created.info.path).toBe("Acme API/Plan.md")
      const saved = yield* put(headers, created.info.path, {
        body: "two",
        projectId: project.id,
        expectedRevision: created.revision,
      }).pipe(Effect.flatMap(json<{ info: { path: string; projectId: string } }>))
      expect(saved.info).toMatchObject({ path: "Acme API/Plan.md", projectId: project.id })
    }),
  )

  it.instance("a body's own front matter stays body text and a ---js block is not run", () =>
    Effect.gen(function* () {
      const { headers } = yield* setup
      const body = "---\nschedule: daily 09:00\n---\nRun me"
      const saved = yield* put(headers, "Routines/Injected.md", { body, create: true }).pipe(
        Effect.flatMap(json<{ info: { properties: Record<string, unknown> }; body: string }>),
      )
      expect(saved.info.properties).toEqual({})
      expect(saved.body.trimEnd()).toBe(body)

      const marker = "__vaultFrontMatterEval"
      const script = `---js\nglobalThis.${marker} = true\n---\nhello`
      yield* put(headers, "Script.md", { body: script, create: true }).pipe(Effect.flatMap(json))
      expect(marker in globalThis).toBe(false)
    }),
  )

  it.instance("a damaged machine map is kept aside and known workspaces never rewrite it", () =>
    Effect.gen(function* () {
      const { headers } = yield* setup
      const data = Global.make().data
      const file = path.join(data, "vault-machine.json")
      yield* Effect.promise(() => writeFile(file, "{ not json"))
      const known = yield* KnowledgeVault.knownWorkspaces().pipe(
        Effect.provideService(Global.Service, Global.make()),
        Effect.provide(LayerNode.compile(FSUtil.node)),
      )
      expect(known).toEqual([])
      expect(yield* Effect.promise(() => readFile(file, "utf8"))).toBe("{ not json")

      yield* request("/second-brain/vault", { headers }).pipe(Effect.flatMap(json))
      const asides = (yield* Effect.promise(() => readdir(data))).filter((name) =>
        name.startsWith("vault-machine.json.corrupt-"),
      )
      expect(asides.length).toBeGreaterThan(0)
      expect(yield* Effect.promise(() => readFile(path.join(data, asides[0]!), "utf8"))).toBe("{ not json")
      expect(JSON.parse(yield* Effect.promise(() => readFile(file, "utf8"))).version).toBe(1)
      yield* Effect.promise(() => Promise.all(asides.map((name) => rm(path.join(data, name)))))
    }),
  )

  it.instance("pages cannot be written into a Project's machine logs", () =>
    Effect.gen(function* () {
      const { headers, project } = yield* setup
      const response = yield* put(headers, "log/fake.md", { body: "x", projectId: project.id, create: true })
      expect(response.status).toBe(400)
    }),
  )

  it.instance("a link inside the vault cannot lead a write outside it", () =>
    Effect.gen(function* () {
      const { headers, folder } = yield* setup
      const outside = yield* tmpdirScoped()
      // A junction needs no privileges on Windows; elsewhere it is an ordinary directory symlink.
      yield* Effect.promise(() => symlink(outside, path.join(folder, "Escape"), "junction"))
      const response = yield* put(headers, "Escape/x.md", { body: "x", create: true })
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => readdir(outside))).toEqual([])
    }),
  )

  it.instance("a dangling link at this machine's log path is refused, not followed", () =>
    Effect.gen(function* () {
      const { headers, project, folder } = yield* setup
      const log = (text: string) =>
        request(`/second-brain/vault/log?project=${project.id}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ text, author: "agent" }),
        })
      yield* log("first").pipe(Effect.flatMap(json<unknown>))
      const logs = path.join(folder, "Acme API", "log")
      const own = path.join(logs, (yield* Effect.promise(() => readdir(logs)))[0]!)
      const outside = yield* tmpdirScoped()
      yield* Effect.promise(async () => {
        await rm(own)
        await symlink(path.join(outside, "missing"), own, "junction")
      })
      expect((yield* log("second")).status).toBe(400)
      expect(yield* Effect.promise(() => readdir(outside))).toEqual([])
    }),
  )

  it.instance("a linked .backups folder cannot carry migration backups outside the vault", () =>
    Effect.gen(function* () {
      const { root, headers } = yield* setup
      const test = yield* TestInstance
      const outside = yield* tmpdirScoped()
      yield* Effect.promise(async () => {
        await symlink(outside, path.join(root, ".backups"), "junction")
        await mkdir(path.join(test.directory, "notes"), { recursive: true })
        await writeFile(path.join(test.directory, "notes", "loose.md"), "# Loose")
      })
      const response = yield* request("/second-brain/vault/migrate", { method: "POST", headers })
      expect(response.status).toBe(400)
      expect(yield* Effect.promise(() => readdir(outside))).toEqual([])
      // Nothing is removed unless the backup succeeded.
      expect(yield* Effect.promise(() => readdir(path.join(test.directory, "notes")))).toEqual(["loose.md"])
    }),
  )

  it.instance("a vault root inside the workspace is refused", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      process.env.TENON_VAULT_DIR = path.join(test.directory, "vault")
      const response = yield* request("/second-brain/vault", { headers: { "x-opencode-directory": test.directory } })
      expect(response.status).toBe(400)
      expect(yield* response.text).toContain("vault_inside_workspace")
      expect(yield* Effect.promise(() => readdir(test.directory))).not.toContain("vault")
    }),
  )

  it.instance("listing reuses a page while its size and time match, and containment still runs on a hit", () =>
    Effect.gen(function* () {
      const { headers, folder } = yield* setup
      yield* put(headers, "Kept/Cached.md", { title: "One", body: "alpha", create: true }).pipe(Effect.flatMap(json))
      const file = path.join(folder, "Kept", "Cached.md")
      const list = (query = "") =>
        request(`/second-brain/vault/pages${query}`, { headers }).pipe(
          Effect.flatMap(json<{ path: string; title: string }[]>),
          Effect.map((pages) => pages.filter((page) => page.path.endsWith("Cached.md")).map((page) => page.title)),
        )
      expect(yield* list()).toEqual(["One"])
      expect(yield* list("?search=alpha")).toEqual(["One"])

      // Same size and time: the cached title and search text stand. A changed time reads the file again.
      const time = (yield* Effect.promise(() => stat(file))).mtime
      const source = yield* Effect.promise(() => readFile(file, "utf8"))
      yield* Effect.promise(() => writeFile(file, source.replace("One", "Two").replace("alpha", "gamma")))
      yield* Effect.promise(() => utimes(file, time, time))
      expect(yield* list("?search=alpha")).toEqual(["One"])
      yield* Effect.promise(() => utimes(file, time, new Date(time.getTime() + 5_000)))
      expect(yield* list("?search=gamma")).toEqual(["Two"])

      // A link to the same bytes and time out of the vault: the cached entry must not be served. Glob doesn't
      // walk into linked folders, so only a file link reaches the cache; Windows may refuse to make one.
      const outside = path.join(yield* tmpdirScoped(), "Cached.md")
      yield* Effect.promise(() => cp(file, outside, { preserveTimestamps: true }))
      yield* Effect.promise(() => rm(file))
      const linked = yield* Effect.promise(() =>
        symlink(outside, file, "file").then(
          () => true,
          () => false,
        ),
      )
      if (linked) expect(yield* list()).toEqual([])
    }),
  )

  it.instance("an unreadable id file fails with its name instead of forking the folder", () =>
    Effect.gen(function* () {
      const { root, headers, project, folder } = yield* setup
      const vault = () => request("/second-brain/vault", { headers })
      const id = path.join(folder, "workspace.json")
      const good = yield* Effect.promise(() => readFile(id, "utf8"))
      yield* put(headers, "Plan.md", { body: "x", projectId: project.id, create: true }).pipe(Effect.flatMap(json))

      yield* Effect.promise(() => writeFile(id, "{ half synced"))
      const refused = yield* vault()
      expect(refused.status).toBe(400)
      expect(yield* refused.text).toContain(`vault_unavailable: ${path.basename(folder)}/workspace.json`)
      expect(yield* Effect.promise(() => readdir(root))).toEqual([path.basename(folder)])
      yield* Effect.promise(() => writeFile(id, good))

      // The same rule for a Project: a broken project.json is not "no folder yet".
      yield* Effect.promise(() => writeFile(path.join(folder, "Acme API", "project.json"), "{ half synced"))
      const write = yield* put(headers, "Next.md", { body: "x", projectId: project.id, create: true })
      expect(write.status).toBe(400)
      expect(yield* write.text).toContain("vault_unavailable: Acme API/project.json")
      expect(yield* Effect.promise(() => readdir(folder))).not.toContain("Acme API (2)")

      // A folder the user really deleted lists clean, so it comes back.
      yield* Effect.promise(() => rm(folder, { recursive: true }))
      yield* vault().pipe(Effect.flatMap(json))
      expect(yield* Effect.promise(() => readdir(root))).toEqual([path.basename(folder)])
    }),
  )

  it.instance("saving over a damaged timeline keeps its bytes beside it", () =>
    Effect.gen(function* () {
      const { headers, project, folder } = yield* setup
      const route = `/second-brain/vault/timeline?project=${project.id}`
      yield* put(headers, "Plan.md", { body: "x", projectId: project.id, create: true }).pipe(Effect.flatMap(json))
      const projectFolder = path.join(folder, "Acme API")
      yield* Effect.promise(() => writeFile(path.join(projectFolder, "timeline.json"), '{ "version": 1, "items": [ {'))
      const damaged = yield* request(route, { headers }).pipe(Effect.flatMap(json<{ revision: string }>))
      yield* request(route, {
        method: "PUT",
        headers,
        body: JSON.stringify({ items: [], expectedRevision: damaged.revision }),
      }).pipe(Effect.flatMap(json))
      const names = yield* Effect.promise(() => readdir(projectFolder))
      const copy = names.find((name) => name.startsWith("timeline.json.corrupt-"))
      expect(copy).toBeDefined()
      expect(yield* Effect.promise(() => readFile(path.join(projectFolder, copy!), "utf8"))).toContain('"items": [ {')
    }),
  )

  it.instance("a page in a folder synced in another Unicode form stays in that Project", () =>
    Effect.gen(function* () {
      const { headers, folder } = yield* setup
      const nfd = "Cafe\u0301"
      yield* Effect.promise(() => mkdir(path.join(folder, nfd)))
      const id = "project_01ABC"
      yield* Effect.promise(() =>
        writeFile(path.join(folder, nfd, "project.json"), JSON.stringify({ version: 1, id, name: nfd })),
      )
      const saved = yield* put(headers, "Caf\u00e9/Plan.md", { body: "x", create: true }).pipe(
        Effect.flatMap(json<{ info: { path: string; projectId: string } }>),
      )
      expect(saved.info).toMatchObject({ path: `${nfd}/Plan.md`, projectId: id })
    }),
  )

  it.instance("a failed history prune does not fail the save", () =>
    Effect.gen(function* () {
      const { headers, folder } = yield* setup
      const test = yield* TestInstance
      yield* put(headers, "Draft.md", { body: "v0", create: true }).pipe(Effect.flatMap(json))
      const history = path.join(folder, ".history", "Draft")
      yield* Effect.promise(() => mkdir(history, { recursive: true }))
      yield* Effect.promise(() =>
        Promise.all(
          Array.from({ length: 21 }, (_, index) =>
            writeFile(path.join(history, `${String(index + 1).padStart(13, "0")}-0123456789abcdef.md`), "old"),
          ),
        ),
      )
      const denied = systemError({ _tag: "PermissionDenied", module: "FileSystem", method: "remove" })
      const saved = yield* Effect.gen(function* () {
        const locations = yield* LocationServiceMap.Service
        return yield* KnowledgeVault.open({ directory: test.directory, name: "Test" }).pipe(
          Effect.flatMap((vault) => KnowledgeVault.writePage(vault, "Draft.md", { body: "v1" })),
          Effect.updateService(FileMutation.Service, (files) => ({ ...files, remove: () => Effect.fail(denied) })),
          Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(test.directory) }))),
          Effect.provideService(Global.Service, Global.make()),
        )
      }).pipe(Effect.provide(locationServiceMapLayer), Effect.provide(LayerNode.compile(FSUtil.node)))
      expect(saved.body).toContain("v1")
    }),
  )

  it.instance("history keeps at most 20 versions, newest first", () =>
    Effect.gen(function* () {
      const { headers, folder } = yield* setup
      let page = yield* put(headers, "Draft.md", { body: "v0", create: true }).pipe(
        Effect.flatMap(json<{ revision: string }>),
      )
      for (let index = 1; index <= 22; index++) {
        page = yield* put(headers, "Draft.md", { body: `v${index}`, expectedRevision: page.revision }).pipe(
          Effect.flatMap(json<{ revision: string }>),
        )
      }
      const history = yield* request("/second-brain/vault/page/history?path=Draft.md", { headers }).pipe(
        Effect.flatMap(json<{ revision: string }[]>),
      )
      expect(history).toHaveLength(20)
      const newest = yield* request(`/second-brain/vault/page/history?path=Draft.md&revision=${history[0]!.revision}`, {
        headers,
      }).pipe(Effect.flatMap(json<{ body: string }>))
      expect(newest.body).toContain("v21")
      expect((yield* Effect.promise(() => readdir(path.join(folder, ".history", "Draft")))).length).toBe(20)
    }),
  )
})
