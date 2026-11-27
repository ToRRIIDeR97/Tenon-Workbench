import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import { bearerFetch, normalizeServer, pairDevice, readPairing } from "./companion"

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

async function fakeComputer(answer: { status: number; body: unknown }) {
  const seen: Array<{ method: string; url: string; body: string; authorization?: string }> = []
  const server: Server = createServer((request, response) => {
    let body = ""
    request.on("data", (chunk: Buffer) => (body += chunk.toString()))
    request.on("end", () => {
      seen.push({
        method: request.method ?? "",
        url: request.url ?? "",
        body,
        authorization: request.headers.authorization,
      })
      response.writeHead(answer.status, { "content-type": "application/json" })
      response.end(JSON.stringify(answer.body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, seen }
}

describe("AC-P8-2 pairing", () => {
  test("an address is read as a plain-HTTP origin with the default port", () => {
    expect(normalizeServer("192.168.1.20")).toBe("http://192.168.1.20:47100")
    expect(normalizeServer(" http://192.168.1.20:5000/ ")).toBe("http://192.168.1.20:5000")
    expect(normalizeServer("tenon-pc.tailnet.ts.net:47100")).toBe("http://tenon-pc.tailnet.ts.net:47100")
    expect(normalizeServer("https://pc.example:8443")).toBe("https://pc.example:8443")
    expect(normalizeServer("")).toBeUndefined()
    expect(normalizeServer("ftp://x")).toBeUndefined()
    expect(normalizeServer("http://x/path?y")).toBe("http://x")
  })

  test("a QR link fills both fields", () => {
    expect(readPairing("tenon://pair?server=http%3A%2F%2F192.168.1.20%3A47100&code=ABCD2345")).toEqual({
      url: "http://192.168.1.20:47100",
      code: "ABCD2345",
    })
    expect(readPairing("hello")).toBeUndefined()
  })

  test("pairing posts the code and a name and keeps the token", async () => {
    const computer = await fakeComputer({ status: 200, body: { id: "dev_1", name: "Pixel", token: "secret-token" } })
    const paired = await pairDevice(fetch, { url: computer.url, code: " abcd-2345 ", name: "Pixel" })
    expect(paired).toEqual({ url: computer.url, id: "dev_1", name: "Pixel", token: "secret-token" })
    expect(computer.seen).toEqual([
      {
        method: "POST",
        url: "/remote/pair",
        body: JSON.stringify({ code: "ABCD2345", name: "Pixel" }),
        authorization: undefined,
      },
    ])
  })

  test("a refused code names the reason", async () => {
    for (const code of ["bad_code", "expired", "locked"]) {
      const computer = await fakeComputer({ status: 403, body: { code } })
      await expect(pairDevice(fetch, { url: computer.url, code: "ABCD2345", name: "Pixel" })).rejects.toThrow(code)
    }
    const limited = await fakeComputer({ status: 429, body: {} })
    await expect(pairDevice(fetch, { url: limited.url, code: "ABCD2345", name: "Pixel" })).rejects.toThrow(
      "too_many_attempts",
    )
    await expect(pairDevice(fetch, { url: "http://127.0.0.1:1", code: "ABCD2345", name: "Pixel" })).rejects.toThrow(
      "unreachable",
    )
  })
})

describe("AC-P8-3 requests carry the device token", () => {
  test("requests to the paired computer get the bearer token; others are untouched", async () => {
    const computer = await fakeComputer({ status: 200, body: {} })
    const other = await fakeComputer({ status: 200, body: {} })
    const wrapped = bearerFetch(fetch, { url: computer.url, token: "secret-token" })
    await wrapped(`${computer.url}/api/session`)
    await wrapped(new Request(`${computer.url}/api/session`, { headers: { authorization: "Basic eA==" } }))
    await wrapped(`${other.url}/elsewhere`)
    expect(computer.seen.map((item) => item.authorization)).toEqual(["Bearer secret-token", "Bearer secret-token"])
    expect(other.seen.map((item) => item.authorization)).toEqual([undefined])
  })

  test("an auth_token in the query is dropped before it leaves the phone", async () => {
    const computer = await fakeComputer({ status: 200, body: {} })
    const wrapped = bearerFetch(fetch, { url: computer.url, token: "secret-token" })
    await wrapped(`${computer.url}/api/event?auth_token=abc&x=1`)
    expect(computer.seen[0]!.url).toBe("/api/event?x=1")
  })
})
