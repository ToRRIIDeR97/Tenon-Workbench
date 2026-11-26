import { afterAll, describe, expect, test } from "bun:test"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { HttpApi } from "effect/http-api"
import { RemoteAccess } from "@tenon/core/remote-access"
import { ServerAuth } from "../../src/server/auth"
import { TenonHttpApi } from "../../src/server/routes/instance/httpapi/api"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const handler = HttpRouter.toWebHandler(
  HttpApiApp.routes.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ TENON_SERVER_PASSWORD: "secret" }))),
  ),
  { disableLogger: true },
).handler

const owner = { authorization: ServerAuth.header({ username: "opencode", password: "secret" }) ?? "" }

const call = async (method: string, route: string, headers: Record<string, string> = {}, body?: unknown) => {
  const response = await handler(
    new Request(new URL(route, "http://localhost"), {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    HttpApiApp.context,
  )
  const text = response.headers.get("content-type")?.includes("event-stream") ? "" : await response.text()
  await response.body?.cancel().catch(() => {})
  return { status: response.status, json: text ? JSON.parse(text) : undefined }
}

const pair = async (name: string) => {
  const code = await call("POST", "/api/remote/pairing-code", owner)
  expect(code.status).toBe(200)
  const paired = await call("POST", "/remote/pair", {}, { code: code.json.code, name })
  expect(paired.status).toBe(200)
  const device: { id: string; name: string; token: string } = paired.json
  return device
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

afterAll(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("remote access in the real server", () => {
  test("the owner pairs a phone, lists it and revokes it", async () => {
    const phone = await pair("Pixel 9")
    expect(phone.name).toBe("Pixel 9")
    expect((await call("GET", "/api/health", bearer(phone.token))).status).toBe(200)
    const listed = await call("GET", "/api/remote/devices", owner)
    expect(listed.json.devices.some((device: { id: string }) => device.id === phone.id)).toBe(true)
    expect(JSON.stringify(listed.json)).not.toContain(phone.token)
    expect((await call("GET", "/api/remote/devices", bearer(phone.token))).status).toBe(403)
    expect((await call("POST", "/api/remote/pairing-code", bearer(phone.token))).status).toBe(403)
    expect((await call("DELETE", `/api/remote/devices/${phone.id}`, bearer(phone.token))).status).toBe(403)
    expect((await call("DELETE", `/api/remote/devices/${phone.id}`, owner)).json).toEqual({ removed: true })
    expect((await call("GET", "/api/health", bearer(phone.token))).status).toBe(401)
  })

  test("a phone opens an event stream with a ticket, once", async () => {
    const phone = await pair("Stream phone")
    expect((await call("POST", "/api/remote/stream-ticket", owner)).status).toBe(403)
    const ticket = await call("POST", "/api/remote/stream-ticket", bearer(phone.token))
    expect(ticket.status).toBe(200)
    expect((await call("GET", `/api/event?ticket=${ticket.json.ticket}`)).status).toBe(200)
    expect((await call("GET", `/api/event?ticket=${ticket.json.ticket}`)).status).toBe(401)
    expect((await call("GET", `/api/event?auth_token=${encodeURIComponent(phone.token)}`)).status).toBe(401)
  })

  test("a phone is refused on every denied route before the handler runs", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const phone = await pair("Denied phone")
    const routes: Array<{ method: string; path: string }> = []
    HttpApi.reflect(TenonHttpApi, {
      onGroup: () => {},
      onEndpoint: (input) => void routes.push({ method: input.endpoint.method, path: input.endpoint.path }),
    })
    const denied = routes.filter((route) => !RemoteAccess.allowsRoute(route))
    expect(denied.length).toBeGreaterThan(150)
    const open: Array<string> = []
    for (const route of denied) {
      const target = route.path.replace(/:(\w+)/g, "x").replace("*", "a.txt")
      const response = await call(
        route.method,
        target,
        { ...bearer(phone.token), "x-opencode-directory": tmp.path },
        route.method === "GET" ? undefined : {},
      )
      if (response.status !== 403) open.push(`${route.method} ${route.path} -> ${response.status}`)
    }
    expect(open).toEqual([])
  })

  test("pairing is refused with a wrong code and limited to ten attempts a minute", async () => {
    await call("POST", "/api/remote/pairing-code", owner)
    const attempts = []
    for (const index of Array.from({ length: 12 }, (_, position) => position)) {
      attempts.push((await call("POST", "/remote/pair", {}, { code: `WRONG${index}`, name: "Phone" })).status)
    }
    expect(attempts.filter((status) => status === 429).length).toBeGreaterThanOrEqual(2)
    expect(attempts.filter((status) => status !== 429).every((status) => status === 403)).toBe(true)
  })
})
