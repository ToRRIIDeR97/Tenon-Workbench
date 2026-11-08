import { describe, expect, test } from "bun:test"
import { LayerNode } from "@tenon/core/effect/layer-node"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { Global } from "@tenon/core/global"
import { Auth } from "../../src/auth"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Auth.node))

describe("Auth", () => {
  it.instance("set normalizes trailing slashes in keys", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com/", {
        type: "wellknown",
        key: "TOKEN",
        token: "abc",
      })
      const data = yield* auth.all()
      expect(data["https://example.com"]).toBeDefined()
      expect(data["https://example.com/"]).toBeUndefined()
    }),
  )

  it.instance("set cleans up pre-existing trailing-slash entry", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com/", {
        type: "wellknown",
        key: "TOKEN",
        token: "old",
      })
      yield* auth.set("https://example.com", {
        type: "wellknown",
        key: "TOKEN",
        token: "new",
      })
      const data = yield* auth.all()
      const keys = Object.keys(data).filter((key) => key.includes("example.com"))
      expect(keys).toEqual(["https://example.com"])
      const entry = data["https://example.com"]!
      expect(entry.type).toBe("wellknown")
      if (entry.type === "wellknown") expect(entry.token).toBe("new")
    }),
  )

  it.instance("remove deletes both trailing-slash and normalized keys", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("https://example.com", {
        type: "wellknown",
        key: "TOKEN",
        token: "abc",
      })
      yield* auth.remove("https://example.com/")
      const data = yield* auth.all()
      expect(data["https://example.com"]).toBeUndefined()
      expect(data["https://example.com/"]).toBeUndefined()
    }),
  )

  it.instance("set and remove are no-ops on keys without trailing slashes", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("anthropic", {
        type: "api",
        key: "sk-test",
      })
      const data = yield* auth.all()
      expect(data["anthropic"]).toBeDefined()
      yield* auth.remove("anthropic")
      const after = yield* auth.all()
      expect(after["anthropic"]).toBeUndefined()
    }),
  )

  it.instance("set refuses to replace an auth file that fails to parse", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const file = path.join(Global.Path.data, "auth.json")
      const previous = yield* Effect.promise(() => fs.readFile(file, "utf8").catch(() => undefined))
      yield* Effect.promise(() => fs.writeFile(file, '{"anthropic": {"type": "api", "key": "sk-'))
      const exit = yield* auth.set("openai", { type: "api", key: "sk-new" }).pipe(Effect.exit)
      const after = yield* Effect.promise(() => fs.readFile(file, "utf8"))
      if (previous === undefined) yield* Effect.promise(() => fs.rm(file, { force: true }))
      else yield* Effect.promise(() => fs.writeFile(file, previous))
      expect(exit._tag).toBe("Failure")
      expect(after).toBe('{"anthropic": {"type": "api", "key": "sk-')
    }),
  )

  it.instance("concurrent sets keep every key", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const keys = Array.from({ length: 8 }, (_, index) => `concurrent-${index}`)
      yield* Effect.forEach(keys, (key) => auth.set(key, { type: "api", key: `sk-${key}` }), {
        concurrency: "unbounded",
      })
      const data = yield* auth.all()
      expect(keys.filter((key) => data[key] === undefined)).toEqual([])
      yield* Effect.forEach(keys, (key) => auth.remove(key), { concurrency: "unbounded" })
      const after = yield* auth.all()
      expect(keys.filter((key) => after[key] !== undefined)).toEqual([])
    }),
  )

  // Windows has no POSIX mode bits; auth.json inherits the user profile's ACL there.
  it.instance("set writes an owner-only file and leaves no temp file", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      yield* auth.set("mode-check", { type: "api", key: "sk-mode" })
      const stat = yield* Effect.promise(() => fs.stat(path.join(Global.Path.data, "auth.json")))
      const entries = yield* Effect.promise(() => fs.readdir(Global.Path.data))
      yield* auth.remove("mode-check")
      if (process.platform !== "win32") expect(stat.mode & 0o777).toBe(0o600)
      expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([])
    }),
  )

  test("a rename over a locked file is retried for EBUSY, EACCES and EPERM only", () => {
    const errno = (code: string) => Object.assign(new Error(code), { code })
    expect(Auth.isLockedTarget({ _tag: "Busy", cause: errno("EBUSY") })).toBe(true)
    expect(Auth.isLockedTarget({ _tag: "PermissionDenied", cause: errno("EACCES") })).toBe(true)
    // Effect leaves EPERM, which Windows returns for a file another process holds open, as Unknown.
    expect(Auth.isLockedTarget({ _tag: "Unknown", cause: errno("EPERM") })).toBe(true)
    expect(Auth.isLockedTarget({ _tag: "Unknown", cause: errno("EXDEV") })).toBe(false)
    expect(Auth.isLockedTarget({ _tag: "NotFound", cause: errno("ENOENT") })).toBe(false)
  })
})
