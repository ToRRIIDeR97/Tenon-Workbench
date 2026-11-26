import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { RemoteAccess } from "../../../../tenon/packages/core/src/remote-access"

const scratch = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tenon-remote-access-"))
  return {
    file: path.join(directory, "devices.json"),
    [Symbol.asyncDispose]: () => fs.rm(directory, { recursive: true, force: true }),
  }
}

const clock = (start = 1_800_000_000_000) => {
  const state = { now: start }
  return { now: () => state.now, advance: (ms: number) => void (state.now += ms) }
}

const refused = (promise: Promise<unknown>) =>
  promise.then(
    () => "paired",
    (error: { code?: string }) => error.code,
  )

describe("P6a pairing codes", () => {
  test("AC-P6a-1 a code is eight unambiguous characters, good for five minutes", async () => {
    await using tmp = await scratch()
    const time = clock()
    const registry = RemoteAccess.registry({ file: tmp.file, now: time.now })
    const made = registry.pairingCode()
    expect(made.code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/)
    expect(made.expiresAt).toBe(time.now() + 5 * 60_000)
    expect(registry.pairingCode().code).not.toBe(made.code)
  })

  test("AC-P6a-1 a code pairs once, however it was typed", async () => {
    await using tmp = await scratch()
    const registry = RemoteAccess.registry({ file: tmp.file })
    const code = registry.pairingCode().code
    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()} `
    const device = await registry.pair({ code: typed, name: "  Pixel 9  " })
    expect(device.name).toBe("Pixel 9")
    expect(device.id.length).toBeGreaterThan(5)
    expect(await refused(registry.pair({ code, name: "Second phone" }))).toBe("bad_code")
  })

  test("AC-P6a-1 a new code cancels the old one, and an old code expires", async () => {
    await using tmp = await scratch()
    const time = clock()
    const registry = RemoteAccess.registry({ file: tmp.file, now: time.now })
    const first = registry.pairingCode().code
    const second = registry.pairingCode().code
    expect(await refused(registry.pair({ code: first, name: "Phone" }))).toBe("bad_code")
    time.advance(5 * 60_000 + 1)
    expect(await refused(registry.pair({ code: second, name: "Phone" }))).toBe("expired")
  })

  test("AC-P6a-1 five wrong attempts lock the code", async () => {
    await using tmp = await scratch()
    const registry = RemoteAccess.registry({ file: tmp.file })
    const code = registry.pairingCode().code
    const wrong = code.startsWith("2") ? `3${code.slice(1)}` : `2${code.slice(1)}`
    const attempts = [1, 2, 3, 4, 5].map(() => () => refused(registry.pair({ code: wrong, name: "Phone" })))
    const results = []
    for (const attempt of attempts) results.push(await attempt())
    expect(results.slice(0, 4)).toEqual(["bad_code", "bad_code", "bad_code", "bad_code"])
    expect(await refused(registry.pair({ code, name: "Phone" }))).toBe("locked")
    const fresh = registry.pairingCode().code
    expect(await refused(registry.pair({ code: fresh, name: "Phone" }))).toBe("paired")
  })
})

describe("P6a devices", () => {
  test("AC-P6a-2 a paired device authenticates with its token, which is never stored", async () => {
    await using tmp = await scratch()
    const registry = RemoteAccess.registry({ file: tmp.file })
    const device = await registry.pair({ code: registry.pairingCode().code, name: "Pixel 9" })
    expect(device.token.length).toBeGreaterThanOrEqual(43)
    expect(await registry.authenticate(device.token)).toEqual({ id: device.id, name: "Pixel 9" })
    expect(await registry.authenticate(`${device.token}x`)).toBeUndefined()
    expect(await registry.authenticate("")).toBeUndefined()
    const stored = await fs.readFile(tmp.file, "utf8")
    expect(stored.includes(device.token)).toBe(false)
    expect(stored.includes("Pixel 9")).toBe(true)
  })

  test("AC-P6a-2 devices survive a restart and can be revoked", async () => {
    await using tmp = await scratch()
    const first = RemoteAccess.registry({ file: tmp.file })
    const phone = await first.pair({ code: first.pairingCode().code, name: "Phone" })
    const tablet = await first.pair({ code: first.pairingCode().code, name: "Tablet" })
    const second = RemoteAccess.registry({ file: tmp.file })
    expect((await second.devices()).map((device) => device.name).sort()).toEqual(["Phone", "Tablet"])
    expect(await second.authenticate(tablet.token)).toEqual({ id: tablet.id, name: "Tablet" })
    expect(await second.revoke(phone.id)).toBe(true)
    expect(await second.revoke(phone.id)).toBe(false)
    expect(await second.authenticate(phone.token)).toBeUndefined()
    expect((await RemoteAccess.registry({ file: tmp.file }).devices()).map((device) => device.name)).toEqual(["Tablet"])
  })

  test("AC-P6a-2 a device name must be 1 to 64 characters", async () => {
    await using tmp = await scratch()
    const registry = RemoteAccess.registry({ file: tmp.file })
    expect(await refused(registry.pair({ code: registry.pairingCode().code, name: "   " }))).toBe("invalid_name")
    expect(await refused(registry.pair({ code: registry.pairingCode().code, name: "x".repeat(65) }))).toBe(
      "invalid_name",
    )
  })
})

describe("P6a companion scope", () => {
  const allowed = [
    ["GET", "/api/session"],
    ["GET", "/api/session/ses_1"],
    ["GET", "/api/session/ses_1/history"],
    ["POST", "/api/session"],
    ["POST", "/api/session/ses_1/prompt"],
    ["POST", "/api/session/ses_1/interrupt"],
    ["POST", "/api/session/ses_1/permission/req_1/reply"],
    ["POST", "/api/session/ses_1/question/req_1/reply"],
    ["GET", "/api/event"],
    ["GET", "/second-brain/vault/pages"],
    ["PUT", "/second-brain/vault/page"],
    ["GET", "/second-brain/calendar"],
    ["GET", "/second-brain/project-threads"],
  ] as const

  const denied = [
    ["GET", "/api/pty"],
    ["POST", "/api/pty"],
    ["GET", "/api/pty/pty_1/connect"],
    ["PUT", "/file/content"],
    ["PATCH", "/global/config"],
    ["POST", "/global/dispose"],
    ["PATCH", "/api/credential/cred_1"],
    ["POST", "/mcp/github/auth"],
    ["POST", "/api/harness/setup/codex/install"],
    ["POST", "/api/computer-use"],
    ["PUT", "/second-brain/instructions"],
    ["POST", "/second-brain/projects/link"],
    ["PUT", "/api/thread-sync"],
    ["GET", "/a/route/nobody/listed"],
  ] as const

  test("AC-P6a-3 a phone can read and drive threads, notes and the calendar", () => {
    expect(allowed.filter(([method, route]) => !RemoteAccess.allows({ method, path: route }))).toEqual([])
  })

  test("AC-P6a-3 a phone cannot reach terminals, files, settings or credentials", () => {
    expect(denied.filter(([method, route]) => RemoteAccess.allows({ method, path: route }))).toEqual([])
  })

  test("AC-P6a-3 the method matters, the query string and a trailing slash do not", () => {
    expect(RemoteAccess.allows({ method: "get", path: "/api/session/?limit=5" })).toBe(true)
    expect(RemoteAccess.allows({ method: "DELETE", path: "/api/pty/pty_1" })).toBe(false)
    expect(RemoteAccess.allows({ method: "GET", path: "/api/session/../pty" })).toBe(false)
  })
})
