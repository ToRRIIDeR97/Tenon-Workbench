import { afterEach, describe, expect, test } from "bun:test"
import { GlobalBus } from "../../src/bus/global"
import { Server } from "../../src/server/server"
import { SKIP_SYNC_EVENTS_HEADER } from "../../src/server/routes/instance/httpapi/handlers/global"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

// Reads the SSE stream until a marker event appears, emitting a sync copy
// before each marker.
async function readUntilMarker(headers: Record<string, string>) {
  const controller = new AbortController()
  const response = await Server.Default().app.request("/global/event", { headers, signal: controller.signal })
  expect(response.status).toBe(200)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let text = ""
  // `server.connected` is written before the bus subscription starts, so keep
  // emitting until the marker comes back.
  const emit = () => {
    GlobalBus.emit("event", {
      directory: "global",
      payload: { type: "sync", syncEvent: { id: "evt_sync", type: "x.1", seq: 1, aggregateID: "a", data: {} } },
    })
    GlobalBus.emit("event", { directory: "global", payload: { type: "marker.event", properties: {} } })
  }
  const timer = setInterval(emit, 20)
  try {
    while (!text.includes("marker.event")) {
      const chunk = await reader.read()
      if (chunk.done) break
      text += decoder.decode(chunk.value, { stream: true })
    }
  } finally {
    clearInterval(timer)
    controller.abort()
    await reader.cancel().catch(() => {})
  }
  return text
}

describe("/global/event sync copies", () => {
  test("are sent by default", async () => {
    const text = await readUntilMarker({})
    expect(text).toContain("marker.event")
    expect(text).toContain('"type":"sync"')
  })

  test("are skipped when the client opts out", async () => {
    const text = await readUntilMarker({ [SKIP_SYNC_EVENTS_HEADER]: "1" })
    expect(text).toContain("marker.event")
    expect(text).not.toContain('"type":"sync"')
  })
})
