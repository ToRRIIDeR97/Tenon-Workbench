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

  test("shows a local write mid-read and an older read never overwrites it", async () => {
    const directory = `C:\\write-${crypto.randomUUID()}`
    const reply = { send: (_: Response) => {} }
    const calendar = createRoot(() =>
      createCalendarResource(
        () => directory,
        client(() => new Promise<Response>((resolve) => (reply.send = resolve))),
      ),
    )
    expect(calendar.loading()).toBe(true)
    calendar.mutate(snapshot("r2", "Saved here"))
    expect(calendar.loading()).toBe(false)
    expect(calendar.snapshot()?.revision).toBe("r2")
    reply.send(Response.json(snapshot("r1", "Older read")))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calendar.snapshot()?.revision).toBe("r2")
  })

  test("a failed refresh keeps the last snapshot and reports the error", async () => {
    const directory = `C:\\refresh-${crypto.randomUUID()}`
    const replies = [() => Response.json(snapshot("r1", "Standup")), () => new Response("down", { status: 500 })]
    const calendar = createRoot(() =>
      createCalendarResource(
        () => directory,
        client(async () => replies.shift()!()),
      ),
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calendar.snapshot()?.revision).toBe("r1")
    await Promise.resolve(calendar.refetch()).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calendar.error()).toBeDefined()
    expect(calendar.snapshot()?.revision).toBe("r1")
    expect(calendar.loading()).toBe(false)
  })
})
