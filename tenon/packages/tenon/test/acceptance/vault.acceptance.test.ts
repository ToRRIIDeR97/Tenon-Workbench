import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
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
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// P3 · Vault (implementations/notes-command-centre/implementation.md, AC-3.1 … AC-3.8)

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

type Page = {
  info: { id: string; path: string; title: string; projectId: string | null; updatedAt: string }
  body: string
  revision: string
}

// Every test gets its own vault root.
const withVault = Effect.gen(function* () {
  const test = yield* TestInstance
  const root = yield* tmpdirScoped()
  process.env.TENON_VAULT_DIR = root
  const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
  return { test, root, headers }
})

const createProject = (headers: Record<string, string>, name: string) =>
  request("/second-brain/projects", { method: "POST", headers, body: JSON.stringify({ name, outcome: "Ship" }) }).pipe(
    Effect.flatMap(json<{ id: string; name: string; location?: { path?: string } }>),
  )

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : Promise.resolve([path.join(dir, entry.name)]),
    ),
  )
  return nested.flat()
}

afterEach(async () => {
  delete process.env.TENON_VAULT_DIR
  await disposeAllInstances()
  await resetDatabase()
})

describe("vault", () => {
  it.instance("AC-3.1 creates one workspace folder under the vault root and keeps its id", () =>
    Effect.gen(function* () {
      const { root, headers } = yield* withVault
      const first = yield* request("/second-brain/vault", { headers }).pipe(
        Effect.flatMap(json<{ root: string; workspace: { id: string; name: string; folder: string } }>),
      )
      expect(path.resolve(first.root)).toBe(path.resolve(root))
      const second = yield* request("/second-brain/vault", { headers }).pipe(
        Effect.flatMap(json<{ workspace: { id: string; folder: string } }>),
      )
      expect(second.workspace.id).toBe(first.workspace.id)
      const folders = yield* Effect.promise(() => readdir(root))
      expect(folders.filter((name) => !name.startsWith("."))).toEqual([first.workspace.folder])
    }),
  )

  it.instance("AC-3.2 writes, reads and lists pages, and stores Project pages in the Project's folder", () =>
    Effect.gen(function* () {
      const { root, headers } = yield* withVault
      const project = yield* createProject(headers, "Acme API")
      const written = yield* request("/second-brain/vault/page?path=Auth%20redesign.md", {
        method: "PUT",
        headers,
        body: JSON.stringify({ body: "# Auth redesign\n\nPlan.", projectId: project.id, create: true }),
      }).pipe(Effect.flatMap(json<Page>))
      expect(written.info.projectId).toBe(project.id)
      const read = yield* request(`/second-brain/vault/page?path=${encodeURIComponent(written.info.path)}`, {
        headers,
      }).pipe(Effect.flatMap(json<Page>))
      expect(read.body).toContain("Plan.")
      expect(read.revision).toBe(written.revision)

      const listed = yield* request(`/second-brain/vault/pages?project=${project.id}`, { headers }).pipe(
        Effect.flatMap(json<Page["info"][]>),
      )
      expect(listed.map((page) => page.path)).toEqual([written.info.path])
      const files = yield* Effect.promise(() => walk(root))
      const stored = files.find((file) => file.endsWith("Auth redesign.md"))
      expect(stored).toBeDefined()
      expect(stored!.split(path.sep)).toContain("Acme API")
    }),
  )

  it.instance("AC-3.2 rejects unsafe paths and stale revisions", () =>
    Effect.gen(function* () {
      const { headers } = yield* withVault
      for (const bad of ["../escape.md", "/abs.md", "a\\b.md", "notes.txt"]) {
        const response = yield* request(`/second-brain/vault/page?path=${encodeURIComponent(bad)}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ body: "x", create: true }),
        })
        expect(response.status).toBe(400)
      }
      const page = yield* request("/second-brain/vault/page?path=Ideas.md", {
        method: "PUT",
        headers,
        body: JSON.stringify({ body: "one", create: true }),
      }).pipe(Effect.flatMap(json<Page>))
      yield* request("/second-brain/vault/page?path=Ideas.md", {
        method: "PUT",
        headers,
        body: JSON.stringify({ body: "two", expectedRevision: page.revision }),
      }).pipe(Effect.flatMap(json<Page>))
      const stale = yield* request("/second-brain/vault/page?path=Ideas.md", {
        method: "PUT",
        headers,
        body: JSON.stringify({ body: "three", expectedRevision: page.revision }),
      })
      expect(stale.status).toBe(409)
    }),
  )

  it.instance("AC-3.3 stores no machine paths and never writes into the Project's code folder", () =>
    Effect.gen(function* () {
      const { test, root, headers } = yield* withVault
      const project = yield* createProject(headers, "Linked")
      const code = path.join(test.directory, project.location?.path ?? "projects/Linked")
      yield* Effect.promise(() => mkdir(code, { recursive: true }))
      const before = yield* Effect.promise(() => walk(code))
      yield* request("/second-brain/vault/page?path=Notes.md", {
        method: "PUT",
        headers,
        body: JSON.stringify({ body: "hello", projectId: project.id, create: true }),
      }).pipe(Effect.flatMap(json<Page>))
      yield* request(`/second-brain/vault/timeline?project=${project.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ items: [{ id: "t1", title: "Task", kind: "task", status: "todo" }] }),
      }).pipe(Effect.flatMap(json<unknown>))
      yield* request(`/second-brain/vault/log?project=${project.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: "started", author: "agent" }),
      }).pipe(Effect.flatMap(json<unknown>))
      expect(yield* Effect.promise(() => walk(code))).toEqual(before)
      const files = yield* Effect.promise(() => walk(root))
      const needles = [test.directory, test.directory.replaceAll("\\", "/"), test.directory.replaceAll("\\", "\\\\")]
      for (const file of files) {
        const text = yield* Effect.promise(() => readFile(file, "utf8"))
        for (const needle of needles) expect(text.includes(needle)).toBe(false)
      }
    }),
  )

  it.instance("AC-3.4 timeline round-trips with progress over tasks only", () =>
    Effect.gen(function* () {
      const { headers } = yield* withVault
      const project = yield* createProject(headers, "Timeline")
      const empty = yield* request(`/second-brain/vault/timeline?project=${project.id}`, { headers }).pipe(
        Effect.flatMap(json<{ items: unknown[]; progress: number; revision: string }>),
      )
      expect(empty.items).toEqual([])
      expect(empty.progress).toBe(0)
      const saved = yield* request(`/second-brain/vault/timeline?project=${project.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          expectedRevision: empty.revision,
          items: [
            { id: "a", title: "A", kind: "task", status: "done", start: "2026-11-02", end: "2026-11-06" },
            { id: "b", title: "B", kind: "task", status: "doing" },
            { id: "c", title: "C", kind: "task", status: "todo" },
            { id: "m", title: "Launch", kind: "milestone", status: "done", start: "2026-12-08" },
          ],
        }),
      }).pipe(Effect.flatMap(json<{ progress: number; revision: string; items: { id: string }[] }>))
      expect(saved.items.map((item) => item.id)).toEqual(["a", "b", "c", "m"])
      expect(saved.progress).toBeCloseTo(1 / 3, 5)
      const stale = yield* request(`/second-brain/vault/timeline?project=${project.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ expectedRevision: empty.revision, items: [] }),
      })
      expect(stale.status).toBe(409)
    }),
  )

  it.instance("AC-3.5 log entries append per machine and merge every machine's file", () =>
    Effect.gen(function* () {
      const { root, headers } = yield* withVault
      const project = yield* createProject(headers, "Logged")
      yield* request(`/second-brain/vault/log?project=${project.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: "first", author: "agent" }),
      }).pipe(Effect.flatMap(json<unknown>))
      const files = yield* Effect.promise(() => walk(root))
      const own = files.find((file) => file.split(path.sep).includes("log") && file.endsWith(".md"))
      expect(own).toBeDefined()
      // Another machine's log, synced in.
      yield* Effect.promise(() =>
        writeFile(path.join(path.dirname(own!), "other-machine.md"), "- 2020-01-01T00:00:00.000Z · you · from elsewhere\n"),
      )
      yield* request(`/second-brain/vault/log?project=${project.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: "second", author: "agent" }),
      }).pipe(Effect.flatMap(json<unknown>))
      const entries = yield* request(`/second-brain/vault/log?project=${project.id}`, { headers }).pipe(
        Effect.flatMap(json<{ text: string; machine: string }[]>),
      )
      expect(entries.map((entry) => entry.text)).toEqual(["second", "first", "from elsewhere"])
      expect(entries[2].machine).toBe("other-machine")
      const other = yield* Effect.promise(() => readFile(path.join(path.dirname(own!), "other-machine.md"), "utf8"))
      expect(other).not.toContain("second")
    }),
  )

  it.instance("AC-3.6 migrates workspace notes into the vault once, with a backup", () =>
    Effect.gen(function* () {
      const { test, root, headers } = yield* withVault
      const project = yield* createProject(headers, "Migrated")
      yield* Effect.promise(async () => {
        await mkdir(path.join(test.directory, "notes"), { recursive: true })
        await writeFile(path.join(test.directory, "notes", "loose.md"), "# Loose\n\nworkspace note")
        const cardNotes = path.join(test.directory, ".tenon", "projects", project.id, "notes")
        await mkdir(cardNotes, { recursive: true })
        await writeFile(path.join(cardNotes, "plan.md"), "# Plan\n\nproject note")
      })
      const first = yield* request("/second-brain/vault/migrate", { method: "POST", headers }).pipe(
        Effect.flatMap(json<{ moved: number; backup: string }>),
      )
      expect(first.moved).toBe(2)
      const backupFiles = yield* Effect.promise(() => walk(path.resolve(root, first.backup)))
      expect(backupFiles.length).toBeGreaterThanOrEqual(2)
      const remaining = yield* Effect.promise(() => walk(path.join(test.directory, "notes")))
      expect(remaining).toEqual([])
      const projectPages = yield* request(`/second-brain/vault/pages?project=${project.id}`, { headers }).pipe(
        Effect.flatMap(json<Page["info"][]>),
      )
      expect(projectPages.map((page) => page.title)).toContain("Plan")
      const again = yield* request("/second-brain/vault/migrate", { method: "POST", headers }).pipe(
        Effect.flatMap(json<{ moved: number }>),
      )
      expect(again.moved).toBe(0)
    }),
  )

  it.instance("AC-3.7 reports sync conflict copies", () =>
    Effect.gen(function* () {
      const { root, headers } = yield* withVault
      const vault = yield* request("/second-brain/vault", { headers }).pipe(
        Effect.flatMap(json<{ workspace: { folder: string } }>),
      )
      yield* Effect.promise(async () => {
        const folder = path.join(root, vault.workspace.folder)
        await writeFile(path.join(folder, "Plan.md"), "# Plan")
        await writeFile(path.join(folder, "Plan (conflicted copy 2026-11-02).md"), "# Plan v2")
      })
      const conflicts = yield* request("/second-brain/vault/conflicts", { headers }).pipe(
        Effect.flatMap(json<{ path: string; original: string }[]>),
      )
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].path).toContain("conflicted copy")
      expect(conflicts[0].original).toMatch(/Plan\.md$/)
    }),
  )

  it.instance("AC-3.7 reports OneDrive machine-name copies and their original", () =>
    Effect.gen(function* () {
      const { root, headers } = yield* withVault
      const vault = yield* request("/second-brain/vault", { headers }).pipe(
        Effect.flatMap(json<{ workspace: { folder: string } }>),
      )
      yield* Effect.promise(async () => {
        const folder = path.join(root, vault.workspace.folder)
        await writeFile(path.join(folder, "Plan.md"), "# Plan")
        await writeFile(path.join(folder, "Plan-DESKTOP-ABC123.md"), "# Plan v2")
        await writeFile(path.join(folder, "Plan-LAPTOP-9F2K1-2.md"), "# Plan v3")
        // An ordinary hyphenated name is not a conflict copy.
        await writeFile(path.join(folder, "Desktop-setup.md"), "# Setup")
      })
      const conflicts = yield* request("/second-brain/vault/conflicts", { headers }).pipe(
        Effect.flatMap(json<{ path: string; original: string }[]>),
      )
      expect(conflicts.map((item) => path.posix.basename(item.path)).sort()).toEqual([
        "Plan-DESKTOP-ABC123.md",
        "Plan-LAPTOP-9F2K1-2.md",
      ])
      for (const item of conflicts) expect(path.posix.basename(item.original)).toBe("Plan.md")
      const pages = yield* request("/second-brain/vault/pages", { headers }).pipe(
        Effect.flatMap(json<Page["info"][]>),
      )
      expect(pages.map((page) => page.path).sort()).toEqual(["Desktop-setup.md", "Plan.md"])
    }),
  )

  it.instance("AC-3.6 runs one migration at a time, so a concurrent caller moves nothing", () =>
    Effect.gen(function* () {
      const { test, root, headers } = yield* withVault
      yield* Effect.promise(async () => {
        await mkdir(path.join(test.directory, "notes"), { recursive: true })
        await writeFile(path.join(test.directory, "notes", "a.md"), "# A")
        await writeFile(path.join(test.directory, "notes", "b.md"), "# B")
      })
      // The migrate route and the move a first vault request makes start together.
      const [migrated, listed] = yield* Effect.all(
        [
          request("/second-brain/vault/migrate", { method: "POST", headers }).pipe(
            Effect.flatMap(json<{ moved: number }>),
          ),
          request("/second-brain/vault/pages", { headers }).pipe(Effect.flatMap(json<Page["info"][]>)),
        ],
        { concurrency: "unbounded" },
      )
      expect([0, 2]).toContain(migrated.moved)
      expect(listed.length === 0 || listed.length === 2).toBe(true)
      const pages = yield* request("/second-brain/vault/pages", { headers }).pipe(Effect.flatMap(json<Page["info"][]>))
      expect(pages.map((page) => page.path).sort()).toEqual(["a.md", "b.md"])
      const backups = yield* Effect.promise(() => readdir(path.join(root, ".backups")))
      expect(backups).toHaveLength(1)
      expect(yield* Effect.promise(() => walk(path.join(test.directory, "notes")))).toEqual([])
    }),
  )

  it.instance("AC-3.6 the pre-vault note route writes into the vault, never the workspace", () =>
    Effect.gen(function* () {
      const { test, root, headers } = yield* withVault
      const saved = yield* request("/second-brain/note?path=notes%2FLegacy.md", {
        method: "PUT",
        headers,
        body: JSON.stringify({ body: "# Legacy\n\nfrom an old client", create: true }),
      }).pipe(Effect.flatMap(json<{ info: { path: string; title: string }; revision: string }>))
      expect(saved.info.path).toBe("Legacy.md")
      expect(yield* Effect.promise(() => walk(path.join(test.directory, "notes")))).toEqual([])
      const page = yield* request("/second-brain/vault/page?path=Legacy.md", { headers }).pipe(
        Effect.flatMap(json<Page>),
      )
      expect(page.body).toContain("from an old client")
      expect((yield* Effect.promise(() => walk(root))).some((file) => file.endsWith("Legacy.md"))).toBe(true)
    }),
  )

  it.instance("AC-3.2 reads an unparsable updated_at as unknown", () =>
    Effect.gen(function* () {
      const { root, headers } = yield* withVault
      const vault = yield* request("/second-brain/vault", { headers }).pipe(
        Effect.flatMap(json<{ workspace: { folder: string } }>),
      )
      yield* Effect.promise(() =>
        writeFile(path.join(root, vault.workspace.folder, "Odd.md"), "---\nupdated_at: last tuesday\n---\n# Odd\n"),
      )
      const page = yield* request("/second-brain/vault/page?path=Odd.md", { headers }).pipe(Effect.flatMap(json<Page>))
      expect(page.info.updatedAt).toBe("")
    }),
  )

  it.instance("AC-3.1 finds the workspace folder again after the vault is copied to a new root", () =>
    Effect.gen(function* () {
      const { root, headers } = yield* withVault
      const first = yield* request("/second-brain/vault", { headers }).pipe(
        Effect.flatMap(json<{ workspace: { id: string; folder: string } }>),
      )
      yield* request("/second-brain/vault/page?path=Kept.md", {
        method: "PUT",
        headers,
        body: JSON.stringify({ body: "# Kept", create: true }),
      }).pipe(Effect.flatMap(json<Page>))
      const moved = yield* tmpdirScoped()
      yield* Effect.promise(() => cp(root, moved, { recursive: true }))
      process.env.TENON_VAULT_DIR = moved
      const second = yield* request("/second-brain/vault", { headers }).pipe(
        Effect.flatMap(json<{ workspace: { id: string; folder: string } }>),
      )
      expect(second.workspace).toEqual(first.workspace)
      const pages = yield* request("/second-brain/vault/pages", { headers }).pipe(Effect.flatMap(json<Page["info"][]>))
      expect(pages.map((page) => page.path)).toEqual(["Kept.md"])
    }),
  )

  it.instance("AC-3.8 keeps earlier versions of an overwritten page", () =>
    Effect.gen(function* () {
      const { headers } = yield* withVault
      let page = yield* request("/second-brain/vault/page?path=Draft.md", {
        method: "PUT",
        headers,
        body: JSON.stringify({ body: "version one", create: true }),
      }).pipe(Effect.flatMap(json<Page>))
      page = yield* request("/second-brain/vault/page?path=Draft.md", {
        method: "PUT",
        headers,
        body: JSON.stringify({ body: "version two", expectedRevision: page.revision }),
      }).pipe(Effect.flatMap(json<Page>))
      const history = yield* request("/second-brain/vault/page/history?path=Draft.md", { headers }).pipe(
        Effect.flatMap(json<{ revision: string; body?: string }[]>),
      )
      expect(history.length).toBeGreaterThanOrEqual(1)
      const old = yield* request(
        `/second-brain/vault/page/history?path=Draft.md&revision=${encodeURIComponent(history[0].revision)}`,
        { headers },
      ).pipe(Effect.flatMap(json<{ body: string }>))
      expect(old.body).toContain("version one")
    }),
  )
})
