import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Database } from "../../src/database/database"
import { AppNodeBuilder } from "../../src/effect/app-node-builder"
import { LayerNode } from "../../src/effect/layer-node"
import { EventV2 } from "../../src/event"
import { HarnessBrowserTools } from "../../src/harness/browser-tools"
import { Location } from "../../src/location"
import { ProjectV2 } from "../../src/project"
import { AbsolutePath } from "../../src/schema"
import { SessionV2 } from "../../src/session"
import { SessionExecution } from "../../src/session/execution"
import { SessionInput } from "../../src/session/input"
import { Prompt } from "../../src/session/prompt"
import { SessionProjector } from "../../src/session/projector"
import { SessionStore } from "../../src/session/store"
import { ThreadSync } from "../../src/thread-sync"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const computer = (file: string) =>
  Layer.fresh(
    AppNodeBuilder.build(
      LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
      [
        [Database.node, Database.layerFromPath(file)],
        [ProjectV2.node, projects],
        [SessionExecution.node, SessionExecution.noopLayer],
      ],
    ),
  )

const it = testEffect(Layer.empty)

const scratch = Effect.acquireRelease(
  Effect.promise(() => tmpdir()),
  (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
)

const down = () => Promise.reject(new ThreadSync.SyncError({ code: "unavailable", message: "down" }))
const failing: ThreadSync.Store = { get: down, put: down, list: down, remove: down }

const managerAt = (root: string, options: { platform?: NodeJS.Platform; store?: () => ThreadSync.Store } = {}) =>
  Effect.gen(function* () {
    const key = ThreadSync.generateKey().key
    return ThreadSync.manager({
      db: (yield* Database.Service).db,
      events: yield* EventV2.Service,
      settingsFile: path.join(root, "thread-sync.json"),
      hostname: "desk",
      credentials: {
        key: async () => key,
        store: async (driveFolder) =>
          options.store?.() ?? ThreadSync.folderStore(path.join(root, "drives", driveFolder)),
      },
      projects: { resolve: async (directory) => ({ id: "prj_desk", worktree: directory }) },
      ...(options.platform && { platform: options.platform }),
    })
  })

const start = (directory: string, text: string) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const events = yield* EventV2.Service
    const db = (yield* Database.Service).db
    const created = yield* session.create({ location: Location.Ref.make({ directory: AbsolutePath.make(directory) }) })
    yield* session.prompt({ sessionID: created.id, prompt: Prompt.make({ text }), resume: false })
    yield* SessionInput.promoteSteers(db, events, created.id, Number.MAX_SAFE_INTEGER)
    return created.id
  })

const code = <A>(effect: Effect.Effect<A, unknown>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => (error as { code?: string }).code),
  )

const readSettings = (root: string) =>
  Effect.promise(() => fs.readFile(path.join(root, "thread-sync.json"), "utf8").then((text) => JSON.parse(text)))

