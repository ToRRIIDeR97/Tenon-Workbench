import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { it, json, put, request, setup } from "./vault-harness"

type Search = {
  pages: ReadonlyArray<{ path: string; title: string; snippet: string }>
  tasks: ReadonlyArray<{ id: string }>
  events: ReadonlyArray<{ id: string }>
  threads: ReadonlyArray<{ id: string }>
}

describe("AC-18 search route", () => {
  it.instance("searches pages and the calendar of the workspace", () =>
    Effect.gen(function* () {
      const { headers } = yield* setup
      yield* put(headers, "Release.md", { body: "Steps to deploy the API", title: "Release", create: true })
      yield* put(headers, "Other.md", { body: "nothing here", title: "Other", create: true })
      yield* request("/second-brain/calendar", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          events: [{ id: "event_a", title: "Deploy day", date: "2026-11-30", source: "local", syncState: "local" }],
          tasks: [],
        }),
      })
      const result = yield* request(`/second-brain/search?q=${encodeURIComponent("deploy")}`, { headers }).pipe(
        Effect.flatMap(json<Search>),
      )
      expect(result.pages.map((page) => page.path)).toEqual(["Release.md"])
      expect(result.pages[0]?.snippet).toContain("deploy")
      expect(result.events.map((event) => event.id)).toEqual(["event_a"])
      expect(result.threads).toEqual([])
      const short = yield* request("/second-brain/search?q=d", { headers }).pipe(Effect.flatMap(json<Search>))
      expect(short).toEqual({ pages: [], tasks: [], events: [], threads: [] })
    }),
  )
})
