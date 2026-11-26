import { describe, expect } from "bun:test"
import path from "node:path"
import { asc, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "../../src/database/database"
import { AppNodeBuilder } from "../../src/effect/app-node-builder"
import { LayerNode } from "../../src/effect/layer-node"
import { EventV2 } from "../../src/event"
import { EventSequenceTable, EventTable } from "../../src/event/sql"
import { Location } from "../../src/location"
import { ProjectTable } from "../../src/project/sql"
import { ProjectV2 } from "../../src/project"
import { AbsolutePath } from "../../src/schema"
import { SessionV2 } from "../../src/session"
import { SessionExecution } from "../../src/session/execution"
import { SessionInput } from "../../src/session/input"
import { Prompt } from "../../src/session/prompt"
import { SessionProjector } from "../../src/session/projector"
import { SessionStore } from "../../src/session/store"
import { ThreadSync } from "../../src/thread-sync"
import { decrypt, encrypt, manifestContext } from "../../src/thread-sync/crypto"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { fakeGcs } from "./gcs-fake"

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
const location = Location.Ref.make({ directory: AbsolutePath.make("/secret-project-folder") })
const desk = { id: "machine-desk-id", name: "DeskMachineName" }
const laptop = { id: "machine-laptop-id", name: "LaptopMachineName" }

const say = (sessionID: SessionV2.ID, text: string) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const events = yield* EventV2.Service
    const db = (yield* Database.Service).db
    yield* session.prompt({ sessionID, prompt: Prompt.make({ text }), resume: false })
    yield* SessionInput.promoteSteers(db, events, sessionID, Number.MAX_SAFE_INTEGER)
  })

const start = (text: string) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const created = yield* session.create({ location, title: "A secret title" })
    yield* say(created.id, text)
    return created.id
  })

const local = (sessionID: string) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const events = yield* db
      .select({ id: EventTable.id, seq: EventTable.seq })
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, sessionID))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(Effect.orDie)
    const owner = yield* db
      .select({ ownerID: EventSequenceTable.owner_id })
      .from(EventSequenceTable)
      .where(eq(EventSequenceTable.aggregate_id, sessionID))
      .get()
      .pipe(Effect.orDie)
    return { events, owner: owner?.ownerID ?? null }
  })

const recording = (store: ThreadSync.Store) => {
  const puts: Array<{ name: string; ifGeneration: string | null | undefined; hasOption: boolean }> = []
  const wrapped: ThreadSync.Store = {
    get: (name) => store.get(name),
    list: (prefix) => store.list(prefix),
    remove: (name) => store.remove(name),
    put: (name, bytes, options) => {
      puts.push({
        name,
        ifGeneration: options?.ifGeneration,
        hasOption: options !== undefined && "ifGeneration" in options,
      })
      return store.put(name, bytes, options)
    },
  }
  return { store: wrapped, puts }
}

const engine = (input: { store: ThreadSync.Store; key: Uint8Array; machine: { id: string; name: string } }) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const events = yield* EventV2.Service
    return ThreadSync.make({ db, events, ...input })
  })

const code = <A>(effect: Effect.Effect<A, ThreadSync.SyncError>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.code),
  )

