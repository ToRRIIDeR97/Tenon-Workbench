import { afterEach, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import { startRemoteListener } from "./listener"

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

test("the phone app's origin is answered by the listener and not passed to the server; others are", async () => {
  const origins: Array<string | undefined> = []
  const server: Server = createServer((request, response) => {
    origins.push(request.headers.origin)
    response.end("{}")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const target = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const remote = await startRemoteListener({ host: "127.0.0.1", port: 0, target: () => target })
  closers.push(() => remote.stop())
  const phone = await fetch(`${remote.url}/api/session`, {
    headers: { origin: "http://localhost", authorization: "Bearer t" },
  })
  expect(phone.headers.get("access-control-allow-origin")).toBe("http://localhost")
  await fetch(`${remote.url}/api/session`, { headers: { origin: "https://evil.example", authorization: "Bearer t" } })
  expect(origins).toEqual([undefined, "https://evil.example"])
})