describe("thread sync manager edges", () => {
  it.live("an unreadable settings file is set aside and the machine id stays stable afterwards", () =>
    Effect.gen(function* () {
      const tmp = yield* scratch
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "thread-sync.json"), "{ not json"))
      const first = yield* (yield* managerAt(tmp.path)).status()
      expect(first).toMatchObject({
        ready: false,
        enabled: false,
        driveFolder: "Tenon Workbench Threads",
        lastError: null,
      })
      expect(first.missing).toEqual([])
      const names = yield* Effect.promise(() => fs.readdir(tmp.path))
      expect(names.filter((name) => name.startsWith("thread-sync.json.broken-"))).toHaveLength(1)
      expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([])
      const second = yield* (yield* managerAt(tmp.path)).status()
      expect(second.machine).toEqual(first.machine)
      expect(yield* readSettings(tmp.path)).toEqual({ enabled: false, machine: first.machine, folders: {} })
    }).pipe(Effect.provide(computer(":memory:"))),
  )

  it.live("configure checks every field before it saves any of them", () =>
    Effect.gen(function* () {
      const tmp = yield* scratch
      const sync = yield* managerAt(tmp.path)
      const rejected = ["", "   ", "x".repeat(101), "nul\u0000here", "line\nbreak", "del\u007fhere"]
      const codes = yield* Effect.forEach(rejected, (driveFolder) => code(sync.configure({ driveFolder })))
      expect(codes).toEqual(rejected.map(() => "invalid_name"))
      expect(yield* code(sync.configure({ enabled: true, driveFolder: "Fine name", machineName: "   " }))).toBe(
        "invalid_name",
      )
      expect(yield* code(sync.configure({ machineName: "x".repeat(65) }))).toBe("invalid_name")
      expect(yield* sync.status()).toMatchObject({ enabled: false, driveFolder: "Tenon Workbench Threads" })
      const accepted = yield* sync.configure({ driveFolder: " a ", machineName: "y".repeat(64) })
      expect(accepted).toMatchObject({ driveFolder: "a", enabled: false, ready: false, missing: [] })
      expect(accepted.machine.name).toBe("y".repeat(64))
      expect((yield* sync.configure({ driveFolder: "é".repeat(100) })).driveFolder).toBe("é".repeat(100))
    }).pipe(Effect.provide(computer(":memory:"))),
  )

  it.live("a store failure in settled is kept as lastError until a push succeeds", () =>
    Effect.gen(function* () {
      const tmp = yield* scratch
      const mode = { failing: true }
      const healthy = ThreadSync.folderStore(path.join(tmp.path, "store"))
      const sync = yield* managerAt(tmp.path, { store: () => (mode.failing ? failing : healthy) })
      yield* sync.configure({ enabled: true })
      const id = yield* start("/desk/repo", "hello")
      expect(yield* sync.settled(id)).toEqual({ pushed: false, reason: "unavailable" })
      expect((yield* sync.status()).lastError).toBe("down")
      expect(yield* sync.settled("ses_missing")).toEqual({ pushed: false, reason: "not_found" })
      expect((yield* sync.status()).lastError).toBe("down")
      mode.failing = false
      expect(yield* sync.settled(id)).toEqual({ pushed: true })
      expect((yield* sync.status()).lastError).toBeNull()
      yield* sync.configure({ enabled: false })
      expect(yield* sync.settled(id)).toEqual({ pushed: false, reason: "not_ready" })
      expect((yield* sync.status()).lastError).toBeNull()
    }).pipe(Effect.provide(computer(":memory:"))),
  )

  it.live("continue here takes a folder only in this computer's own path form, and a failure records nothing", () =>
    Effect.gen(function* () {
      const tmp = yield* scratch
      const id = yield* start("/desk/repo", "hello")
      const windows = yield* managerAt(tmp.path, { platform: "win32" })
      yield* windows.configure({ enabled: true })
      const mac = yield* managerAt(tmp.path, { platform: "darwin" })
      expect(yield* code(windows.continueHere(id, { directory: "repo" }))).toBe("invalid_name")
      expect(yield* code(windows.continueHere(id, { directory: "" }))).toBe("invalid_name")
      expect(yield* code(mac.continueHere(id, { directory: "C:\\Users\\me\\repo" }))).toBe("invalid_name")
      expect(yield* code(windows.continueHere(id, { directory: "C:\\Users\\me\\repo" }))).toBe("not_found")
      expect(yield* code(mac.continueHere(id, { directory: "/Users/me/repo" }))).toBe("not_found")
      expect((yield* readSettings(tmp.path)).folders).toEqual({})
    }).pipe(Effect.provide(computer(":memory:"))),
  )

  it.live("continuing a thread this computer owns records the folder without pulling anything", () =>
    Effect.gen(function* () {
      const tmp = yield* scratch
      const sync = yield* managerAt(tmp.path)
      yield* sync.configure({ enabled: true })
      const id = yield* start("/desk/repo", "hello")
      yield* sync.settled(id)
      const here = process.platform === "win32" ? "C:\\work\\other" : "/work/other"
      expect(yield* sync.continueHere(id, { directory: here })).toEqual({ applied: 0, head: 2 })
      expect((yield* sync.threads())[0]).toMatchObject({ mine: true, local: "current", folder: here })
      expect((yield* readSettings(tmp.path)).folders).toEqual({ [id]: here })
    }).pipe(Effect.provide(computer(":memory:"))),
  )
})

describe("thread sync bridge", () => {
  it.live("without the desktop bridge there is no key and no store", () =>
    Effect.promise(async () => {
      const credentials = ThreadSync.bridgeCredentials({})
      expect(await credentials.key()).toBeUndefined()
      expect(await credentials.store(ThreadSync.DRIVE_FOLDER)).toBeUndefined()
    }),
  )

  it.live("asks the desktop for the key and token with its bearer token, and the calls are not agent tools", () =>
    Effect.gen(function* () {
      const key = ThreadSync.generateKey().key
      const seen: Array<{ route: string; authorization: string | undefined }> = []
      const answers: Record<string, string> = {
        "/sync_key": JSON.stringify({ key: Buffer.from(key).toString("base64url") }),
        "/sync_token": JSON.stringify({ token: "access-token" }),
      }
      const server = createServer((request, response) => {
        seen.push({ route: request.url ?? "", authorization: request.headers.authorization })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ text: answers[request.url ?? ""] }))
      })
      const port = yield* Effect.acquireRelease(
        Effect.promise(
          () =>
            new Promise<number>((resolve) =>
              server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)),
            ),
        ),
        () => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
      )
      const credentials = ThreadSync.bridgeCredentials({
        TENON_BROWSER_URL: `http://127.0.0.1:${port}`,
        TENON_BROWSER_TOKEN: "bridge-token",
      })
      expect(Array.from((yield* Effect.promise(() => credentials.key())) ?? [])).toEqual(Array.from(key))
      expect(yield* Effect.promise(() => credentials.store(ThreadSync.DRIVE_FOLDER))).toBeDefined()
      expect(seen).toEqual([
        { route: "/sync_key", authorization: "Bearer bridge-token" },
        { route: "/sync_token", authorization: "Bearer bridge-token" },
      ])
      answers["/sync_token"] = JSON.stringify({})
      expect(yield* Effect.promise(() => credentials.store(ThreadSync.DRIVE_FOLDER))).toBeUndefined()
      expect(HarnessBrowserTools.isTool("sync_key")).toBe(false)
      expect(HarnessBrowserTools.isTool("sync_token")).toBe(false)
    }),
  )
})
