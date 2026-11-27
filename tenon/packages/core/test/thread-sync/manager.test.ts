import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "../../src/database/database"
import { AppNodeBuilder } from "../../src/effect/app-node-builder"
import { LayerNode } from "../../src/effect/layer-node"
import { EventV2 } from "../../src/event"
import { Location } from "../../src/location"
import { ProjectV2 } from "../../src/project"
import { ProjectTable } from "../../src/project/sql"
import { AbsolutePath } from "../../src/schema"
import { SessionV2 } from "../../src/session"
import { SessionExecution } from "../../src/session/execution"
import { SessionInput } from "../../src/session/input"
import { Prompt } from "../../src/session/prompt"
import { SessionProjector } from "../../src/session/projector"
import { SessionTable } from "../../src/session/sql"
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

const world = (root: string) => {
  const made = ThreadSync.generateKey()
  const manager = (name: string, options: { key?: boolean } = {}) =>
    Effect.gen(function* () {
      return ThreadSync.manager({
        db: (yield* Database.Service).db,
        events: yield* EventV2.Service,
        settingsFile: path.join(root, `${name}-thread-sync.json`),
        hostname: name,
        credentials: {
          key: async () => (options.key === false ? undefined : made.key),
          store: async (bucket) => ThreadSync.folderStore(path.join(root, "buckets", bucket)),
        },
        projects: { resolve: async (directory) => ({ id: `prj_${name}`, worktree: directory }) },
      })
    })
  const ready = (name: string) =>
    Effect.gen(function* () {
      const sync = yield* manager(name)
      yield* sync.configure({ enabled: true, bucket: "my-threads" })
      return sync
    })
  return { made, manager, ready, on: (name: string) => computer(path.join(root, `${name}.sqlite`)) }
}

const start = (directory: string, text: string) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const created = yield* session.create({ location: Location.Ref.make({ directory: AbsolutePath.make(directory) }) })
    yield* say(created.id, text)
    return created.id
  })

const say = (sessionID: SessionV2.ID, text: string) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const events = yield* EventV2.Service
    const db = (yield* Database.Service).db
    yield* session.prompt({ sessionID, prompt: Prompt.make({ text }), resume: false })
    yield* SessionInput.promoteSteers(db, events, sessionID, Number.MAX_SAFE_INTEGER)
  })

const row = (sessionID: SessionV2.ID) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const found = yield* db
      .select({ directory: SessionTable.directory, project: SessionTable.project_id })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie)
    return found ? { directory: String(found.directory), project: String(found.project) } : undefined
  })

const texts = (sessionID: SessionV2.ID) =>
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    return (yield* store.context(sessionID)).map((item) => (item as { text?: string }).text)
  })

const code = <A>(effect: Effect.Effect<A, unknown>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => (error as { code?: string }).code),
  )

