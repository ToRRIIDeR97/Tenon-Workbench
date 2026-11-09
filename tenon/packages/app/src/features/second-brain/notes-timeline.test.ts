import { describe, expect, test } from "bun:test"
import type { TimelineItem } from "./client"
import {
  bodyAfterSave,
  dueDatePatch,
  matchProjects,
  milestoneGroups,
  monthGrid,
  newPagePath,
  restoreItem,
  shiftMonth,
  timelineCounts,
  timelineLayout,
} from "./notes-timeline"

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

test("bodyAfterSave leaves the editor alone when the server only added a final newline", () => {
  expect(bodyAfterSave("typed", "typed", "typed\n")).toEqual({ body: "typed", baseBody: "typed" })
  // Typed during the save: stays, and stays unsaved.
  expect(bodyAfterSave("typed more", "typed", "typed\n")).toEqual({ body: "typed more", baseBody: "typed" })
  // A real change on the server is adopted.
  expect(bodyAfterSave("typed", "typed", "merged\n")).toEqual({ body: "merged\n", baseBody: "merged\n" })
})

test("dueDatePatch moves a task's end and a milestone's start", () => {
  const task = items[0]
  expect(dueDatePatch(task, "2026-11-09")).toEqual({ end: "2026-11-09" })
  // Never leaves a due day before the start.
  expect(dueDatePatch(task, "2026-10-01")).toEqual({ start: undefined, end: "2026-10-01" })
  expect(dueDatePatch(task, undefined)).toEqual({ start: undefined, end: undefined })
  expect(dueDatePatch(items[2], "2026-12-01")).toEqual({ start: "2026-12-01" })
})

test("restoreItem rebuilds from the latest list", () => {
  const removed = items[1]
  const latest = [items[0], items[2]]
  expect(restoreItem(latest, removed, 1).map((item) => item.id)).toEqual(["auth", "hooks", "launch"])
  expect(restoreItem([], removed, 3).map((item) => item.id)).toEqual(["hooks"])
  expect(restoreItem(items, removed, 0)).toBe(items)
})

test("matchProjects searches names and outcomes", () => {
  const projects = [
    { name: "Acme API", outcome: "Ship the gateway" },
    { name: "Website", outcome: "New landing page" },
  ]
  expect(matchProjects(projects, " acme ").map((project) => project.name)).toEqual(["Acme API"])
  expect(matchProjects(projects, "landing").map((project) => project.name)).toEqual(["Website"])
  expect(matchProjects(projects, "  ")).toEqual([])
})

test("milestoneGroups puts each task under the milestone listed before it", () => {
  const list: TimelineItem[] = [
    { id: "a", title: "A", kind: "task", status: "todo" },
    { id: "m1", title: "M1", kind: "milestone", status: "done" },
    { id: "b", title: "B", kind: "task", status: "done" },
    { id: "m2", title: "M2", kind: "milestone", status: "todo" },
    { id: "c", title: "C", kind: "task", status: "done" },
    { id: "d", title: "D", kind: "task", status: "doing" },
  ]
  const shape = (groups: ReturnType<typeof milestoneGroups>) =>
    groups.map((group) => [group.milestone?.id, group.tasks.map((task) => task.id), group.done, group.total])
  expect(shape(milestoneGroups(list))).toEqual([
    [undefined, ["a"], 0, 1],
    ["m1", ["b"], 1, 1],
    ["m2", ["c", "d"], 1, 2],
  ])
  // Open hides done tasks and a done milestone with nothing open left; the counts still cover every task.
  expect(shape(milestoneGroups(list, true))).toEqual([
    [undefined, ["a"], 0, 1],
    ["m2", ["d"], 1, 2],
  ])
  expect(milestoneGroups([])).toEqual([])
})
