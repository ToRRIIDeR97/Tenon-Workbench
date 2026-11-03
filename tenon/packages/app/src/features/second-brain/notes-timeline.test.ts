import { describe, expect, test } from "bun:test"
import type { TimelineItem } from "./client"
import { monthGrid, newPagePath, shiftMonth, timelineCounts, timelineLayout } from "./notes-timeline"

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
  expect(newPagePath("???", "", [])).toBe("page.md")
})

test("monthGrid lays a month out from Monday with tasks on every day they span", () => {
  const grid = monthGrid("2026-11", items)
  expect(grid[0][0].date).toBe("2026-10-26")
  expect(grid[0][0].inMonth).toBe(false)
  expect(grid.at(-1)?.at(-1)?.date).toBe("2026-12-06")
  const on = (date: string) =>
    grid
      .flat()
      .find((cell) => cell.date === date)
      ?.items.map((item) => item.id)
  expect(on("2026-11-02")).toEqual(["auth"])
  expect(on("2026-11-11")).toEqual(["hooks", "launch"])
  expect(on("2026-11-20")).toEqual([])
  expect(shiftMonth("2026-12", 1)).toBe("2027-01")
  expect(shiftMonth("2026-01", -1)).toBe("2025-12")
})
