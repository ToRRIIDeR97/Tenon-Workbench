import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { connect } from "node:net"
import { after, test } from "node:test"
import { startRemoteListener } from "./listener.ts"

const seen: string[] = []
const server: Server = createServer((request, response) => {
  seen.push(`${request.method} ${request.url}`)
  response.end("ok")
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
const address = server.address()
const target = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`
const remote = await startRemoteListener({ host: "127.0.0.1", port: 0, target: () => target })
const listening = new URL(remote.url)

after(async () => {
  await remote.stop()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function send(text: string) {
  return new Promise<string>((resolve) => {
    const socket = connect(Number(listening.port), listening.hostname, () => socket.write(text))
    let answer = ""
    socket.on("data", (chunk) => {
      answer += chunk.toString()
      if (answer.includes("\r\n\r\n")) socket.end()
    })
    socket.on("close", () => resolve(answer))
    socket.on("error", () => resolve(answer))
  })
}

void test("AC-P6b-3 socket upgrades are refused", async () => {
  const answer = await send(
    "GET /pty/x/connect HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nAuthorization: Bearer device-token\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
  )
  assert.equal(answer.startsWith("HTTP/1.1 403"), true)
  assert.deepEqual(seen, [])
})

void test("AC-P6b-3 the raw path reaches the server as sent", async () => {
  const answer = await send(
    "GET /api//session/../config?x=1 HTTP/1.1\r\nHost: phone\r\nAuthorization: Bearer t\r\nConnection: close\r\n\r\n",
  )
  assert.equal(answer.startsWith("HTTP/1.1 200"), true)
  assert.deepEqual(seen, ["GET /api//session/../config?x=1"])
})
