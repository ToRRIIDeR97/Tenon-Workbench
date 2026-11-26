import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { RemoteAccess } from "../../src/remote-access"

const scratch = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tenon-remote-registry-"))
  return {
    directory,
    file: path.join(directory, "devices.json"),
    [Symbol.asyncDispose]: () => fs.rm(directory, { recursive: true, force: true }),
  }
}

const clock = (start = 1_800_000_000_000) => {
  const state = { now: start }
  return { now: () => state.now, advance: (ms: number) => void (state.now += ms) }
}

const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => "paired",
    (error: { code?: string }) => error.code,
  )

describe("pairing codes", () => {
  test("codes use only the alphabet and differ every time", async () => {
    await using tmp = await scratch()
    const registry = RemoteAccess.registry({ file: tmp.file })
    const codes = Array.from({ length: 200 }, () => registry.pairingCode().code)
    expect(new Set(codes).size).toBe(200)
    expect(codes.every((code) => /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(code))).toBe(true)
    expect(new Set(codes.join("")).size).toBeGreaterThan(25)
  })

  test("a code is good up to its last millisecond and expired after", async () => {
    await using tmp = await scratch()
    const time = clock()
    const registry = RemoteAccess.registry({ file: tmp.file, now: time.now })
    const early = registry.pairingCode()
    time.advance(5 * 60_000)
    expect(time.now()).toBe(early.expiresAt)
    expect(await outcome(registry.pair({ code: early.code, name: "Phone" }))).toBe("paired")
    const late = registry.pairingCode().code
    time.advance(5 * 60_000 + 1)
    expect(await outcome(registry.pair({ code: late, name: "Phone" }))).toBe("expired")
    expect(await outcome(registry.pair({ code: late, name: "Phone" }))).toBe("expired")
  })

  test("no code is bad_code, and codes are never written to disk", async () => {
    await using tmp = await scratch()
    const registry = RemoteAccess.registry({ file: tmp.file })
    expect(await outcome(registry.pair({ code: "ABCDEFGH", name: "Phone" }))).toBe("bad_code")
    const code = registry.pairingCode().code
    await registry.pair({ code, name: "Phone" })
    const next = registry.pairingCode().code
    const written = (await fs.readdir(tmp.directory)).map((name) => path.join(tmp.directory, name))
    const contents = await Promise.all(written.map((file) => fs.readFile(file, "utf8")))
    expect(contents.some((text) => text.includes(code) || text.includes(next))).toBe(false)
  })

  test("the fifth wrong code locks until a new code is made", async () => {
    await using tmp = await scratch()
    const registry = RemoteAccess.registry({ file: tmp.file })
    const code = registry.pairingCode().code
    const wrong = code.startsWith("2") ? `3${code.slice(1)}` : `2${code.slice(1)}`
    const results = await [1, 2, 3, 4, 5].reduce<Promise<Array<string | undefined>>>(
      async (all) => [...(await all), await outcome(registry.pair({ code: wrong, name: "Phone" }))],
      Promise.resolve([]),
    )
    expect(results).toEqual(["bad_code", "bad_code", "bad_code", "bad_code", "bad_code"])
    expect(await outcome(registry.pair({ code, name: "Phone" }))).toBe("locked")
    expect(await outcome(registry.pair({ code: wrong, name: "Phone" }))).toBe("locked")
    const fresh = registry.pairingCode().code
    expect(await outcome(registry.pair({ code: fresh, name: "Phone" }))).toBe("paired")
  })

  test("four wrong codes then the right one still pairs", async () => {
    await using tmp = await scratch()
    const registry = RemoteAccess.registry({ file: tmp.file })
    const code = registry.pairingCode().code
    const wrong = code.startsWith("2") ? `3${code.slice(1)}` : `2${code.slice(1)}`
    await Promise.all([1, 2, 3, 4].map(() => outcome(registry.pair({ code: wrong, name: "Phone" }))))
    expect(await outcome(registry.pair({ code: ` ${code.toLowerCase()} `, name: "Phone" }))).toBe("paired")
  })

  test("two pairs racing with one code give one device", async () => {
    await using tmp = await scratch()
    const registry = RemoteAccess.registry({ file: tmp.file })
    const code = registry.pairingCode().code
    const results = await Promise.all([
      outcome(registry.pair({ code, name: "A" })),
      outcome(registry.pair({ code, name: "B" })),
    ])
    expect(results).toContain("paired")
    expect(results).toContain("bad_code")
    expect(await registry.devices()).toHaveLength(1)
  })

  test("a bad name keeps the code for another try", async () => {
    await using tmp = await scratch()
    const registry = RemoteAccess.registry({ file: tmp.file })
    const code = registry.pairingCode().code
    expect(await outcome(registry.pair({ code, name: "" }))).toBe("invalid_name")
    expect(await outcome(registry.pair({ code, name: "x".repeat(64) }))).toBe("paired")
  })
})