const temporary = Effect.acquireRelease(
  Effect.promise(() => tmpdir()),
  (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
)

describe("thread sync engine", () => {
  it.live("survives restarts and reopened databases on both computers", () =>
    Effect.gen(function* () {
      const tmp = yield* temporary
      const key = ThreadSync.generateKey().key
      const bucket = path.join(tmp.path, "bucket")
      const deskFile = path.join(tmp.path, "desk.sqlite")
      const laptopFile = path.join(tmp.path, "laptop.sqlite")
      const sessionID = yield* Effect.gen(function* () {
        const id = yield* start("first")
        const sync = yield* engine({ store: ThreadSync.folderStore(bucket), key, machine: desk })
        yield* sync.push(id)
        return id
      }).pipe(Effect.provide(computer(deskFile)))

      yield* Effect.gen(function* () {
        const sync = yield* engine({ store: ThreadSync.folderStore(bucket), key, machine: desk })
        expect(yield* sync.push(sessionID)).toMatchObject({ uploaded: 0 })
        yield* say(sessionID, "second")
        expect(yield* sync.push(sessionID)).toMatchObject({ uploaded: 2 })
      }).pipe(Effect.provide(computer(deskFile)))

      const head = yield* Effect.gen(function* () {
        const sync = yield* engine({ store: ThreadSync.folderStore(bucket), key, machine: laptop })
        return (yield* sync.pull(sessionID)).head
      }).pipe(Effect.provide(computer(laptopFile)))

      yield* Effect.gen(function* () {
        const sync = yield* engine({ store: ThreadSync.folderStore(bucket), key, machine: laptop })
        expect(yield* sync.pull(sessionID)).toEqual({ applied: 0, head })
        expect((yield* local(sessionID)).events).toHaveLength(head + 1)
        expect((yield* local(sessionID)).owner).toBe(desk.id)
      }).pipe(Effect.provide(computer(laptopFile)))
    }),
  )

  it.live("a diverged copy keeps its log and owner, and every put is conditional", () =>
    Effect.gen(function* () {
      const tmp = yield* temporary
      const key = ThreadSync.generateKey().key
      const recorded = recording(ThreadSync.folderStore(path.join(tmp.path, "bucket")))
      const onDesk = computer(path.join(tmp.path, "desk.sqlite"))
      const onLaptop = computer(path.join(tmp.path, "laptop.sqlite"))
      const sessionID = yield* Effect.gen(function* () {
        const id = yield* start("started")
        yield* (yield* engine({ store: recorded.store, key, machine: desk })).push(id)
        return id
      }).pipe(Effect.provide(onDesk))

      yield* Effect.gen(function* () {
        const sync = yield* engine({ store: recorded.store, key, machine: laptop })
        expect(yield* code(sync.remove(sessionID))).toBe("not_owner")
        yield* sync.takeOver(sessionID)
        expect((yield* local(sessionID)).owner).toBe(laptop.id)
        yield* say(sessionID, "on the laptop")
        yield* sync.push(sessionID)
      }).pipe(Effect.provide(onLaptop))

      yield* Effect.gen(function* () {
        const sync = yield* engine({ store: recorded.store, key, machine: desk })
        yield* say(sessionID, "on the desk while away")
        const before = yield* local(sessionID)
        expect(yield* code(sync.pull(sessionID))).toBe("diverged")
        expect(yield* code(sync.takeOver(sessionID))).toBe("diverged")
        expect(yield* code(sync.push(sessionID))).toBe("not_owner")
        expect(yield* local(sessionID)).toEqual(before)
        expect(before.owner).toBe(desk.id)
      }).pipe(Effect.provide(onDesk))

      expect(recorded.puts.length).toBeGreaterThan(3)
      expect(recorded.puts.every((put) => put.hasOption)).toBe(true)
      expect(recorded.puts.every((put) => put.name.startsWith(`threads/${sessionID}/`))).toBe(true)
    }),
  )

  it.live("lists newest first, removes only for the owner and refuses bad input", () =>
    Effect.gen(function* () {
      const tmp = yield* temporary
      const key = ThreadSync.generateKey().key
      const store = ThreadSync.folderStore(path.join(tmp.path, "bucket"))
      yield* Effect.gen(function* () {
        const sync = yield* engine({ store, key, machine: desk })
        const older = yield* start("older")
        yield* sync.push(older)
        yield* Effect.sleep("5 millis")
        const newer = yield* start("newer")
        yield* sync.push(newer)
        expect((yield* sync.list()).map((item) => item.sessionID)).toEqual([newer, older])
        expect(yield* code(sync.pull("ses_missing"))).toBe("not_found")
        expect(yield* code(sync.push("ses_missing"))).toBe("not_found")
        expect(yield* code(sync.pull("../escape"))).toBe("invalid_name")
        const wrongKey = yield* engine({ store, key: ThreadSync.generateKey().key, machine: desk })
        expect(yield* code(wrongKey.pull(older))).toBe("unreadable")
        expect(yield* code(wrongKey.list())).toBe("unreadable")
        const shortKey = yield* engine({ store, key: new Uint8Array(8), machine: desk })
        expect(yield* code(shortKey.push(older))).toBe("invalid_key")
        yield* sync.remove(older)
        expect((yield* sync.list()).map((item) => item.sessionID)).toEqual([newer])
        expect(yield* Effect.promise(() => store.list(`threads/${older}/`))).toEqual([])
        expect((yield* local(older)).events.length).toBeGreaterThan(0)
      }).pipe(Effect.provide(computer(path.join(tmp.path, "desk.sqlite"))))
    }),
  )

  it.live("stores nothing readable in Cloud Storage", () =>
    Effect.gen(function* () {
      const tmp = yield* temporary
      const gcs = fakeGcs()
      yield* Effect.addFinalizer(() => Effect.promise(() => gcs.stop()))
      const store = ThreadSync.gcsStore({ bucket: "b", endpoint: gcs.endpoint, token: async () => gcs.token })
      yield* Effect.gen(function* () {
        const sync = yield* engine({ store, key: ThreadSync.generateKey().key, machine: desk })
        const id = yield* start("a confidential prompt")
        yield* sync.push(id)
        expect((yield* sync.list())[0]).toMatchObject({ sessionID: id, owner: desk, directory: location.directory })
      }).pipe(Effect.provide(computer(path.join(tmp.path, "desk.sqlite"))))
      const stored = [...gcs.objects.values()].map((object) => Buffer.from(object.bytes))
      for (const secret of ["a confidential prompt", desk.id, desk.name, "secret-project-folder", "A secret title"])
        expect(stored.filter((bytes) => bytes.includes(secret))).toEqual([])
      expect([...gcs.objects.keys()].every((name) => /^b\/threads\/ses_[A-Za-z0-9]+\/[a-z0-9-]+$/.test(name))).toBe(
        true,
      )
    }),
  )

  it.live("a folder this computer cannot hold is foreign_path before anything local changes", () =>
    Effect.gen(function* () {
      const tmp = yield* temporary
      const key = ThreadSync.generateKey().key
      const store = ThreadSync.folderStore(path.join(tmp.path, "bucket"))
      const sessionID = yield* Effect.gen(function* () {
        const id = yield* start("from another system")
        yield* (yield* engine({ store, key, machine: desk })).push(id)
        return id
      }).pipe(Effect.provide(computer(path.join(tmp.path, "desk.sqlite"))))
      const foreign = process.platform === "win32" ? "relative\\project" : "C:\\Users\\desk\\project"
      const name = `threads/${sessionID}/manifest`
      yield* Effect.promise(async () => {
        const stored = await store.get(name)
        const manifest = JSON.parse(await decrypt(key, manifestContext(sessionID), stored!.bytes)) as Record<
          string,
          unknown
        >
        const changed = JSON.stringify({ ...manifest, directory: foreign })
        await store.put(name, await encrypt(key, manifestContext(sessionID), changed), {
          ifGeneration: stored!.generation,
        })
      })
      yield* Effect.gen(function* () {
        const sync = yield* engine({ store, key, machine: laptop })
        expect(yield* code(sync.pull(sessionID))).toBe("foreign_path")
        expect(yield* code(sync.takeOver(sessionID))).toBe("foreign_path")
        expect(yield* local(sessionID)).toEqual({ events: [], owner: null })
        expect((yield* sync.list())[0].owner).toEqual(desk)
      }).pipe(Effect.provide(computer(path.join(tmp.path, "laptop.sqlite"))))
    }),
  )

  it.live("events this version cannot apply are unsupported and leave nothing behind", () =>
    Effect.gen(function* () {
      const tmp = yield* temporary
      const key = ThreadSync.generateKey().key
      const store = ThreadSync.folderStore(path.join(tmp.path, "bucket"))
      const ids = yield* Effect.gen(function* () {
        const sync = yield* engine({ store, key, machine: desk })
        const future = yield* start("from a newer version")
        yield* say(future, "more")
        yield* sync.push(future)
        const broken = yield* start("with broken data")
        yield* sync.push(broken)
        const good = yield* start("a good thread")
        yield* sync.push(good)
        return { future, broken, good }
      }).pipe(Effect.provide(computer(path.join(tmp.path, "desk.sqlite"))))
      yield* rewrite(store, key, ids.future, (events) =>
        events.map((event, index) => (index === events.length - 1 ? { ...event, type: "future.event.1" } : event)),
      )
      yield* rewrite(store, key, ids.broken, (events) =>
        events.map((event, index) => (index === events.length - 1 ? { ...event, data: { unexpected: true } } : event)),
      )
      yield* Effect.gen(function* () {
        const sync = yield* engine({ store, key, machine: laptop })
        for (const sessionID of [ids.future, ids.broken]) {
          expect(yield* code(sync.pull(sessionID))).toBe("unsupported")
          expect(yield* code(sync.takeOver(sessionID))).toBe("unsupported")
          expect(yield* local(sessionID)).toEqual({ events: [], owner: null })
        }
        expect(yield* projectCount).toBe(0)
        expect((yield* sync.pull(ids.good)).applied).toBe(3)
        expect((yield* local(ids.good)).owner).toBe(desk.id)
        expect(yield* projectCount).toBe(1)
      }).pipe(Effect.provide(computer(path.join(tmp.path, "laptop.sqlite"))))
    }),
  )

  it.live("a pull onto a local prefix keeps the prefix and adds nothing when it cannot apply", () =>
    Effect.gen(function* () {
      const tmp = yield* temporary
      const key = ThreadSync.generateKey().key
      const store = ThreadSync.folderStore(path.join(tmp.path, "bucket"))
      const onDesk = computer(path.join(tmp.path, "desk.sqlite"))
      const onLaptop = computer(path.join(tmp.path, "laptop.sqlite"))
      const sessionID = yield* Effect.gen(function* () {
        const id = yield* start("first part")
        yield* (yield* engine({ store, key, machine: desk })).push(id)
        return id
      }).pipe(Effect.provide(onDesk))
      yield* Effect.gen(function* () {
        yield* (yield* engine({ store, key, machine: laptop })).pull(sessionID)
      }).pipe(Effect.provide(onLaptop))
      yield* Effect.gen(function* () {
        yield* say(sessionID, "second part")
        yield* (yield* engine({ store, key, machine: desk })).push(sessionID)
      }).pipe(Effect.provide(onDesk))
      yield* rewrite(store, key, sessionID, (events) =>
        events.map((event, index) => (index === events.length - 1 ? { ...event, type: "future.event.1" } : event)),
      )
      yield* Effect.gen(function* () {
        const sync = yield* engine({ store, key, machine: laptop })
        const before = yield* local(sessionID)
        expect(before.events).toHaveLength(3)
        expect(yield* code(sync.pull(sessionID))).toBe("unsupported")
        expect(yield* local(sessionID)).toEqual(before)
      }).pipe(Effect.provide(onLaptop))
    }),
  )

  it.live("a replay that fails partway is rolled back with the project row", () =>
    Effect.gen(function* () {
      const tmp = yield* temporary
      const key = ThreadSync.generateKey().key
      const store = ThreadSync.folderStore(path.join(tmp.path, "bucket"))
      const sessionID = yield* Effect.gen(function* () {
        const id = yield* start("replayed then refused")
        yield* say(id, "more")
        yield* (yield* engine({ store, key, machine: desk })).push(id)
        return id
      }).pipe(Effect.provide(computer(path.join(tmp.path, "desk.sqlite"))))
      yield* rewrite(store, key, sessionID, (events) =>
        events.map((event, index) => (index === events.length - 1 ? { ...event, id: events[0].id } : event)),
      )
      yield* Effect.gen(function* () {
        const sync = yield* engine({ store, key, machine: laptop })
        expect(yield* code(sync.pull(sessionID))).toBe("unsupported")
        expect(yield* local(sessionID)).toEqual({ events: [], owner: null })
        expect(yield* projectCount).toBe(0)
      }).pipe(Effect.provide(computer(path.join(tmp.path, "laptop.sqlite"))))
    }),
  )
})

const projectCount = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  return (yield* db.select({ id: ProjectTable.id }).from(ProjectTable).all().pipe(Effect.orDie)).length
})

