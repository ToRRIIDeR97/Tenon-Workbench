import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Layer } from "effect"
import { asc, eq } from "drizzle-orm"
import { Database } from "../../src/database/database"
import { AppNodeBuilder } from "../../src/effect/app-node-builder"
import { LayerNode } from "../../src/effect/layer-node"
import { EventV2 } from "../../src/event"
import { EventTable } from "../../src/event/sql"
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
import { fakeDrive } from "./drive-fake"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const computer = (file: string) =>
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [Database.node, Database.layerFromPath(file)],
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  )

const it = testEffect(Layer.empty)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const desk = { id: "machine-desk", name: "Desk" }
const laptop = { id: "machine-laptop", name: "Laptop" }

const say = (sessionID: SessionV2.ID, text: string) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const events = yield* EventV2.Service
    const db = (yield* Database.Service).db
    yield* session.prompt({ sessionID, prompt: Prompt.make({ text }), resume: false })
    yield* SessionInput.promoteSteers(db, events, sessionID, Number.MAX_SAFE_INTEGER)
  })

const logLength = (sessionID: string) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    return (yield* db
      .select()
      .from(EventTable)
      .where(eq(EventTable.aggregate_id, sessionID))
      .orderBy(asc(EventTable.seq))
      .all()
      .pipe(Effect.orDie)).length
  })

const texts = (sessionID: SessionV2.ID) =>
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    return (yield* store.context(sessionID)).map((item) => (item as { text?: string }).text)
  })

const sync = (input: { store: ThreadSync.Store; key: Uint8Array; machine: { id: string; name: string } }) =>
  Effect.gen(function* () {
    return ThreadSync.make({ db: (yield* Database.Service).db, events: yield* EventV2.Service, ...input })
  })

const code = <A>(effect: Effect.Effect<A, unknown>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => (error as { code?: string }).code),
  )

const thrown = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return (error as { code?: string }).code
  }
  return "no error"
}

const rejected = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: { code?: string }) => error.code,
  )

const event = (seq: number, text: string) =>
  ({
    id: `evt_segment_${seq}`,
    aggregateID: "ses_segment",
    seq,
    type: "test.message.1",
    data: { text },
  }) as unknown as EventV2.SerializedEvent

const bytesOf = async (directory: string): Promise<Buffer[]> =>
  (
    await Promise.all(
      (await fs.readdir(directory, { withFileTypes: true })).map((entry) =>
        entry.isDirectory()
          ? bytesOf(path.join(directory, entry.name))
          : fs.readFile(path.join(directory, entry.name)).then((file) => [file]),
      ),
    )
  ).flat()

const kinds: Array<"folder" | "drive"> = ["folder", "drive"]

const storeOf = (kind: "folder" | "drive", directory: string) =>
  kind === "folder"
    ? Effect.succeed({
        store: ThreadSync.folderStore(path.join(directory, "bucket")),
        stored: () => bytesOf(path.join(directory, "bucket")),
      })
    : Effect.acquireRelease(
        Effect.sync(() => fakeDrive()),
        (drive) => Effect.promise(() => drive.stop()),
      ).pipe(
        Effect.map((drive) => ({
          store: ThreadSync.driveStore({ endpoint: drive.endpoint, token: async () => drive.token }),
          stored: async () =>
            [...drive.files.values()].map((file) =>
              Buffer.concat([
                Buffer.from(file.bytes),
                Buffer.from(file.name),
                Buffer.from(JSON.stringify(file.appProperties)),
              ]),
            ),
        })),
      )

describe("P4 sync key", () => {
  test("AC-P4-1 a generated key is 32 bytes and comes back from its phrase", () => {
    const made = ThreadSync.generateKey()
    expect(made.key).toBeInstanceOf(Uint8Array)
    expect(made.key.length).toBe(32)
    expect([...ThreadSync.keyFromPhrase(made.phrase)]).toEqual([...made.key])
    expect([...ThreadSync.keyFromPhrase(`  ${made.phrase}\n`)]).toEqual([...made.key])
    expect(ThreadSync.generateKey().phrase).not.toBe(made.phrase)
  })

  test("AC-P4-1 a phrase that is not a key is refused", () => {
    expect(thrown(() => ThreadSync.keyFromPhrase("not a key"))).toBe("invalid_key")
    expect(thrown(() => ThreadSync.keyFromPhrase(""))).toBe("invalid_key")
  })
})

