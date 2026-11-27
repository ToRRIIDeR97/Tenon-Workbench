import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { lanAddresses, validateRemoteConfig } from "./addresses"
import { startRemoteListener, type RemoteListener } from "./listener"

type Seen = { method: string; url: string; authorization?: string; host?: string; body: string }

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

async function upstream() {
  const seen: Seen[] = []
  const server: Server = createServer((request: IncomingMessage, response) => {
    let body = ""
    request.on("data", (chunk: Buffer) => (body += chunk.toString()))
    request.on("end", () => {
      seen.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization,
        host: request.headers.host,
        body,
      })
      if (request.url?.startsWith("/api/event")) {
        response.writeHead(200, { "content-type": "text/event-stream" })
        response.write("data: one\n\n")
        setTimeout(() => response.end("data: two\n\n"), 50)
        return
      }
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ ok: true }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, seen }
}

async function listener(target: string) {
  const started: RemoteListener = await startRemoteListener({ host: "127.0.0.1", port: 0, target: () => target })
  closers.push(() => started.stop())
  return started
}

describe("AC-P6b-3 the listener forwards device requests only", () => {
  test("a bearer request is forwarded unchanged with its path, query and body", async () => {
    const server = await upstream()
    const remote = await listener(server.url)
    const response = await fetch(`${remote.url}/api/session?limit=5`, {
      method: "POST",
      headers: { authorization: "Bearer device-token", "content-type": "application/json" },
      body: JSON.stringify({ title: "From the phone" }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(server.seen).toEqual([
      {
        method: "POST",
        url: "/api/session?limit=5",
        authorization: "Bearer device-token",
        host: new URL(server.url).host,
        body: JSON.stringify({ title: "From the phone" }),
      },
    ])
  })

  test("the password never works on the remote listener", async () => {
    const server = await upstream()
    const remote = await listener(server.url)
    const basic = `Basic ${Buffer.from("opencode:secret").toString("base64")}`
    expect((await fetch(`${remote.url}/api/session`, { headers: { authorization: basic } })).status).toBe(401)
    expect((await fetch(`${remote.url}/api/session?auth_token=c2VjcmV0`)).status).toBe(401)
    expect((await fetch(`${remote.url}/api/session`)).status).toBe(401)
    expect(server.seen).toEqual([])
  })

  test("pairing and ticketed event streams need no header", async () => {
    const server = await upstream()
    const remote = await listener(server.url)
    const pair = await fetch(`${remote.url}/remote/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "ABCD2345", name: "Pixel" }),
    })
    expect(pair.status).toBe(200)
    const stream = await fetch(`${remote.url}/api/event?ticket=t123`)
    expect(stream.status).toBe(200)
    expect(await stream.text()).toBe("data: one\n\ndata: two\n\n")
    expect(server.seen.map((item) => `${item.method} ${item.url}`)).toEqual([
      "POST /remote/pair",
      "GET /api/event?ticket=t123",
    ])
    expect((await fetch(`${remote.url}/remote/pair`)).status).toBe(401)
  })

  test("an unreachable server answers 502 and stop closes the port", async () => {
    const remote = await startRemoteListener({ host: "127.0.0.1", port: 0, target: () => "http://127.0.0.1:1" })
    expect(
      (await fetch(`${remote.url}/api/session`, { headers: { authorization: "Bearer device-token" } })).status,
    ).toBe(502)
    await remote.stop()
    const after = await fetch(`${remote.url}/api/session`).then(
      () => "open",
      () => "closed",
    )
    expect(after).toBe("closed")
  })
})

describe("AC-P6b-4 CORS for the phone app", () => {
  test("a preflight from the Capacitor origin is answered, others are not", async () => {
    const server = await upstream()
    const remote = await listener(server.url)
    const preflight = await fetch(`${remote.url}/api/session`, {
      method: "OPTIONS",
      headers: {
        origin: "capacitor://localhost",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("access-control-allow-origin")).toBe("capacitor://localhost")
    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization")
    const real = await fetch(`${remote.url}/api/session`, {
      headers: { origin: "https://localhost", authorization: "Bearer device-token" },
    })
    expect(real.headers.get("access-control-allow-origin")).toBe("https://localhost")
    const other = await fetch(`${remote.url}/api/session`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
    })
    expect(other.headers.get("access-control-allow-origin")).toBeNull()
    expect(server.seen).toHaveLength(1)
  })
})

describe("AC-P6b-2 addresses and settings", () => {
  test("only non-internal addresses are offered, IPv4 first", () => {
    const windows = {
      "Wi-Fi": [
        { address: "192.168.1.20", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
      ],
      "Loopback Pseudo-Interface 1": [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      Tailscale: [{ address: "100.101.102.103", family: "IPv4", internal: false }],
    }
    expect(lanAddresses(windows)).toEqual([
      { address: "192.168.1.20", name: "Wi-Fi" },
      { address: "100.101.102.103", name: "Tailscale" },
    ])
    const mac = {
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      en0: [{ address: "10.0.0.8", family: "IPv4", internal: false }],
      utun3: [{ address: "fd7a:115c:a1e0::1", family: "IPv6", internal: false }],
    }
    expect(lanAddresses(mac)).toEqual([
      { address: "10.0.0.8", name: "en0" },
      { address: "fd7a:115c:a1e0::1", name: "utun3" },
    ])
  })

  test("settings accept only an offered address and a free-range port", () => {
    const offered = [{ address: "192.168.1.20", name: "Wi-Fi" }]
    expect(validateRemoteConfig({ enabled: true, address: "192.168.1.20", port: 47100 }, offered)).toEqual({
      enabled: true,
      address: "192.168.1.20",
      port: 47100,
    })
    expect(() => validateRemoteConfig({ enabled: true, address: "0.0.0.0", port: 47100 }, offered)).toThrow(
      "remote_address_invalid",
    )
    expect(() => validateRemoteConfig({ enabled: true, address: "127.0.0.1", port: 47100 }, offered)).toThrow(
      "remote_address_invalid",
    )
    expect(() => validateRemoteConfig({ enabled: true, address: "192.168.1.20", port: 80 }, offered)).toThrow(
      "remote_port_invalid",
    )
    expect(() => validateRemoteConfig({ enabled: true, address: "192.168.1.20", port: 70000 }, offered)).toThrow(
      "remote_port_invalid",
    )
    expect(validateRemoteConfig({ enabled: false, address: "", port: 47100 }, offered)).toEqual({
      enabled: false,
      address: "",
      port: 47100,
    })
  })
})
