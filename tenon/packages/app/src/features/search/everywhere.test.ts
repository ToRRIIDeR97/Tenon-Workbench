import { describe, expect, test } from "bun:test"
import { everywhereLinks, shouldSearchEverywhere } from "./everywhere"

const result = {
  pages: [{ path: "Acme/Plan notes.md", title: "Plan notes", projectId: "p1", snippet: "…the plan…" }],
  tasks: [{ id: "t1", title: "Plan sprint", snippet: "Plan sprint" }],
  events: [{ id: "e1", title: "Planning", date: "2026-11-30", snippet: "Planning" }],
  threads: [{ id: "ses_1", title: "Fix plan", directory: "/work", snippet: "the plan", updated: 1 }],
}

describe("AC-19 everywhereLinks", () => {
  test("turns results into links grouped pages, tasks, events, threads", () => {
    const links = everywhereLinks(result, "local")
    expect(links.map((link) => [link.group, link.href])).toEqual([
      ["pages", "/projects?page=Acme%2FPlan%20notes.md"],
      ["tasks", "/calendar?task=t1"],
      ["events", "/calendar?event=e1&date=2026-11-30"],
      ["threads", links[3]!.href],
    ])
    expect(links[3]!.href).toEndWith("/session/ses_1")
    expect(links.map((link) => link.detail)).toEqual(["…the plan…", "Plan sprint", "Planning", "the plan"])
  })

  test("searches only for two or more characters", () => {
    expect(shouldSearchEverywhere("a")).toBe(false)
    expect(shouldSearchEverywhere(" ab ")).toBe(true)
  })
})
