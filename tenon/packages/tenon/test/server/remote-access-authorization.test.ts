import { NodeHttpServer } from "@effect/platform-node"
import { afterAll, describe, expect } from "bun:test"
import fs from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { PtyTicket } from "@tenon/core/pty/ticket"
import { RemoteAccessService } from "@tenon/core/remote-access/service"
import { ServerAuth } from "../../src/server/auth"
import {
  Authorization,
  authorizationLayer,
  ServerAuthorization,
  serverAuthorizationLayer,
} from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { testEffect } from "../lib/effect"

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tenon-remote-authorization-"))
const access = RemoteAccessService.make({ file: path.join(directory, "devices.json") })
const accessLayer = Layer.succeed(RemoteAccessService.Service)(access)
const calls = { count: 0 }
const counted = () => Effect.sync(() => void (calls.count += 1)).pipe(Effect.as("ok"))

afterAll(() => fs.rm(directory, { recursive: true, force: true }))

const InstanceApi = HttpApi.make("test-remote-instance").add(
  HttpApiGroup.make("test")
    .add(
      HttpApiEndpoint.get("sessions", "/session", { success: Schema.String }),
      HttpApiEndpoint.get("ptys", "/pty", { success: Schema.String }),
      HttpApiEndpoint.put("fileContent", "/file/content", { success: Schema.String }),
      HttpApiEndpoint.get("event", "/event", { success: Schema.String }),
    )
    .middleware(Authorization),
)

const ServerApi = HttpApi.make("test-remote-server").add(
  HttpApiGroup.make("test.v2")
    .add(
      HttpApiEndpoint.get("session", "/api/session/:sessionID", {
        params: Schema.Struct({ sessionID: Schema.String }),
        success: Schema.String,
      }),
      HttpApiEndpoint.post("pty", "/api/pty", { success: Schema.String }),
      HttpApiEndpoint.get("devices", "/api/remote/devices", { success: Schema.String }),
      HttpApiEndpoint.get("event", "/api/event", { success: Schema.String }),
    )
    .middleware(ServerAuthorization),
)

const instanceHandlers = HttpApiBuilder.group(InstanceApi, "test", (handlers) =>
  handlers.handle("sessions", counted).handle("ptys", counted).handle("fileContent", counted).handle("event", counted),
)

const serverHandlers = HttpApiBuilder.group(ServerApi, "test.v2", (handlers) =>
  handlers.handle("session", counted).handle("pty", counted).handle("devices", counted).handle("event", counted),
)

const serve = <A, E, R>(routes: Layer.Layer<A, E, R>) =>
  HttpRouter.serve(routes, { disableListenLog: true, disableLogger: true }).pipe(
    Layer.provideMerge(NodeHttpServer.layerTest),
  )

const instanceLayer = serve(
  HttpApiBuilder.layer(InstanceApi).pipe(Layer.provide(instanceHandlers), Layer.provide(authorizationLayer)),
)
const serverLayer = serve(
  HttpApiBuilder.layer(ServerApi).pipe(Layer.provide(serverHandlers), Layer.provide(serverAuthorizationLayer)),
)

const secret = ServerAuth.Config.configLayer({ password: Option.some("secret"), username: "opencode" })
const open = ServerAuth.Config.configLayer({ password: Option.none(), username: "opencode" })
const tickets = Layer.effect(PtyTicket.Service, PtyTicket.make())

const itInstance = testEffect(instanceLayer.pipe(Layer.provide(secret), Layer.provide(accessLayer)))
const itInstanceOpen = testEffect(instanceLayer.pipe(Layer.provide(open), Layer.provide(accessLayer)))
const itServer = testEffect(
  serverLayer.pipe(Layer.provide(secret), Layer.provide(accessLayer), Layer.provideMerge(tickets)),
)
const itServerOpen = testEffect(
  serverLayer.pipe(Layer.provide(open), Layer.provide(accessLayer), Layer.provideMerge(tickets)),
)

