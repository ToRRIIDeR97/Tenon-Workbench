import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createCalendarResource } from "@/features/second-brain/calendar-cache"
import type { readCalendar } from "@/features/second-brain/client"

function client(respond: () => Promise<Response>) {
  const fetch = Object.assign(respond, { preconnect: globalThis.fetch.preconnect })
  return (directory: string) =>
    ({ server: { http: { url: "http://localhost:4096" } }, fetch, target: { directory } }) as unknown as Parameters<
      typeof readCalendar
    >[0]
}

const snapshot = (revision: string, title: string) => ({
  version: 2,
  revision,
  tasks: [],
  events: [{ id: title, title, date: "2026-11-02", source: "local" }],
})

describe("createCalendarResource", () => {
  test("shows the last snapshot while a later read is in flight", async () => {
    const directory = `C:\\brain-${crypto.randomUUID()}`
    const first = createRoot(() =>
      createCalendarResource(
        () => directory,
        client(async () => Response.json(snapshot("r1", "Standup"))),
      ),
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(first.snapshot()?.revision).toBe("r1")

    // A fresh mount (a relaunch or a remounted page) whose read never answers still paints the cached events.
    const second = createRoot(() =>
      createCalendarResource(
        () => directory,
        client(() => new Promise<Response>(() => {})),
      ),
    )
    expect(second.loading()).toBe(false)
    expect(second.snapshot()?.events.map((event) => event.title)).toEqual(["Standup"])
  })

  test("is loading only with nothing cached for the workspace", () => {
    const cold = createRoot(() =>
      createCalendarResource(
        () => `C:\\cold-${crypto.randomUUID()}`,
        client(() => new Promise<Response>(() => {})),
      ),
    )
    expect(cold.loading()).toBe(true)
    expect(cold.snapshot()).toBeUndefined()
  })
})
