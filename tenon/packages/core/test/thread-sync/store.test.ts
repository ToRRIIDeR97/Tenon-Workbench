import { describe, expect, test } from "bun:test"
import path from "node:path"
import type { EventV2 } from "../../src/event"
import { ThreadSync } from "../../src/thread-sync"
import { limitedGcsStore } from "../../src/thread-sync/gcs"
import { canHold } from "../../src/thread-sync/local-path"
import { tmpdir } from "../fixture/tmpdir"
import { fakeGcs } from "./gcs-fake"

const rejected = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: { code?: string }) => error.code,
  )

const event = (seq: number, aggregateID = "ses_chain") =>
  ({
    id: `evt_${aggregateID}_${seq}`,
    aggregateID,
    seq,
    type: "test.message.1",
    data: { seq },
  }) as unknown as EventV2.SerializedEvent

const scripted = (respond: () => Response) => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: respond })
  return { endpoint: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}

const unsafe = ["", "/a", "a/", "a//b", "../a", "a/./b", "a\\b", "a b", "a/ü", "C:/a"]

describe("thread sync keys and segments", () => {
  test("a changed phrase or a key of the wrong length is refused", async () => {
    const made = ThreadSync.generateKey()
    const changed = `${made.phrase.slice(0, -1)}${made.phrase.endsWith("0") ? "1" : "0"}`
    expect(() => ThreadSync.keyFromPhrase(changed)).toThrow()
    expect([...ThreadSync.keyFromPhrase(made.phrase.toUpperCase())]).toEqual([...made.key])
    const short = new Uint8Array(16)
    expect(
      await rejected(ThreadSync.seal({ key: short, sessionID: "ses_chain", previous: null, events: [event(0)] })),
    ).toBe("invalid_key")
    expect(
      await rejected(
        ThreadSync.open({ key: short, sessionID: "ses_chain", previous: null, bytes: new Uint8Array(64) }),
      ),
    ).toBe("invalid_key")
  })

  test("segments open only in their chain and thread", async () => {
    const key = ThreadSync.generateKey().key
    const one = await ThreadSync.seal({ key, sessionID: "ses_chain", previous: null, events: [event(0), event(1)] })
    const two = await ThreadSync.seal({ key, sessionID: "ses_chain", previous: one.hash, events: [event(2)] })
    expect((await ThreadSync.open({ key, sessionID: "ses_chain", previous: one.hash, bytes: two.bytes })).first).toBe(2)
    expect(await rejected(ThreadSync.open({ key, sessionID: "ses_chain", previous: null, bytes: two.bytes }))).toBe(
      "unreadable",
    )
    expect(await rejected(ThreadSync.open({ key, sessionID: "ses_other", previous: null, bytes: one.bytes }))).toBe(
      "unreadable",
    )
    expect(
      await rejected(ThreadSync.open({ key, sessionID: "ses_chain", previous: null, bytes: one.bytes.slice(0, 20) })),
    ).toBe("unreadable")
    expect(
      await rejected(ThreadSync.open({ key, sessionID: "ses_chain", previous: null, bytes: new Uint8Array() })),
    ).toBe("unreadable")
  })

  test("empty, gapped and mixed runs are not segments", async () => {
    const key = ThreadSync.generateKey().key
    const seal = (events: EventV2.SerializedEvent[]) =>
      rejected(ThreadSync.seal({ key, sessionID: "ses_chain", previous: null, events }))
    expect(await seal([])).toBe("invalid_segment")
    expect(await seal([event(0), event(2)])).toBe("invalid_segment")
    expect(await seal([event(0), event(1, "ses_other")])).toBe("invalid_segment")
    expect(await seal([event(0, "ses_other")])).toBe("invalid_segment")
  })
})