describe("P4 segments", () => {
  test("AC-P4-2 a sealed segment opens to the same events", async () => {
    const key = ThreadSync.generateKey().key
    const events = [event(0, "first secret text"), event(1, "second secret text")]
    const sealed = await ThreadSync.seal({ key, sessionID: "ses_segment", previous: null, events })
    expect(sealed.first).toBe(0)
    expect(sealed.last).toBe(1)
    expect(sealed.hash).toBe(createHash("sha256").update(sealed.bytes).digest("hex"))
    const opened = await ThreadSync.open({ key, sessionID: "ses_segment", previous: null, bytes: sealed.bytes })
    expect(opened.events).toEqual(events)
    expect(opened.hash).toBe(sealed.hash)
    expect([opened.first, opened.last]).toEqual([0, 1])
  })

  test("AC-P4-2 a segment holds no readable text and never repeats", async () => {
    const key = ThreadSync.generateKey().key
    const input = { key, sessionID: "ses_segment", previous: null, events: [event(0, "first secret text")] }
    const one = await ThreadSync.seal(input)
    const two = await ThreadSync.seal(input)
    expect(Buffer.from(one.bytes).includes("secret text")).toBe(false)
    expect(Buffer.from(one.bytes).equals(Buffer.from(two.bytes))).toBe(false)
  })

  test("AC-P4-3 another key or a changed byte cannot be opened", async () => {
    const key = ThreadSync.generateKey().key
    const sealed = await ThreadSync.seal({ key, sessionID: "ses_segment", previous: null, events: [event(0, "text")] })
    const other = ThreadSync.generateKey().key
    expect(
      await rejected(ThreadSync.open({ key: other, sessionID: "ses_segment", previous: null, bytes: sealed.bytes })),
    ).toBe("unreadable")
    const changed = Uint8Array.from(sealed.bytes)
    changed[changed.length - 1] ^= 1
    expect(await rejected(ThreadSync.open({ key, sessionID: "ses_segment", previous: null, bytes: changed }))).toBe(
      "unreadable",
    )
  })
})

describe("P4 folder store", () => {
  test("AC-P4-4 conditional writes, listing and removal", async () => {
    await using tmp = await tmpdir()
    const store = ThreadSync.folderStore(path.join(tmp.path, "bucket"))
    const text = (value: string) => new TextEncoder().encode(value)
    expect(await store.get("threads/a/manifest")).toBeUndefined()
    const first = await store.put("threads/a/manifest", text("one"), { ifGeneration: null })
    expect(await rejected(store.put("threads/a/manifest", text("two"), { ifGeneration: null }))).toBe("conflict")
    const second = await store.put("threads/a/manifest", text("two"), { ifGeneration: first.generation })
    expect(second.generation).not.toBe(first.generation)
    expect(await rejected(store.put("threads/a/manifest", text("three"), { ifGeneration: first.generation }))).toBe(
      "conflict",
    )
    const read = await store.get("threads/a/manifest")
    expect(new TextDecoder().decode(read!.bytes)).toBe("two")
    expect(read!.generation).toBe(second.generation)
    await store.put("threads/a/segment-0", text("s"))
    await store.put("threads/b/manifest", text("other"))
    expect((await store.list("threads/a/")).map((item) => item.name)).toEqual([
      "threads/a/manifest",
      "threads/a/segment-0",
    ])
    expect((await store.list("threads/a/"))[0].size).toBe(3)
    await store.remove("threads/a/segment-0")
    await store.remove("threads/a/segment-0")
    expect((await store.list("threads/a/")).map((item) => item.name)).toEqual(["threads/a/manifest"])
  })

  test("AC-P4-4 names that could leave the folder are refused", async () => {
    await using tmp = await tmpdir()
    const store = ThreadSync.folderStore(path.join(tmp.path, "bucket"))
    expect(await rejected(store.put("../outside", new Uint8Array([1])))).toBe("invalid_name")
    expect(await rejected(store.get("threads/../../outside"))).toBe("invalid_name")
  })
})

describe("P4 Google Drive store", () => {
  test("AC-P4-5 is replaced by AC-P4b-1 to 8: Cloud Storage is gone, the store is Google Drive", () => {
    expect("gcsStore" in ThreadSync).toBe(false)
    expect(typeof ThreadSync.driveStore).toBe("function")
  })
})

