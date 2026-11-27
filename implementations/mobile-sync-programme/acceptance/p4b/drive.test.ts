import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Database } from "../../src/database/database"
import { AppNodeBuilder } from "../../src/effect/app-node-builder"
import { LayerNode } from "../../src/effect/layer-node"
import { EventV2 } from "../../src/event"
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
import type { FakeDrive } from "./drive-fake"

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
const location = Location.Ref.make({ directory: AbsolutePath.make("/private-project-folder") })
const desk = { id: "machine-desk-id", name: "DeskComputerName" }
const laptop = { id: "machine-laptop-id", name: "LaptopComputerName" }

const bytes = (text: string) => new TextEncoder().encode(text)
const text = (value: Uint8Array | undefined) => (value ? new TextDecoder().decode(value) : undefined)

const rejected = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: { code?: string }) => error.code,
  )

const settle = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: { code?: string }) => error.code,
  )

const storeOn = (drive: FakeDrive, folder?: string) =>
  ThreadSync.driveStore({
    endpoint: drive.endpoint,
    token: async () => drive.token,
    ...(folder === undefined ? {} : { folder }),
  })

const withDrive = async (run: (drive: FakeDrive) => Promise<void>, options: { pageSize?: number } = {}) => {
  const drive = fakeDrive(options)
  try {
    await run(drive)
  } finally {
    await drive.stop()
  }
}

const say = (sessionID: SessionV2.ID, value: string) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const events = yield* EventV2.Service
    const db = (yield* Database.Service).db
    yield* session.prompt({ sessionID, prompt: Prompt.make({ text: value }), resume: false })
    yield* SessionInput.promoteSteers(db, events, sessionID, Number.MAX_SAFE_INTEGER)
  })

const texts = (sessionID: SessionV2.ID) =>
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    return (yield* store.context(sessionID)).map((item) => (item as { text?: string }).text)
  })

const engine = (input: { store: ThreadSync.Store; key: Uint8Array; machine: { id: string; name: string } }) =>
  Effect.gen(function* () {
    return ThreadSync.make({ db: (yield* Database.Service).db, events: yield* EventV2.Service, ...input })
  })

const code = <A>(effect: Effect.Effect<A, unknown>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => (error as { code?: string }).code),
  )

