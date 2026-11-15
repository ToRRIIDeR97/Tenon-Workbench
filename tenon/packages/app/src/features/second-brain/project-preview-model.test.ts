import { describe, expect, test } from "bun:test"
import type { TimelineItem } from "./client"
import { previewSummary } from "./project-preview-model"

const item = (
  id: string,
  kind: TimelineItem["kind"],
  status: TimelineItem["status"],
  extra: Partial<TimelineItem> = {},
) => ({ id, title: id, kind, status, ...extra }) as TimelineItem

describe("previewSummary", () => {
  const items = [
    item("Ingest", "milestone", "done"),
    item("Migration", "milestone", "todo", { start: "2026-11-20" }),
    item("a", "task", "done"),
    item("b", "task", "todo"),
    item("c", "task", "doing"),
  ]

  test("the next milestone is the first unfinished one, with its date", () => {
    expect(previewSummary({}, items).next).toEqual({ title: "Migration", date: "2026-11-20" })
  })

  test("the Project's own next milestone wins, dated when it matches an item", () => {
    expect(previewSummary({ nextMilestone: "Migration" }, items).next).toEqual({
      title: "Migration",
      date: "2026-11-20",
    })
    expect(previewSummary({ nextMilestone: "Launch" }, items).next).toEqual({ title: "Launch", date: undefined })
  })

  test("open tasks put the ones in progress first and count what is done", () => {
    const summary = previewSummary({}, items)
    expect(summary.open.map((task) => task.id)).toEqual(["c", "b"])
    expect([summary.done, summary.total]).toEqual([1, 3])
  })

  test("no milestones and no tasks leave nothing to show", () => {
    expect(previewSummary({ nextMilestone: " " }, [])).toEqual({ next: undefined, open: [], done: 0, total: 0 })
  })
})