const pairDevice = (name: string) =>
  Effect.promise(() => access.registry.pair({ code: access.registry.pairingCode().code, name }))

const send = (method: "GET" | "POST" | "PUT", url: string, headers: Record<string, string> = {}) =>
  HttpClientRequest.make(method)(url).pipe(HttpClientRequest.setHeaders(headers), HttpClient.execute)

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const basic = { authorization: ServerAuth.header({ username: "opencode", password: "secret" }) ?? "" }

const raw = (port: number, target: string, token: string) =>
  new Promise<number>((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () =>
      socket.write(
        `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ${token}\r\nConnection: close\r\n\r\n`,
      ),
    )
    socket.once("data", (chunk) => {
      resolve(Number(chunk.toString("latin1").split(" ")[1]))
      socket.destroy()
    })
    socket.on("error", reject)
  })

const port = Effect.gen(function* () {
  const server = yield* HttpServer.HttpServer
  if (server.address._tag === "UnixPathAddress") return yield* Effect.die("expected a TCP listener")
  return server.address.port
})

describe("device tokens on the instance routes", () => {
  itInstance.live("a device reaches its scope and gets 403 outside it, before the handler runs", () =>
    Effect.gen(function* () {
      const device = yield* pairDevice("Instance phone")
      const before = calls.count
      const inside = yield* send("GET", "/session", bearer(device.token))
      expect(inside.status).toBe(200)
      expect(calls.count).toBe(before + 1)
      const terminals = yield* send("GET", "/pty", bearer(device.token))
      const write = yield* send("PUT", "/file/content", bearer(device.token))
      expect([terminals.status, write.status]).toEqual([403, 403])
      expect(calls.count).toBe(before + 1)
    }),
  )

  itInstance.live("an unknown or revoked token is 401", () =>
    Effect.gen(function* () {
      const device = yield* pairDevice("Revoked phone")
      expect((yield* send("GET", "/session", bearer("not-a-device"))).status).toBe(401)
      expect((yield* send("GET", "/session", { authorization: "Bearer" })).status).toBe(401)
      yield* Effect.promise(() => access.registry.revoke(device.id))
      const revoked = yield* send("GET", "/session", bearer(device.token))
      expect(revoked.status).toBe(401)
      expect(revoked.headers["www-authenticate"] ?? "").toContain("Bearer")
    }),
  )

  itInstance.live("the password still reaches every route", () =>
    Effect.gen(function* () {
      expect((yield* send("GET", "/pty", basic)).status).toBe(200)
      expect((yield* send("GET", "/pty")).status).toBe(401)
    }),
  )

  itInstance.live("a device token in the query string is refused", () =>
    Effect.gen(function* () {
      const device = yield* pairDevice("Query phone")
      const token = encodeURIComponent(device.token)
      expect((yield* send("GET", `/session?auth_token=${token}`)).status).toBe(401)
      expect((yield* send("GET", `/event?ticket=${token}`)).status).toBe(401)
      expect((yield* send("GET", `/session?token=${token}`)).status).toBe(401)
    }),
  )

  itInstance.live("a stream ticket opens one event stream once and nothing else", () =>
    Effect.gen(function* () {
      const device = yield* pairDevice("Stream phone")
      const first = access.tickets.issue(device.id)
      expect((yield* send("GET", `/event?ticket=${first.ticket}`)).status).toBe(200)
      expect((yield* send("GET", `/event?ticket=${first.ticket}`)).status).toBe(401)
      const other = access.tickets.issue(device.id)
      expect((yield* send("GET", `/session?ticket=${other.ticket}`)).status).toBe(401)
      expect((yield* send("GET", `/pty?ticket=${other.ticket}`)).status).toBe(401)
      const late = access.tickets.issue(device.id)
      yield* Effect.promise(() => access.registry.revoke(device.id))
      expect((yield* send("GET", `/event?ticket=${late.ticket}`)).status).toBe(401)
    }),
  )

  itInstance.live("path tricks never reach a handler", () =>
    Effect.gen(function* () {
      const device = yield* pairDevice("Tricky phone")
      const listening = yield* port
      const before = calls.count
      const targets = [
        "/SESSION",
        "//session",
        "/session//",
        "/x/../pty",
        "/x/%2e%2e/pty",
        "/x/%2E%2E/pty",
        "/session/..",
        "\\pty",
        "/session\\..\\pty",
        "pty",
        "http://127.0.0.1/pty",
        "/pty/",
        "/file/content",
      ]
      const statuses = yield* Effect.promise(() =>
        Promise.all(targets.map((target) => raw(listening, target, device.token))),
      )
      expect(statuses.filter((status) => status < 400)).toEqual([])
      expect(statuses.slice(0, 3)).toEqual([403, 403, 403])
      expect(calls.count).toBe(before)
      expect(yield* Effect.promise(() => raw(listening, "/session/", device.token))).toBe(200)
    }),
  )
})

