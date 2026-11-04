import { expect, test } from "bun:test"
import { setRoutineEnabled } from "./client"

test("switching a routine sends its other properties and the revision it read", async () => {
  const requests: RequestInit[] = []
  const page = {
    body: "Do the thing",
    revision: "rev_1",
    info: { path: "Routines/Daily.md", title: "Daily", properties: { schedule: "daily 08:00", enabled: false } },
  }
  const fetch = (async (_url: URL, init?: RequestInit) => {
    if (init?.method === "PUT") requests.push(init)
    return Response.json(page)
  }) as typeof globalThis.fetch
  const server = { http: { url: "http://127.0.0.1:4096" } } as Parameters<typeof setRoutineEnabled>[0]["server"]

  await setRoutineEnabled({ server, fetch, target: { directory: "/vault" } }, "Routines/Daily.md", true)

  expect(JSON.parse(String(requests[0]?.body))).toEqual({
    body: "Do the thing",
    title: "Daily",
    properties: { schedule: "daily 08:00", enabled: true },
    expectedRevision: "rev_1",
  })
})