describe("thread sync local paths", () => {
  test("a Windows drive path is foreign on macOS, a macOS path is not on Windows", () => {
    expect(canHold("C:\\Users\\desk\\project", "darwin")).toBe(false)
    expect(canHold("C:/Users/desk/project", "linux")).toBe(false)
    expect(canHold("\\\\server\\share\\project", "darwin")).toBe(false)
    expect(canHold("/Users/desk/project", "darwin")).toBe(true)
    expect(canHold("C:\\Users\\desk\\project", "win32")).toBe(true)
    expect(canHold("\\\\server\\share\\project", "win32")).toBe(true)
    expect(canHold("/Users/desk/project", "win32")).toBe(true)
    expect(canHold("relative/project", "win32")).toBe(false)
    expect(canHold("C:relative", "win32")).toBe(false)
    expect(canHold("", "darwin")).toBe(true)
  })
})

describe("thread sync folder store", () => {
  test("unsafe names are refused on every method", async () => {
    await using tmp = await tmpdir()
    const store = ThreadSync.folderStore(path.join(tmp.path, "bucket"))
    for (const name of unsafe) {
      expect(await rejected(store.get(name))).toBe("invalid_name")
      expect(await rejected(store.put(name, new Uint8Array([1])))).toBe("invalid_name")
      expect(await rejected(store.remove(name))).toBe("invalid_name")
    }
    for (const prefix of ["", "/", "../", "a//", "a\\"]) expect(await rejected(store.list(prefix))).toBe("invalid_name")
    expect(await store.list("threads/")).toEqual([])
  })

  test("two stores on one directory share objects and conditions", async () => {
    await using tmp = await tmpdir()
    const one = ThreadSync.folderStore(path.join(tmp.path, "bucket"))
    const two = ThreadSync.folderStore(path.join(tmp.path, "bucket"))
    const written = await one.put("threads/a/manifest", new Uint8Array([1]), { ifGeneration: null })
    expect((await two.get("threads/a/manifest"))?.generation).toBe(written.generation)
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 ? one : two)
          .put("threads/a/manifest", new Uint8Array([index]), {
            ifGeneration: written.generation,
          })
          .then(
            () => "ok",
            (error: { code?: string }) => error.code,
          ),
      ),
    )
    expect(results.filter((result) => result === "ok")).toHaveLength(1)
    expect(results.filter((result) => result === "conflict")).toHaveLength(7)
    await two.remove("threads/a/manifest")
    expect(await one.get("threads/a/manifest")).toBeUndefined()
  })
})

