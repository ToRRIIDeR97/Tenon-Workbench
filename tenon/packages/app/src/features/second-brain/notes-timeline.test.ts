import { describe, expect, test } from "bun:test"
import type { TimelineItem } from "./client"
import { newPagePath, timelineCounts, timelineLayout } from "./notes-timeline"

const items: TimelineItem[] = [
  { id: "auth", title: "Auth", kind: "task", status: "doing", start: "2026-11-02", end: "2026-11-08" },
  { id: "hooks", title: "Hooks", kind: "task", status: "done", start: "2026-11-09", end: "2026-11-15" },
  { id: "launch", title: "Launch", kind: "milestone", status: "todo", start: "2026-11-11" },
  { id: "loose", title: "Loose", kind: "task", status: "todo" },
]

describe("timelineLayout", () => {
  test("spans whole weeks from the Monday before the first date", () => {
    const layout = timelineLayout(items)
    expect(layout.weeks).toEqual(["2026-11-02", "2026-11-09"])
    expect(layout.rows.map((row) => [row.item.id, row.left, row.width])).toEqual([
      ["auth", 0, 50],
      ["hooks", 50, 50],
      ["launch", (9 / 14) * 100, 0],
      ["loose", undefined, undefined],
    ])
  })

  test("starts on Monday when the first date is mid-week, and has no weeks without dates", () => {
    expect(timelineLayout([{ ...items[0], start: "2026-11-05", end: "2026-11-05" }]).weeks).toEqual(["2026-11-02"])
    expect(timelineLayout([items[3]]).weeks).toEqual([])
  })
})

test("timelineCounts counts tasks and names the next open milestone", () => {
  expect(timelineCounts(items)).toEqual({ done: 1, total: 3, next: items[2] })
})

test("newPagePath picks a free name inside the folder", () => {
  expect(newPagePath("Untitled", "", [])).toBe("Untitled.md")
  expect(newPagePath("Untitled", "Acme API", [{ path: "Acme API/untitled.md" }])).toBe("Untitled 2.md")
  expect(newPagePath('a:b/"c"', "", [])).toBe("abc.md")
})
