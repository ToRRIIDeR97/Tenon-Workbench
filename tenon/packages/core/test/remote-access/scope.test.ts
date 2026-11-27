import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { RemoteAccess } from "../../src/remote-access"

const concrete = (route: string) => route.replace(/:\w+/g, "id_1").replace("*", "notes/a.md")

describe("companion scope", () => {
  test("every allowed route is allowed and every denied route is denied", () => {
    const wrong = [
      ...RemoteAccess.allowed.filter(([method, route]) => !RemoteAccess.allows({ method, path: concrete(route) })),
      ...RemoteAccess.denied.filter(([method, route]) => RemoteAccess.allows({ method, path: concrete(route) })),
    ]
    expect(wrong).toEqual([])
  })

  test("no route is listed twice", () => {
    const keys = [...RemoteAccess.allowed, ...RemoteAccess.denied].map(([method, route]) => `${method} ${route}`)
    expect(keys.length).toBe(new Set(keys).size)
  })

  test("a literal route wins over a parameter in the same place", () => {
    expect(RemoteAccess.allows({ method: "GET", path: "/api/session/active" })).toBe(true)
    expect(RemoteAccess.allows({ method: "GET", path: "/api/permission/saved" })).toBe(false)
    expect(RemoteAccess.allows({ method: "GET", path: "/pty/shells" })).toBe(false)
    expect(RemoteAccess.allows({ method: "GET", path: "/session/status" })).toBe(true)
  })

  test("path tricks are denied", () => {
    const tricks = [
      "/API/session",
      "/Api/Session",
      "/api/Session/ses_1",
      "//api/session",
      "/api//session",
      "/api/session//",
      "/api/session/%2e%2e/pty",
      "/api/session/%2E%2E/pty",
      "/api/session/ses_1/..",
      "/api/session/./",
      "/api/session/..%2fpty",
      "/api/session/ses%5f1",
      "/api\\session",
      "\\api\\session",
      "/api/session\\ses_1",
      "api/session",
      "",
      "?",
      "http://localhost/api/session",
      "https://127.0.0.1:4096/api/health",
      "/api/session#x",
      "/api/session/ses_1/history/",
      "/api/session/ses 1",
      "/second-brain/vault/pages/../../pty",
      "/event/../pty",
    ]
    const allowed = tricks.filter((trick) => RemoteAccess.allows({ method: "GET", path: trick }))
    expect(allowed).toEqual(["/api/session/ses_1/history/"])
  })

  test("methods outside the table are denied", () => {
    const methods = ["HEAD", "OPTIONS", "TRACE", "CONNECT", "PATCH", "DELETE", "GETX", ""]
    expect(methods.filter((method) => RemoteAccess.allows({ method, path: "/api/session" }))).toEqual([])
  })

  test("only the event streams take a stream ticket", () => {
    expect(RemoteAccess.opensStream({ method: "GET", path: "/api/event?ticket=x" })).toBe(true)
    expect(RemoteAccess.opensStream({ method: "GET", path: "/api/session/ses_1/event" })).toBe(true)
    expect(RemoteAccess.opensStream({ method: "GET", path: "/global/event" })).toBe(true)
    expect(RemoteAccess.opensStream({ method: "GET", path: "/api/session" })).toBe(false)
    expect(RemoteAccess.opensStream({ method: "GET", path: "/api/pty/pty_1/connect" })).toBe(false)
    expect(RemoteAccess.opensStream({ method: "POST", path: "/api/event" })).toBe(false)
  })

  test("the threat model prints exactly this table", async () => {
    const doc = await fs.readFile(path.join(import.meta.dir, "../../../../../docs/security/threat-model.md"), "utf8")
    const rows = doc
      .split("\n")
      .map((line) => /^\| `([A-Z]+)` \| `([^`]+)` \| (allowed|denied) \|$/.exec(line.trim()))
      .filter((match) => match !== null)
      .map((match) => `${match[3]} ${match[1]} ${match[2]}`)
    const expected = [
      ...RemoteAccess.allowed.map(([method, route]) => `allowed ${method} ${route}`),
      ...RemoteAccess.denied.map(([method, route]) => `denied ${method} ${route}`),
    ]
    expect(rows).toEqual(expected)
  })
})