describe("thread sync Cloud Storage store", () => {
  test("follows pages, applies a prefix and percent-encodes names", async () => {
    const gcs = fakeGcs({ pageSize: 2 })
    try {
      const store = ThreadSync.gcsStore({
        bucket: "my-bucket",
        endpoint: gcs.endpoint,
        prefix: "tenon/",
        token: async () => gcs.token,
      })
      await Promise.all(
        ["c", "a", "e", "b", "d"].map((name) => store.put(`threads/${name}/manifest`, new Uint8Array([1]))),
      )
      expect((await store.list("threads/")).map((item) => item.name)).toEqual(
        ["a", "b", "c", "d", "e"].map((name) => `threads/${name}/manifest`),
      )
      expect([...gcs.objects.keys()].every((name) => name.startsWith("my-bucket/tenon/threads/"))).toBe(true)
      expect(gcs.requests.filter((request) => request.search.includes("pageToken")).length).toBeGreaterThan(0)
      expect(gcs.requests.some((request) => request.path.includes("%2F"))).toBe(false)
      await store.get("threads/a/manifest")
      expect(gcs.requests.at(-1)?.path).toBe("/storage/v1/b/my-bucket/o/tenon%2Fthreads%2Fa%2Fmanifest")
    } finally {
      await gcs.stop()
    }
  })

  test("a success reply that cannot be read is unavailable", async () => {
    const server = scripted(() => new Response("not json", { status: 200 }))
    try {
      const store = ThreadSync.gcsStore({ bucket: "b", endpoint: server.endpoint, token: async () => "t" })
      expect(await rejected(store.list("threads/"))).toBe("unavailable")
      expect(await rejected(store.put("threads/a/manifest", new Uint8Array([1])))).toBe("unavailable")
      expect(await rejected(store.get("threads/a/manifest"))).toBe("unavailable")
    } finally {
      await server.stop()
    }
  })

  test("a listing that repeats a page token or never ends is unavailable", async () => {
    const repeating = scripted(() => Response.json({ items: [], nextPageToken: "again" }))
    const counter = { pages: 0 }
    const endless = scripted(() => {
      counter.pages += 1
      return Response.json({ items: [], nextPageToken: `page-${counter.pages}` })
    })
    try {
      const store = (endpoint: string) => ThreadSync.gcsStore({ bucket: "b", endpoint, token: async () => "t" })
      expect(await rejected(store(repeating.endpoint).list("threads/"))).toBe("unavailable")
      expect(await rejected(store(endless.endpoint).list("threads/"))).toBe("unavailable")
      expect(counter.pages).toBe(1_000)
    } finally {
      await repeating.stop()
      await endless.stop()
    }
  }, 30_000)

  test("the time token() takes counts inside the request limit and the retry budget", async () => {
    const gcs = fakeGcs()
    try {
      const hung = limitedGcsStore(
        { bucket: "b", endpoint: gcs.endpoint, token: () => new Promise<string>(() => {}) },
        { requestTimeoutMs: 150 },
      )
      const first = Date.now()
      expect(await rejected(hung.get("threads/a/manifest"))).toBe("unavailable")
      expect(Date.now() - first).toBeLessThan(1_000)
      const slow = ThreadSync.gcsStore({
        bucket: "b",
        endpoint: gcs.endpoint,
        token: () => new Promise<string>((resolve) => setTimeout(() => resolve(gcs.token), 300)),
      })
      gcs.failNext(100)
      const second = Date.now()
      expect(await rejected(slow.get("threads/a/manifest"))).toBe("unavailable")
      expect(Date.now() - second).toBeLessThan(2_800)
    } finally {
      await gcs.stop()
    }
  })

  test("a request that never answers ends as unavailable", async () => {
    const silent = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Promise<Response>(() => {}) })
    try {
      const store = limitedGcsStore(
        { bucket: "b", endpoint: `http://127.0.0.1:${silent.port}`, token: async () => "t" },
        { requestTimeoutMs: 150 },
      )
      const started = Date.now()
      expect(await rejected(store.get("threads/a/manifest"))).toBe("unavailable")
      expect(Date.now() - started).toBeLessThan(3_000)
    } finally {
      await silent.stop(true)
    }
  })

  test("maps refusals and outages to error codes", async () => {
    const gcs = fakeGcs()
    try {
      const wrong = ThreadSync.gcsStore({ bucket: "b", endpoint: gcs.endpoint, token: async () => "wrong" })
      expect(await rejected(wrong.get("threads/a/manifest"))).toBe("unauthorized")
      const store = ThreadSync.gcsStore({ bucket: "b", endpoint: gcs.endpoint, token: async () => gcs.token })
      gcs.failNext(2)
      expect((await store.put("threads/a/manifest", new Uint8Array([1]))).generation).toBeString()
      gcs.failNext(100)
      const started = Date.now()
      expect(await rejected(store.get("threads/a/manifest"))).toBe("unavailable")
      expect(Date.now() - started).toBeLessThan(2_500)
      gcs.failNext(0)
      expect(await rejected(store.put("threads/../x", new Uint8Array([1])))).toBe("invalid_name")
      const offline = ThreadSync.gcsStore({ bucket: "b", endpoint: "http://127.0.0.1:9", token: async () => "t" })
      expect(await rejected(offline.list("threads/"))).toBe("unavailable")
      await store.remove("threads/missing")
    } finally {
      await gcs.stop()
    }
  }, 30_000)
})