describe.each(kinds)("P4 engine on the %s store", (kind) => {
  it.live("AC-P4-6 a thread pushed from one computer continues on another", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      const { store } = yield* storeOf(kind, tmp.path)
      const key = ThreadSync.generateKey().key
      const onDesk = Layer.fresh(computer(path.join(tmp.path, "desk.sqlite")))
      const onLaptop = Layer.fresh(computer(path.join(tmp.path, "laptop.sqlite")))

      const sessionID = yield* Effect.gen(function* () {
        const session = yield* SessionV2.Service
        const created = yield* session.create({ location })
        yield* say(created.id, "hello from the desk")
        const engine = yield* sync({ store, key, machine: desk })
        expect(yield* engine.push(created.id)).toEqual({ uploaded: 3, head: 2 })
        expect(yield* engine.push(created.id)).toEqual({ uploaded: 0, head: 2 })
        return created.id
      }).pipe(Effect.provide(onDesk))

      yield* Effect.gen(function* () {
        const engine = yield* sync({ store, key, machine: laptop })
        const listed = yield* engine.list()
        expect(listed).toHaveLength(1)
        expect(listed[0]).toMatchObject({ sessionID, head: 2, owner: desk, directory: location.directory })
        expect(yield* engine.pull(sessionID)).toEqual({ applied: 3, head: 2 })
        expect(yield* engine.pull(sessionID)).toEqual({ applied: 0, head: 2 })
        expect(yield* texts(sessionID)).toEqual(["hello from the desk"])
        expect(yield* logLength(sessionID)).toBe(3)
      }).pipe(Effect.provide(onLaptop))
    }),
  )

  it.live("AC-P4-7 taking a thread over moves ownership", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      const { store } = yield* storeOf(kind, tmp.path)
      const key = ThreadSync.generateKey().key
      const onDesk = Layer.fresh(computer(path.join(tmp.path, "desk.sqlite")))
      const onLaptop = Layer.fresh(computer(path.join(tmp.path, "laptop.sqlite")))

      const sessionID = yield* Effect.gen(function* () {
        const session = yield* SessionV2.Service
        const created = yield* session.create({ location })
        yield* say(created.id, "started at the desk")
        yield* (yield* sync({ store, key, machine: desk })).push(created.id)
        return created.id
      }).pipe(Effect.provide(onDesk))

      yield* Effect.gen(function* () {
        const engine = yield* sync({ store, key, machine: laptop })
        yield* engine.pull(sessionID)
        expect(yield* code(engine.push(sessionID))).toBe("not_owner")
        expect(yield* engine.takeOver(sessionID)).toEqual({ applied: 0, head: 2 })
        yield* say(sessionID, "continued on the laptop")
        expect(yield* engine.push(sessionID)).toEqual({ uploaded: 2, head: 4 })
        expect((yield* engine.list())[0]).toMatchObject({ sessionID, head: 4, owner: laptop })
      }).pipe(Effect.provide(onLaptop))

      yield* Effect.gen(function* () {
        const engine = yield* sync({ store, key, machine: desk })
        expect(yield* code(engine.push(sessionID))).toBe("not_owner")
        expect(yield* engine.pull(sessionID)).toEqual({ applied: 2, head: 4 })
        expect(yield* texts(sessionID)).toEqual(["started at the desk", "continued on the laptop"])
      }).pipe(Effect.provide(onDesk))
    }),
  )

  it.live("AC-P4-8 nothing readable is stored", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      const target = yield* storeOf(kind, tmp.path)
      yield* Effect.gen(function* () {
        const session = yield* SessionV2.Service
        const created = yield* session.create({ location })
        yield* say(created.id, "a very private sentence")
        const engine = yield* sync({
          store: target.store,
          key: ThreadSync.generateKey().key,
          machine: desk,
        })
        yield* engine.push(created.id)
      }).pipe(Effect.provide(Layer.fresh(computer(path.join(tmp.path, "desk.sqlite")))))
      const files = yield* Effect.promise(() => target.stored())
      expect(files.length).toBeGreaterThan(1)
      expect(files.filter((file) => file.includes("a very private sentence"))).toEqual([])
      expect(files.filter((file) => file.includes("Desk"))).toEqual([])
    }),
  )
})