describe("device file", () => {
  test("holds the token's SHA-256 and never the token", async () => {
    await using tmp = await scratch()
    const registry = RemoteAccess.registry({ file: tmp.file })
    const device = await registry.pair({ code: registry.pairingCode().code, name: "Pixel" })
    const stored = await fs.readFile(tmp.file, "utf8")
    expect(stored).toContain(createHash("sha256").update(device.token).digest("hex"))
    expect(stored).not.toContain(device.token)
    expect(Buffer.from(device.token, "base64url")).toHaveLength(32)
    expect((await fs.readdir(tmp.directory)).filter((name) => name.endsWith(".tmp"))).toEqual([])
  })

  test("is private to the user", async () => {
    await using tmp = await scratch()
    const registry = RemoteAccess.registry({ file: tmp.file })
    await registry.pair({ code: registry.pairingCode().code, name: "Pixel" })
    if (process.platform !== "win32") return expect((await fs.stat(tmp.file)).mode & 0o777).toBe(0o600)
    const acl = execFileSync("icacls", [tmp.file], { encoding: "utf8" })
    const grants = acl
      .split(/\r?\n/)
      .map((line) => line.replace(tmp.file, "").trim())
      .filter((line) => line.includes(":("))
    expect(grants).toEqual([`${process.env.USERDOMAIN}\\${os.userInfo().username}:(F)`])
  })

  test("a broken file is set aside and treated as empty", async () => {
    await using tmp = await scratch()
    await fs.writeFile(tmp.file, "{not json")
    const registry = RemoteAccess.registry({ file: tmp.file })
    expect(await registry.devices()).toEqual([])
    const names = await fs.readdir(tmp.directory)
    const aside = names.filter((name) => name.startsWith("devices.json.broken-"))
    expect(aside).toHaveLength(1)
    expect(await fs.readFile(path.join(tmp.directory, aside[0]), "utf8")).toBe("{not json")
    await registry.pair({ code: registry.pairingCode().code, name: "Phone" })
    expect((await registry.devices()).map((device) => device.name)).toEqual(["Phone"])
  })

  test("a file with the wrong shape is set aside too", async () => {
    await using tmp = await scratch()
    await fs.writeFile(tmp.file, JSON.stringify({ version: 1, devices: [{ id: 1 }] }))
    expect(await RemoteAccess.registry({ file: tmp.file }).devices()).toEqual([])
    expect((await fs.readdir(tmp.directory)).some((name) => name.startsWith("devices.json.broken-"))).toBe(true)
  })

  test("last seen is written at most once a minute", async () => {
    await using tmp = await scratch()
    const time = clock()
    const registry = RemoteAccess.registry({ file: tmp.file, now: time.now })
    const device = await registry.pair({ code: registry.pairingCode().code, name: "Phone" })
    expect((await registry.devices())[0]?.lastSeenAt).toBeNull()
    const first = time.now()
    await registry.authenticate(device.token)
    expect((await registry.devices())[0]?.lastSeenAt).toBe(first)
    const written = await fs.readFile(tmp.file, "utf8")
    time.advance(59_999)
    await registry.authenticate(device.token)
    expect(await fs.readFile(tmp.file, "utf8")).toBe(written)
    time.advance(1)
    await registry.authenticate(device.token)
    expect((await registry.devices())[0]?.lastSeenAt).toBe(first + 60_000)
  })

  test("odd tokens never authenticate", async () => {
    await using tmp = await scratch()
    const registry = RemoteAccess.registry({ file: tmp.file })
    const device = await registry.pair({ code: registry.pairingCode().code, name: "Phone" })
    const stored = JSON.parse(await fs.readFile(tmp.file, "utf8")).devices[0].tokenHash
    const notStrings: Array<string> = JSON.parse("[null, 42, {}, [], true]")
    const odd = [
      "",
      " ",
      device.token.slice(0, -1),
      ` ${device.token}`,
      device.token.toUpperCase(),
      stored,
      "x".repeat(100_000),
      "\u0000",
      "\ud800",
      ...notStrings,
    ]
    const results = await Promise.all(odd.map((token) => registry.authenticate(token)))
    expect(results.every((result) => result === undefined)).toBe(true)
    expect(await registry.authenticate(device.token)).toEqual({ id: device.id, name: "Phone" })
  })

  test("revoking an unknown device changes nothing", async () => {
    await using tmp = await scratch()
    const registry = RemoteAccess.registry({ file: tmp.file })
    await registry.pair({ code: registry.pairingCode().code, name: "Phone" })
    const before = await fs.readFile(tmp.file, "utf8")
    expect(await registry.revoke("dev_missing")).toBe(false)
    expect(await fs.readFile(tmp.file, "utf8")).toBe(before)
  })
})

describe("stream tickets and the pairing limit", () => {
  test("a ticket opens once, for its device, within a minute", () => {
    const time = clock()
    const tickets = RemoteAccess.streamTickets({ now: time.now })
    const first = tickets.issue("dev_a")
    expect(first.expiresAt).toBe(time.now() + 60_000)
    expect(tickets.redeem(first.ticket)).toBe("dev_a")
    expect(tickets.redeem(first.ticket)).toBeUndefined()
    const second = tickets.issue("dev_a")
    time.advance(60_001)
    expect(tickets.redeem(second.ticket)).toBeUndefined()
    expect(tickets.redeem("")).toBeUndefined()
  })

  test("ten attempts a minute per address", () => {
    const time = clock()
    const limit = RemoteAccess.limiter({ limit: 10, window: 60_000, now: time.now })
    const taken = Array.from({ length: 11 }, () => limit.take("10.0.0.2"))
    expect(taken.filter(Boolean)).toHaveLength(10)
    expect(taken[10]).toBe(false)
    expect(limit.take("10.0.0.3")).toBe(true)
    time.advance(60_000)
    expect(limit.take("10.0.0.2")).toBe(true)
  })
})
