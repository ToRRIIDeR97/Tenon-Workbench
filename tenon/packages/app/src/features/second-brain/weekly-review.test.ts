import { describe, expect, test } from "bun:test"
import { weeklyReview } from "./weekly-review"

const now = new Date(2026, 10, 28, 12)
const day = (offset: number) => new Date(2026, 10, 28 + offset, 10).toISOString()
const date = (offset: number) => {
  const value = new Date(2026, 10, 28 + offset)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
}
const task = (id: string, extra: Record<string, unknown>) => ({
  id,
  title: id,
  createdAt: day(-30),
  updatedAt: day(-30),
  source: "local" as const,
  syncState: "local" as const,
  ...extra,
})

describe("AC-20 weeklyReview", () => {
  test("sorts the week into done, overdue, next week, threads per Project and stalled Projects", () => {
    const review = weeklyReview({
      now,
      tasks: [
        task("done-this-week", { completedAt: day(-2) }),
        task("done-long-ago", { completedAt: day(-20) }),
        task("overdue", { dueDate: date(-3) }),
        task("due-soon", { dueDate: date(3) }),
      ],
      events: [
        { id: "e-next", title: "e-next", date: date(2), source: "local", syncState: "local" },
        { id: "e-past", title: "e-past", date: date(-2), source: "local", syncState: "local" },
      ],
      threads: [
        { id: "s1", title: "Fix login", updated: Date.parse(day(-1)), projectId: "p1" },
        { id: "s2", title: "Old", updated: Date.parse(day(-12)), projectId: "p1" },
        { id: "s3", title: "Loose", updated: Date.parse(day(-1)) },
      ],
      projects: [
        { id: "p1", name: "Acme", status: "active" },
        { id: "p2", name: "Quiet", status: "active" },
        { id: "p3", name: "Paused", status: "paused" },
      ],
      pages: [],
    })
    expect(review.completed.map((item) => item.id)).toEqual(["done-this-week"])
    expect(review.overdue.map((item) => item.id)).toEqual(["overdue"])
    expect(review.upcoming.map((item) => item.id)).toEqual(["e-next", "due-soon"])
    expect(review.threads.map((group) => [group.projectId ?? null, group.threads.map((item) => item.id)])).toEqual([
      ["p1", ["s1"]],
      [null, ["s3"]],
    ])
    expect(review.stalled.map((item) => item.id)).toEqual(["p2"])
  })
})
