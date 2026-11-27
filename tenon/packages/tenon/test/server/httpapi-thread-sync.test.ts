import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@tenon/core/global"
import { ThreadSync } from "@tenon/core/thread-sync"
import { Context } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>

function request(route: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("content-type", "application/json")
  return HttpApiApp.webHandler().handler(new Request(`http://localhost${route}`, { ...init, headers }), context)
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("thread sync HttpApi", () => {
  test("serves the manager and answers its error codes with fitting statuses", async () => {
    const status = await request("/api/thread-sync")
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({ enabled: false, ready: false, missing: ["bucket", "key", "store"] })

    const invalid = await request("/api/thread-sync", {
      method: "PUT",
      body: JSON.stringify({ bucket: "Not A Bucket" }),
    })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: "invalid_name" })

    const configured = await request("/api/thread-sync", {
      method: "PUT",
      body: JSON.stringify({ enabled: true, bucket: "my-threads", machineName: " Desk " }),
    })
    expect(configured.status).toBe(200)
    expect(await configured.json()).toMatchObject({
      enabled: true,
      ready: false,
      bucket: "my-threads",
      machine: { name: "Desk" },
      missing: ["key", "store"],
    })
    const saved = await fs.readFile(path.join(Global.make().config, ThreadSync.SETTINGS_FILE), "utf8")
    expect(JSON.parse(saved)).toMatchObject({ enabled: true, bucket: "my-threads" })

    const blocked = await Promise.all([
      request("/api/thread-sync/threads"),
      request("/api/thread-sync/threads/ses_1/push", { method: "POST" }),
      request("/api/thread-sync/threads/ses_1/pull", { method: "POST" }),
      request("/api/thread-sync/threads/ses_1/continue", {
        method: "POST",
        body: JSON.stringify({ directory: process.platform === "win32" ? "C:\\work" : "/work" }),
      }),
      request("/api/thread-sync/threads/ses_1", { method: "DELETE" }),
    ])
    expect(blocked.map((response) => response.status)).toEqual([412, 412, 412, 412, 412])
    const bodies = await Promise.all(blocked.map((response) => response.json()))
    expect(bodies.map((body) => (body as { code?: string }).code)).toEqual(blocked.map(() => "not_ready"))
  })
})