const rewrite = (
  store: ThreadSync.Store,
  key: Uint8Array,
  sessionID: string,
  change: (events: EventV2.SerializedEvent[]) => EventV2.SerializedEvent[],
) =>
  Effect.promise(async () => {
    const name = `threads/${sessionID}/manifest`
    const stored = await store.get(name)
    const manifest = JSON.parse(await decrypt(key, manifestContext(sessionID), stored!.bytes)) as {
      segments: Array<{ name: string; hash: string }>
    }
    const segments = await Promise.all(
      manifest.segments.map(async (segment, index) =>
        ThreadSync.open({
          key,
          sessionID,
          previous: index === 0 ? null : manifest.segments[index - 1].hash,
          bytes: (await store.get(segment.name))!.bytes,
        }),
      ),
    )
    const sealed = await ThreadSync.seal({
      key,
      sessionID,
      previous: null,
      events: change(segments.flatMap((segment) => segment.events)),
    })
    const segment = `threads/${sessionID}/segment-rewritten-${sealed.hash}`
    await store.put(segment, sealed.bytes, { ifGeneration: null })
    const changed = {
      ...manifest,
      segments: [{ name: segment, hash: sealed.hash, first: sealed.first, last: sealed.last }],
    }
    await store.put(name, await encrypt(key, manifestContext(sessionID), JSON.stringify(changed)), {
      ifGeneration: stored!.generation,
    })
  })
