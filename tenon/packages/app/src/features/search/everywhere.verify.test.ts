import { describe, expect, test } from "bun:test"
import { everywhereLinks } from "./everywhere"

describe("AC-19 everywhereLinks (verification)", () => {
  test("empty groups give no links", () => {
    expect(everywhereLinks({ pages: [], tasks: [], events: [], threads: [] }, "local")).toEqual([])
  })

  test("ids with special characters are encoded and every link has a unique key", () => {
    const links = everywhereLinks(
      {
        pages: [{ path: "A&B/C?.md", title: "C", projectId: null, snippet: "" }],
        tasks: [{ id: "t&1", title: "T", snippet: "" }],
        events: [{ id: "e 1", title: "E", date: "2026-11-30", snippet: "" }],
        threads: [],
      },
      "local",
    )
    expect(links.map((link) => link.href)).toEqual([
      "/projects?page=A%26B%2FC%3F.md",
      "/calendar?task=t%261",
      "/calendar?event=e%201&date=2026-11-30",
    ])
    expect(new Set(links.map((link) => link.key)).size).toBe(3)
  })
})