describe("device tokens without a password", () => {
  itInstanceOpen.live("a device is still held to its scope", () =>
    Effect.gen(function* () {
      const device = yield* pairDevice("Open phone")
      expect((yield* send("GET", "/pty")).status).toBe(200)
      expect((yield* send("GET", "/pty", bearer(device.token))).status).toBe(403)
      expect((yield* send("GET", "/session", bearer(device.token))).status).toBe(200)
      expect((yield* send("GET", "/session", bearer("unknown"))).status).toBe(401)
    }),
  )

  itServerOpen.live("a device is still held to its scope on /api", () =>
    Effect.gen(function* () {
      const device = yield* pairDevice("Open api phone")
      expect((yield* send("POST", "/api/pty")).status).toBe(200)
      expect((yield* send("POST", "/api/pty", bearer(device.token))).status).toBe(403)
      expect((yield* send("GET", "/api/session/ses_1", bearer(device.token))).status).toBe(200)
    }),
  )
})

describe("device tokens on the /api routes", () => {
  itServer.live("a device reaches its scope and is refused elsewhere", () =>
    Effect.gen(function* () {
      const device = yield* pairDevice("Api phone")
      const before = calls.count
      expect((yield* send("GET", "/api/session/ses_1", bearer(device.token))).status).toBe(200)
      const terminal = yield* send("POST", "/api/pty", bearer(device.token))
      expect(terminal.status).toBe(403)
      expect(yield* terminal.json).toEqual({
        _tag: "ForbiddenError",
        message: "This paired device cannot use this route",
      })
      expect((yield* send("GET", "/api/remote/devices", bearer(device.token))).status).toBe(403)
      expect(calls.count).toBe(before + 1)
    }),
  )

  itServer.live("an unknown token is 401 with a bodyful error", () =>
    Effect.gen(function* () {
      const response = yield* send("GET", "/api/session/ses_1", bearer("unknown"))
      expect(response.status).toBe(401)
      expect(yield* response.json).toEqual({ _tag: "UnauthorizedError", message: "Authentication required" })
    }),
  )

  itServer.live("the password and the stream ticket keep working", () =>
    Effect.gen(function* () {
      const device = yield* pairDevice("Api stream phone")
      expect((yield* send("POST", "/api/pty", basic)).status).toBe(200)
      expect((yield* send("GET", "/api/remote/devices", basic)).status).toBe(200)
      const ticket = access.tickets.issue(device.id).ticket
      expect((yield* send("GET", `/api/event?ticket=${ticket}`)).status).toBe(200)
      expect((yield* send("GET", `/api/event?ticket=${ticket}`)).status).toBe(401)
      expect((yield* send("GET", `/api/event?auth_token=${encodeURIComponent(device.token)}`)).status).toBe(401)
    }),
  )
})