describe("P5a sync manager", () => {
  it.live("AC-P5a-1 settings start off, name the computer and are kept without secrets", () =>
    Effect.gen(function* () {
      const tmp = yield* scratch
      const sync = world(tmp.path)
      yield* Effect.gen(function* () {
        const first = yield* sync.manager("desk")
        const before = yield* first.status()
        expect(before).toMatchObject({ ready: false, enabled: false, bucket: "" })
        expect(before.machine.name).toBe("desk")
        expect(before.machine.id).toMatch(/^desk-[0-9a-f]{6}$/)
        expect(before.missing).toContain("bucket")
        expect(yield* code(first.configure({ bucket: "Not A Bucket" }))).toBe("invalid_name")
        const after = yield* first.configure({ enabled: true, bucket: "my-threads", machineName: "  Desk PC " })
        expect(after).toMatchObject({ ready: true, enabled: true, bucket: "my-threads", missing: [] })
        expect(after.machine).toEqual({ id: before.machine.id, name: "Desk PC" })
        const again = yield* (yield* sync.manager("desk")).status()
        expect(again).toMatchObject({ ready: true, bucket: "my-threads", machine: after.machine })
        const stored = yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "desk-thread-sync.json"), "utf8"))
        expect(stored.includes(sync.made.phrase)).toBe(false)
        expect(stored.includes(Buffer.from(sync.made.key).toString("hex"))).toBe(false)
        expect(stored.includes(Buffer.from(sync.made.key).toString("base64"))).toBe(false)
        expect(JSON.parse(stored)).toMatchObject({ enabled: true, bucket: "my-threads" })
      }).pipe(Effect.provide(sync.on("desk")))
    }),
  )

  it.live("AC-P5a-2 nothing works until sync is ready, and settled never fails", () =>
    Effect.gen(function* () {
      const tmp = yield* scratch
      const sync = world(tmp.path)
      yield* Effect.gen(function* () {
        const id = yield* start("/desk/repo", "not synced yet")
        const off = yield* sync.manager("desk")
        expect(yield* code(off.threads())).toBe("not_ready")
        expect(yield* code(off.push(id))).toBe("not_ready")
        expect(yield* code(off.pull(id))).toBe("not_ready")
        expect(yield* code(off.continueHere(id, { directory: "/desk/repo" }))).toBe("not_ready")
        const result = yield* off.settled(id)
        expect(result.pushed).toBe(false)
        expect(typeof result.reason).toBe("string")
        const keyless = yield* sync.manager("desk", { key: false })
        const status = yield* keyless.configure({ enabled: true, bucket: "my-threads" })
        expect(status.ready).toBe(false)
        expect(status.missing).toEqual(["key"])
        expect(yield* code(keyless.push(id))).toBe("not_ready")
      }).pipe(Effect.provide(sync.on("desk")))
    }),
  )

  it.live("AC-P5a-3 and AC-P5a-4 a settled thread is pushed and seen from the other computer", () =>
    Effect.gen(function* () {
      const tmp = yield* scratch
      const sync = world(tmp.path)

      const id = yield* Effect.gen(function* () {
        const desk = yield* sync.ready("desk")
        const thread = yield* start("/desk/repo", "first on the desk")
        expect(yield* desk.settled(thread)).toMatchObject({ pushed: true })
        expect((yield* desk.settled(thread)).pushed).toBe(false)
        const listed = yield* desk.threads()
        expect(listed).toHaveLength(1)
        expect(listed[0]).toMatchObject({ sessionID: thread, head: 2, mine: true, local: "current", folder: null })
        return thread
      }).pipe(Effect.provide(sync.on("desk")))

      yield* Effect.gen(function* () {
        const laptop = yield* sync.ready("laptop")
        expect((yield* laptop.threads())[0]).toMatchObject({ sessionID: id, mine: false, local: "absent" })
        expect((yield* laptop.settled(id)).pushed).toBe(false)
        expect(yield* laptop.pull(id)).toEqual({ applied: 3, head: 2 })
        expect((yield* laptop.threads())[0]).toMatchObject({ local: "current", mine: false })
      }).pipe(Effect.provide(sync.on("laptop")))

      yield* Effect.gen(function* () {
        const desk = yield* sync.ready("desk")
        yield* say(id, "second on the desk")
        expect((yield* desk.threads())[0].local).toBe("ahead")
        expect(yield* desk.settled(id)).toMatchObject({ pushed: true })
      }).pipe(Effect.provide(sync.on("desk")))

      yield* Effect.gen(function* () {
        const laptop = yield* sync.ready("laptop")
        expect((yield* laptop.threads())[0]).toMatchObject({ local: "behind", head: 4 })
        yield* say(id, "written on the laptop without owning it")
        expect((yield* laptop.threads())[0].local).toBe("diverged")
        expect((yield* laptop.settled(id)).pushed).toBe(false)
      }).pipe(Effect.provide(sync.on("laptop")))
    }),
  )

  it.live("AC-P5a-5 continue here moves the thread to a local folder on this computer only", () =>
    Effect.gen(function* () {
      const tmp = yield* scratch
      const sync = world(tmp.path)

      const id = yield* Effect.gen(function* () {
        const desk = yield* sync.ready("desk")
        const thread = yield* start("/desk/repo", "started on the desk")
        yield* desk.settled(thread)
        return thread
      }).pipe(Effect.provide(sync.on("desk")))

      yield* Effect.gen(function* () {
        const laptop = yield* sync.ready("laptop")
        expect(yield* code(laptop.continueHere(id, { directory: "repo" }))).toBe("invalid_name")
        expect(yield* laptop.continueHere(id, { directory: "/laptop/repo" })).toEqual({ applied: 3, head: 2 })
        expect(yield* row(id)).toEqual({ directory: "/laptop/repo", project: "prj_laptop" })
        const db = (yield* Database.Service).db
        const known = yield* db.select({ id: ProjectTable.id }).from(ProjectTable).all().pipe(Effect.orDie)
        expect(known.map((project) => String(project.id))).toContain("prj_laptop")
        expect((yield* laptop.threads())[0]).toMatchObject({ mine: true, local: "current", folder: "/laptop/repo" })
        yield* say(id, "continued on the laptop")
        expect(yield* laptop.settled(id)).toMatchObject({ pushed: true })
      }).pipe(Effect.provide(sync.on("laptop")))

      yield* Effect.gen(function* () {
        const desk = yield* sync.ready("desk")
        expect(yield* desk.pull(id)).toEqual({ applied: 2, head: 4 })
        expect((yield* row(id))?.directory).toBe("/desk/repo")
        expect((yield* desk.threads())[0]).toMatchObject({ mine: false, folder: null })
        expect(yield* texts(id)).toEqual(["started on the desk", "continued on the laptop"])
      }).pipe(Effect.provide(sync.on("desk")))

      yield* Effect.gen(function* () {
        const db = (yield* Database.Service).db
        yield* db
          .update(SessionTable)
          .set({ directory: AbsolutePath.make("/desk/repo") })
          .where(eq(SessionTable.id, id))
          .run()
          .pipe(Effect.orDie)
        const laptop = yield* sync.manager("laptop")
        expect(yield* laptop.pull(id)).toEqual({ applied: 0, head: 4 })
        expect((yield* row(id))?.directory).toBe("/laptop/repo")
        expect((yield* laptop.threads())[0].folder).toBe("/laptop/repo")
      }).pipe(Effect.provide(sync.on("laptop")))
    }),
  )
})