const scratch = Effect.acquireRelease(
  Effect.promise(() => tmpdir()),
  (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
)

const driveScope = Effect.acquireRelease(
  Effect.sync(() => fakeDrive()),
  (drive) => Effect.promise(() => drive.stop()),
)

describe("P4b Drive requests", () => {
  test("AC-P4b-1 uses Drive v3 in a visible folder with a bearer token and never changes a file", () =>
    withDrive(async (drive) => {
      const store = storeOn(drive)
      expect(await store.get("threads/ses_a/manifest")).toBeUndefined()
      const written = await store.put("threads/ses_a/manifest", bytes("one"), { ifGeneration: null })
      expect((await store.get("threads/ses_a/manifest"))?.generation).toBe(written.generation)
      await store.list("threads/")
      await store.remove("threads/ses_a/manifest")
      expect(drive.requests.length).toBeGreaterThan(4)
      expect(drive.requests.every((request) => request.authorization === `Bearer ${drive.token}`)).toBe(true)
      expect(
        drive.requests.every(
          (request) => request.method === "GET" || request.method === "POST" || request.method === "DELETE",
        ),
      ).toBe(true)
      expect(drive.requests.some((request) => `${request.path}${request.search}`.includes("appDataFolder"))).toBe(false)
      const creates = drive.requests.filter((request) => request.path === "/upload/drive/v3/files")
      expect(creates.length).toBeGreaterThan(0)
      expect(creates.every((request) => new URLSearchParams(request.search).get("uploadType") === "multipart")).toBe(
        true,
      )
      const listings = drive.requests.filter(
        (request) => request.method === "GET" && request.path === "/drive/v3/files",
      )
      expect(listings.length).toBeGreaterThan(0)
      expect(listings.every((request) => new URLSearchParams(request.search).get("spaces") === "drive")).toBe(true)
      expect(listings.every((request) => request.q?.includes("trashed = false"))).toBe(true)
      const folders = drive.folders()
      expect(folders.map((folder) => folder.name)).toEqual(["Tenon Workbench Threads"])
      expect(folders[0].parents).toEqual(["root"])
    }))

  test("AC-P4b-1 a version is a file in the folder with a readable Tenon name", () =>
    withDrive(async (drive) => {
      const store = storeOn(drive)
      await store.put("threads/ses_named/manifest", bytes("x"), { ifGeneration: null })
      const [version] = drive.versions("threads/ses_named/manifest")
      expect(version.name).toBe("Tenon sync - threads - ses_named - manifest")
      expect(version.parents).toEqual([drive.folders()[0].id])
      expect(version.appProperties.tenonSync).toBe("v1")
    }))
})

describe("P4b store contract", () => {
  test("AC-P4b-2 conditional writes, listing and removal", () =>
    withDrive(async (drive) => {
      const store = storeOn(drive)
      expect(await store.get("threads/a/manifest")).toBeUndefined()
      const first = await store.put("threads/a/manifest", bytes("one"), { ifGeneration: null })
      expect(await rejected(store.put("threads/a/manifest", bytes("two"), { ifGeneration: null }))).toBe("conflict")
      const second = await store.put("threads/a/manifest", bytes("two"), { ifGeneration: first.generation })
      expect(second.generation).not.toBe(first.generation)
      expect(await rejected(store.put("threads/a/manifest", bytes("three"), { ifGeneration: first.generation }))).toBe(
        "conflict",
      )
      const read = await store.get("threads/a/manifest")
      expect(text(read?.bytes)).toBe("two")
      expect(read?.generation).toBe(second.generation)
      const third = await store.put("threads/a/manifest", bytes("free"))
      expect(third.generation).not.toBe(second.generation)
      await store.put("threads/a/segment-0", bytes("s"))
      await store.put("threads/b/manifest", bytes("other"))
      expect(await store.list("threads/a/")).toEqual([
        { name: "threads/a/manifest", generation: third.generation, size: 4 },
        { name: "threads/a/segment-0", generation: expect.any(String), size: 1 },
      ])
      expect((await store.list("threads/")).map((item) => item.name)).toEqual([
        "threads/a/manifest",
        "threads/a/segment-0",
        "threads/b/manifest",
      ])
      await store.remove("threads/a/segment-0")
      await store.remove("threads/a/segment-0")
      expect((await store.list("threads/a/")).map((item) => item.name)).toEqual(["threads/a/manifest"])
      expect(drive.versions("threads/a/segment-0")).toEqual([])
    }))

  test("AC-P4b-2 unsafe or too long names are refused and send nothing", () =>
    withDrive(async (drive) => {
      const store = storeOn(drive)
      const unsafe = ["", "/a", "a/", "a//b", "../a", "a/./b", "a\\b", "a b", "a/ü", `threads/${"x".repeat(101)}`]
      for (const name of unsafe) {
        expect(await rejected(store.get(name))).toBe("invalid_name")
        expect(await rejected(store.put(name, bytes("1")))).toBe("invalid_name")
        expect(await rejected(store.remove(name))).toBe("invalid_name")
      }
      expect(await rejected(store.put(`${"d".repeat(101)}/manifest`, bytes("1")))).toBe("invalid_name")
      for (const prefix of ["", "/", "../", "a//", "a\\"])
        expect(await rejected(store.list(prefix))).toBe("invalid_name")
      expect(drive.requests).toEqual([])
      expect(await store.list("threads/")).toEqual([])
      await store.put(`threads/${"y".repeat(100)}`, bytes("1"))
    }))
})

describe("P4b folder", () => {
  test("AC-P4b-3 no folder before the first write, then one, kept across a restart", () =>
    withDrive(async (drive) => {
      const store = storeOn(drive, "My Tenon threads")
      await store.get("threads/a/manifest")
      await store.list("threads/")
      await store.remove("threads/a/manifest")
      expect(drive.folders()).toEqual([])
      await store.put("threads/a/manifest", bytes("one"), { ifGeneration: null })
      await store.put("threads/b/manifest", bytes("two"), { ifGeneration: null })
      expect(drive.folders().map((folder) => folder.name)).toEqual(["My Tenon threads"])
      const restarted = storeOn(drive, "My Tenon threads")
      expect(text((await restarted.get("threads/a/manifest"))?.bytes)).toBe("one")
      await restarted.put("threads/c/manifest", bytes("three"), { ifGeneration: null })
      expect(drive.folders()).toHaveLength(1)
    }))

  test("AC-P4b-3 versions in another Tenon folder or moved out are read, and a renamed folder keeps being used", () =>
    withDrive(async (drive) => {
      const one = storeOn(drive)
      await one.put("threads/a/manifest", bytes("from one"), { ifGeneration: null })
      const other = drive.seedFolder("Tenon Workbench Threads")
      const elsewhere = drive.seedFolder("Not the sync folder")
      const [version] = drive.versions("threads/a/manifest")
      drive.user.move(version.id, other.id)
      const two = storeOn(drive)
      expect(text((await two.get("threads/a/manifest"))?.bytes)).toBe("from one")
      drive.user.move(version.id, elsewhere.id)
      drive.user.rename(version.id, "renamed by the user")
      expect(text((await two.get("threads/a/manifest"))?.bytes)).toBe("from one")
      const chosen = drive.folders().toSorted((a, b) => (a.createdTime < b.createdTime ? -1 : 1))[0]
      drive.user.rename(chosen.id, "Renamed by the user")
      drive.user.rename(other.id, "Also renamed")
      const three = storeOn(drive)
      await three.put("threads/b/manifest", bytes("b"), { ifGeneration: null })
      expect(drive.versions("threads/b/manifest")[0].parents).toEqual([chosen.id])
      expect(drive.folders()).toHaveLength(3)
    }))

  test("AC-P4b-3 a folder in the bin hides its versions and the next write makes a new folder", () =>
    withDrive(async (drive) => {
      const store = storeOn(drive)
      await store.put("threads/a/manifest", bytes("one"), { ifGeneration: null })
      const [folder] = drive.folders()
      drive.user.trash(folder.id)
      const fresh = storeOn(drive)
      expect(await fresh.get("threads/a/manifest")).toBeUndefined()
      expect(await fresh.list("threads/")).toEqual([])
      await fresh.put("threads/a/manifest", bytes("again"), { ifGeneration: null })
      expect(drive.folders().filter((item) => !item.trashed)).toHaveLength(1)
      expect(drive.folders()).toHaveLength(2)
      expect(text((await fresh.get("threads/a/manifest"))?.bytes)).toBe("again")
    }))
})

describe("P4b conditional writes", () => {
  test("AC-P4b-4 two interleaved writers: exactly one wins", () =>
    withDrive(async (drive) => {
      const a = storeOn(drive)
      const b = storeOn(drive)
      const base = await a.put("threads/race/manifest", bytes("base"), { ifGeneration: null })
      const held = drive.holdNextCreate()
      const first = settle(a.put("threads/race/manifest", bytes("from a"), { ifGeneration: base.generation }))
      await held.arrived
      expect(await settle(b.put("threads/race/manifest", bytes("from b"), { ifGeneration: base.generation }))).toBe(
        "ok",
      )
      held.release()
      expect(await first).toBe("conflict")
      expect(text((await a.get("threads/race/manifest"))?.bytes)).toBe("from b")
      expect(text((await b.get("threads/race/manifest"))?.bytes)).toBe("from b")
    }))

  test("AC-P4b-4 two first writes of a free name: exactly one wins", () =>
    withDrive(async (drive) => {
      const a = storeOn(drive)
      const b = storeOn(drive)
      await a.put("threads/other/manifest", bytes("make the folder"), { ifGeneration: null })
      const held = drive.holdNextCreate()
      const first = settle(a.put("threads/free/manifest", bytes("from a"), { ifGeneration: null }))
      await held.arrived
      expect(await settle(b.put("threads/free/manifest", bytes("from b"), { ifGeneration: null }))).toBe("ok")
      held.release()
      expect(await first).toBe("conflict")
      expect(text((await a.get("threads/free/manifest"))?.bytes)).toBe("from b")
    }))

  test(
    "AC-P4b-4 a lost reply after the create landed is a success, never a conflict",
    () =>
      withDrive(async (drive) => {
        const store = storeOn(drive)
        const base = await store.put("threads/lost/manifest", bytes("base"), { ifGeneration: null })
        drive.loseCreateReplies(1)
        const once = await store.put("threads/lost/manifest", bytes("once"), { ifGeneration: base.generation })
        expect(text((await store.get("threads/lost/manifest"))?.bytes)).toBe("once")
        expect((await store.get("threads/lost/manifest"))?.generation).toBe(once.generation)
        drive.loseCreateReplies(100)
        const always = await store.put("threads/lost/manifest", bytes("always"), { ifGeneration: once.generation })
        drive.loseCreateReplies(0)
        expect((await store.get("threads/lost/manifest"))?.generation).toBe(always.generation)
        expect(text((await store.get("threads/lost/manifest"))?.bytes)).toBe("always")
        drive.malformedNext("create")
        const malformed = await store.put("threads/lost/manifest", bytes("malformed"), {
          ifGeneration: always.generation,
        })
        expect((await store.get("threads/lost/manifest"))?.generation).toBe(malformed.generation)
      }),
    30_000,
  )

  test(
    "AC-P4b-4 a stale listing once gives no wrong answer",
    () =>
      withDrive(async (drive) => {
        const store = storeOn(drive)
        const first = await store.put("threads/stale/manifest", bytes("one"), { ifGeneration: null })
        drive.fail(10, { status: 400, reason: "badRequest", method: "DELETE" })
        const second = await store.put("threads/stale/manifest", bytes("two"), { ifGeneration: first.generation })
        drive.clearFaults()
        expect(drive.versions("threads/stale/manifest")).toHaveLength(2)
        drive.staleListings(1)
        expect(
          await rejected(store.put("threads/stale/manifest", bytes("stale"), { ifGeneration: first.generation })),
        ).toBe("conflict")
        expect(text((await store.get("threads/stale/manifest"))?.bytes)).toBe("two")
        const held = drive.holdNextCreate()
        const pending = settle(store.put("threads/stale/manifest", bytes("three"), { ifGeneration: second.generation }))
        await held.arrived
        drive.staleListings(1)
        held.release()
        expect(await pending).toBe("ok")
        expect(text((await store.get("threads/stale/manifest"))?.bytes)).toBe("three")
      }),
    30_000,
  )

  test("AC-P4b-4 a write that lands late never displaces a reported winner", () =>
    withDrive(async (drive) => {
      const a = storeOn(drive)
      const b = storeOn(drive)
      const base = await a.put("threads/late/manifest", bytes("base"), { ifGeneration: null })
      const held = drive.holdNextCreate()
      const late = settle(a.put("threads/late/manifest", bytes("late"), { ifGeneration: base.generation }))
      await held.arrived
      const one = await b.put("threads/late/manifest", bytes("b one"), { ifGeneration: base.generation })
      const two = await b.put("threads/late/manifest", bytes("b two"), { ifGeneration: one.generation })
      held.release()
      expect(await late).toBe("conflict")
      expect((await b.get("threads/late/manifest"))?.generation).toBe(two.generation)
      expect(text((await a.get("threads/late/manifest"))?.bytes)).toBe("b two")
    }))

  test(
    "AC-P4b-4 a create that never lands is unavailable and leaves nothing",
    () =>
      withDrive(async (drive) => {
        const store = storeOn(drive)
        await store.put("threads/other/manifest", bytes("folder"), { ifGeneration: null })
        drive.fail(100, { status: 503, method: "POST", path: /^\/upload\// })
        expect(await rejected(store.put("threads/never/manifest", bytes("x"), { ifGeneration: null }))).toBe(
          "unavailable",
        )
        drive.clearFaults()
        expect(drive.versions("threads/never/manifest")).toEqual([])
        expect(await store.get("threads/never/manifest")).toBeUndefined()
      }),
    30_000,
  )
})

describe("P4b cleanup", () => {
  test(
    "AC-P4b-5 superseded versions are removed and the winner stays",
    () =>
      withDrive(async (drive) => {
        const store = storeOn(drive)
        const generations = [await store.put("threads/c/manifest", bytes("v0"), { ifGeneration: null })]
        for (const index of [1, 2, 3, 4, 5])
          generations.push(
            await store.put("threads/c/manifest", bytes(`v${index}`), { ifGeneration: generations.at(-1)!.generation }),
          )
        expect(drive.versions("threads/c/manifest").map((file) => file.id)).toEqual([generations.at(-1)!.generation])
        expect(text((await store.get("threads/c/manifest"))?.bytes)).toBe("v5")
        drive.fail(10, { status: 500, method: "DELETE" })
        const next = await store.put("threads/c/manifest", bytes("v6"), {
          ifGeneration: generations.at(-1)!.generation,
        })
        drive.clearFaults()
        expect(text((await store.get("threads/c/manifest"))?.bytes)).toBe("v6")
        expect((await store.get("threads/c/manifest"))?.generation).toBe(next.generation)
        await store.put("threads/c/manifest", bytes("v7"), { ifGeneration: next.generation })
        expect(drive.versions("threads/c/manifest")).toHaveLength(1)
      }),
    30_000,
  )
})

describe("P4b files the user can see", () => {
  test("AC-P4b-6 edited content is unreadable; renamed, moved and foreign files change nothing; trashed is ignored", () =>
    withDrive(async (drive) => {
      const store = storeOn(drive)
      await store.put("threads/u/manifest", bytes("genuine"), { ifGeneration: null })
      await store.put("threads/u/segment-1", bytes("segment"), { ifGeneration: null })
      const [manifest] = drive.versions("threads/u/manifest")
      drive.user.rename(manifest.id, "my notes.txt")
      expect(text((await store.get("threads/u/manifest"))?.bytes)).toBe("genuine")
      drive.user.edit(manifest.id, bytes("edited"))
      expect(await rejected(store.get("threads/u/manifest"))).toBe("unreadable")
      drive.user.edit(manifest.id, bytes("genuinE"))
      expect(await rejected(store.get("threads/u/manifest"))).toBe("unreadable")
      drive.user.upload("Tenon sync - threads - u - manifest", drive.folders()[0].id, bytes("planted"), {
        tenonSync: "v1",
        dir: "threads/u",
        base: "manifest",
      })
      expect((await store.list("threads/u/")).map((item) => item.name)).toEqual([
        "threads/u/manifest",
        "threads/u/segment-1",
      ])
      const [segment] = drive.versions("threads/u/segment-1")
      drive.user.trash(segment.id)
      expect(await store.get("threads/u/segment-1")).toBeUndefined()
      expect((await store.list("threads/u/")).map((item) => item.name)).toEqual(["threads/u/manifest"])
    }))
})

describe("P4b errors", () => {
  test(
    "AC-P4b-7 refusals, rate limits and outages map to codes",
    () =>
      withDrive(async (drive) => {
        const wrong = ThreadSync.driveStore({ endpoint: drive.endpoint, token: async () => "wrong" })
        expect(await rejected(wrong.get("threads/a/manifest"))).toBe("unauthorized")
        const broken = ThreadSync.driveStore({
          endpoint: drive.endpoint,
          token: async () => {
            throw new Error("no sign-in")
          },
        })
        expect(await rejected(broken.list("threads/"))).toBe("unauthorized")
        const store = storeOn(drive)
        drive.fail(2, { status: 403, reason: "userRateLimitExceeded" })
        expect((await store.put("threads/a/manifest", bytes("1"))).generation).toBeString()
        drive.fail(1, { status: 403, reason: "rateLimitExceeded" })
        drive.fail(1, { status: 429, reason: "rateLimitExceeded" })
        expect(text((await store.get("threads/a/manifest"))?.bytes)).toBe("1")
        drive.fail(1, { status: 403, reason: "insufficientPermissions" })
        expect(await rejected(store.list("threads/"))).toBe("unauthorized")
        drive.fail(1, { status: 403, reason: "storageQuotaExceeded", method: "POST" })
        expect(await rejected(store.put("threads/b/manifest", bytes("1"), { ifGeneration: null }))).toBe("unavailable")
        drive.clearFaults()
        drive.fail(100, { status: 500 })
        const started = Date.now()
        expect(await rejected(store.get("threads/a/manifest"))).toBe("unavailable")
        expect(Date.now() - started).toBeLessThan(2_500)
        drive.clearFaults()
        drive.malformedNext("list")
        expect(await rejected(store.list("threads/"))).toBe("unavailable")
        drive.malformedNext("media")
        expect(await rejected(store.get("threads/a/manifest"))).toBe("unreadable")
        drive.incompleteSearch(true)
        expect(await rejected(store.list("threads/"))).toBe("unavailable")
        drive.incompleteSearch(false)
        const offline = ThreadSync.driveStore({ endpoint: "http://127.0.0.1:9", token: async () => "t" })
        expect(await rejected(offline.list("threads/"))).toBe("unavailable")
      }),
    30_000,
  )

  test(
    "AC-P4b-7 listings are read across pages and a repeated page token is unavailable",
    () =>
      withDrive(
        async (drive) => {
          const store = storeOn(drive)
          await Promise.all(["c", "a", "e", "b", "d"].map((name) => store.put(`threads/${name}/manifest`, bytes(name))))
          expect((await store.list("threads/")).map((item) => item.name)).toEqual(
            ["a", "b", "c", "d", "e"].map((name) => `threads/${name}/manifest`),
          )
          expect(drive.requests.some((request) => request.search.includes("pageToken"))).toBe(true)
          drive.repeatPageToken(true)
          expect(await rejected(store.list("threads/"))).toBe("unavailable")
        },
        { pageSize: 2 },
      ),
    30_000,
  )
})

describe("P4b engine on Drive", () => {
  it.live("AC-P4b-8 push, pull, takeover and nothing readable in Drive", () =>
    Effect.gen(function* () {
      const tmp = yield* scratch
      const drive = yield* driveScope
      const key = ThreadSync.generateKey().key
      const onDesk = computer(path.join(tmp.path, "desk.sqlite"))
      const onLaptop = computer(path.join(tmp.path, "laptop.sqlite"))

      const sessionID = yield* Effect.gen(function* () {
        const session = yield* SessionV2.Service
        const created = yield* session.create({ location, title: "A private thread title" })
        yield* say(created.id, "a very private sentence")
        const sync = yield* engine({ store: storeOn(drive), key, machine: desk })
        expect(yield* sync.push(created.id)).toEqual({ uploaded: 3, head: 2 })
        expect(yield* sync.push(created.id)).toEqual({ uploaded: 0, head: 2 })
        return created.id
      }).pipe(Effect.provide(onDesk))

      yield* Effect.gen(function* () {
        const sync = yield* engine({ store: storeOn(drive), key, machine: laptop })
        expect((yield* sync.list())[0]).toMatchObject({ sessionID, head: 2, owner: desk })
        expect(yield* sync.pull(sessionID)).toEqual({ applied: 3, head: 2 })
        expect(yield* code(sync.push(sessionID))).toBe("not_owner")
        expect(yield* sync.takeOver(sessionID)).toEqual({ applied: 0, head: 2 })
        yield* say(sessionID, "continued on the laptop")
        expect(yield* sync.push(sessionID)).toEqual({ uploaded: 2, head: 4 })
      }).pipe(Effect.provide(onLaptop))

      yield* Effect.gen(function* () {
        const sync = yield* engine({ store: storeOn(drive), key, machine: desk })
        expect(yield* sync.pull(sessionID)).toEqual({ applied: 2, head: 4 })
        expect(yield* texts(sessionID)).toEqual(["a very private sentence", "continued on the laptop"])
      }).pipe(Effect.provide(onDesk))

      const secrets = [
        "a very private sentence",
        "A private thread title",
        "private-project-folder",
        desk.name,
        desk.id,
      ]
      const seen = [...drive.files.values()].map((file) =>
        Buffer.concat([
          Buffer.from(file.bytes),
          Buffer.from(file.name),
          Buffer.from(JSON.stringify(file.appProperties)),
        ]),
      )
      for (const secret of secrets) expect(seen.filter((value) => value.includes(secret))).toEqual([])
    }),
  )

  it.live("AC-P4b-8 a lost reply to the manifest write keeps the thread complete", () =>
    Effect.gen(function* () {
      const tmp = yield* scratch
      const drive = yield* driveScope
      const key = ThreadSync.generateKey().key
      const store = storeOn(drive)
      const hooked: ThreadSync.Store = {
        get: (name) => store.get(name),
        list: (prefix) => store.list(prefix),
        remove: (name) => store.remove(name),
        put: (name, value, options) => {
          if (name.endsWith("/manifest")) drive.loseCreateReplies(100)
          return store.put(name, value, options).finally(() => drive.loseCreateReplies(0))
        },
      }
      const sessionID = yield* Effect.gen(function* () {
        const session = yield* SessionV2.Service
        const created = yield* session.create({ location })
        yield* say(created.id, "over a lossy link")
        const sync = yield* engine({ store: hooked, key, machine: desk })
        expect(yield* sync.push(created.id)).toEqual({ uploaded: 3, head: 2 })
        expect(yield* sync.push(created.id)).toEqual({ uploaded: 0, head: 2 })
        return created.id
      }).pipe(Effect.provide(computer(path.join(tmp.path, "desk.sqlite"))))
      yield* Effect.gen(function* () {
        const sync = yield* engine({ store: storeOn(drive), key, machine: laptop })
        expect(yield* sync.pull(sessionID)).toEqual({ applied: 3, head: 2 })
      }).pipe(Effect.provide(computer(path.join(tmp.path, "laptop.sqlite"))))
    }),
  )

  it.live("AC-P4b-8 with the folder in the bin a pull is not_found and the next push stores the thread again", () =>
    Effect.gen(function* () {
      const tmp = yield* scratch
      const drive = yield* driveScope
      const key = ThreadSync.generateKey().key
      const onDesk = computer(path.join(tmp.path, "desk.sqlite"))
      const sessionID = yield* Effect.gen(function* () {
        const session = yield* SessionV2.Service
        const created = yield* session.create({ location })
        yield* say(created.id, "binned")
        yield* (yield* engine({ store: storeOn(drive), key, machine: desk })).push(created.id)
        return created.id
      }).pipe(Effect.provide(onDesk))
      drive.user.trash(drive.folders()[0].id)
      yield* Effect.gen(function* () {
        const sync = yield* engine({ store: storeOn(drive), key, machine: laptop })
        expect(yield* code(sync.pull(sessionID))).toBe("not_found")
      }).pipe(Effect.provide(computer(path.join(tmp.path, "laptop.sqlite"))))
      yield* Effect.gen(function* () {
        expect(yield* (yield* engine({ store: storeOn(drive), key, machine: desk })).push(sessionID)).toEqual({
          uploaded: 3,
          head: 2,
        })
      }).pipe(Effect.provide(onDesk))
      yield* Effect.gen(function* () {
        const sync = yield* engine({ store: storeOn(drive), key, machine: laptop })
        expect(yield* sync.pull(sessionID)).toEqual({ applied: 3, head: 2 })
      }).pipe(Effect.provide(computer(path.join(tmp.path, "laptop.sqlite"))))
    }),
  )
})

describe("P4b Cloud Storage removed", () => {
  test("AC-P4b-9 there is no gcsStore", () => {
    expect("gcsStore" in ThreadSync).toBe(false)
    expect(typeof ThreadSync.driveStore).toBe("function")
    expect(ThreadSync.DRIVE_FOLDER).toBe("Tenon Workbench Threads")
  })
})

describe("P4b manager without a bucket", () => {
  it.live("AC-P4b-10 a Drive folder name instead of a bucket, and an old settings file still loads", () =>
    Effect.gen(function* () {
      const tmp = yield* scratch
      const file = path.join(tmp.path, "thread-sync.json")
      yield* Effect.promise(() =>
        fs.writeFile(
          file,
          JSON.stringify({
            enabled: true,
            bucket: "old-bucket",
            machine: { id: "desk-abc123", name: "Desk" },
            folders: {},
          }),
        ),
      )
      const asked: string[] = []
      const key = ThreadSync.generateKey().key
      yield* Effect.gen(function* () {
        const sync = ThreadSync.manager({
          db: (yield* Database.Service).db,
          events: yield* EventV2.Service,
          settingsFile: file,
          hostname: "desk",
          credentials: {
            key: async () => key,
            store: async (driveFolder) => {
              asked.push(driveFolder)
              return ThreadSync.folderStore(path.join(tmp.path, "store"))
            },
          },
          projects: { resolve: async (directory) => ({ id: "prj_desk", worktree: directory }) },
        })
        const status = yield* sync.status()
        expect(status).toMatchObject({
          ready: true,
          enabled: true,
          driveFolder: "Tenon Workbench Threads",
          machine: { id: "desk-abc123", name: "Desk" },
          missing: [],
        })
        expect("bucket" in status).toBe(false)
        for (const bad of ["", "   ", "x".repeat(101), "tab\there"])
          expect(yield* code(sync.configure({ driveFolder: bad }))).toBe("invalid_name")
        expect((yield* sync.status()).driveFolder).toBe("Tenon Workbench Threads")
        const changed = yield* sync.configure({ driveFolder: "  Threads from Tenon  " })
        expect(changed.driveFolder).toBe("Threads from Tenon")
        expect(asked.at(-1)).toBe("Threads from Tenon")
        const saved = JSON.parse(yield* Effect.promise(() => fs.readFile(file, "utf8")))
        expect(saved).toEqual({
          enabled: true,
          driveFolder: "Threads from Tenon",
          machine: { id: "desk-abc123", name: "Desk" },
          folders: {},
        })
        const names = yield* Effect.promise(() => fs.readdir(tmp.path))
        expect(names.filter((name) => name.includes(".broken-"))).toEqual([])
      }).pipe(Effect.provide(computer(path.join(tmp.path, "desk.sqlite"))))
    }),
  )

  it.live("AC-P4b-10 without a key the store is still asked for, and only key is missing", () =>
    Effect.gen(function* () {
      const tmp = yield* scratch
      yield* Effect.gen(function* () {
        const sync = ThreadSync.manager({
          db: (yield* Database.Service).db,
          events: yield* EventV2.Service,
          settingsFile: path.join(tmp.path, "thread-sync.json"),
          hostname: "desk",
          credentials: {
            key: async () => undefined,
            store: async () => ThreadSync.folderStore(path.join(tmp.path, "store")),
          },
          projects: { resolve: async (directory) => ({ id: "prj_desk", worktree: directory }) },
        })
        expect(yield* sync.status()).toMatchObject({ ready: false, enabled: false, missing: ["key"] })
        expect((yield* sync.configure({ enabled: true })).missing).toEqual(["key"])
      }).pipe(Effect.provide(computer(path.join(tmp.path, "desk.sqlite"))))
    }),
  )
})
