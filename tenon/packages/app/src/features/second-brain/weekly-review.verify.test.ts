import { describe, expect, test } from "bun:test"
import { weeklyReview } from "./weekly-review"

const now = new Date(2026, 10, 28, 12)
const iso = (offset: number) => new Date(2026, 10, 28 + offset, 10).toISOString()

describe("AC-20 weeklyReview (verification)", () => {
  test("a page edit within 14 days keeps a Project from being stalled", () => {
    const review = weeklyReview({
      now,
      tasks: [],
      events: [],
      threads: [],
      projects: [{ id: "p1", name: "Acme", status: "active" }],
      pages: [{ path: "Acme/Plan.md", title: "Plan", projectId: "p1", updatedAt: iso(-10) }],
    })
    expect(review.stalled).toEqual([])
    expect(review.pages.map((page) => page.path)).toEqual([])
  })

  test("pages edited this week are listed newest first", () => {
    const review = weeklyReview({
      now,
      tasks: [],
      events: [],
      threads: [],
      projects: [],
      pages: [
        { path: "A.md", title: "A", projectId: null, updatedAt: iso(-1) },
        { path: "B.md", title: "B", projectId: null, updatedAt: iso(-3) },
        { path: "C.md", title: "C", projectId: null, updatedAt: iso(-9) },
      ],
    })
    expect(review.pages.map((page) => page.path)).toEqual(["A.md", "B.md"])
  })

  test("completed and deleted tasks are never overdue or upcoming", () => {
    const task = {
      title: "t",
      createdAt: iso(-30),
      updatedAt: iso(-30),
      source: "local" as const,
      syncState: "local" as const,
    }
    const review = weeklyReview({
      now,
      tasks: [
        { ...task, id: "a", dueDate: "2026-11-20", completedAt: iso(-1) },
        { ...task, id: "b", dueDate: "2026-11-20", outboxKind: "delete" as const },
        { ...task, id: "c", dueDate: "2026-11-30", completedAt: iso(-1) },
      ],
      events: [],
      threads: [],
      projects: [],
      pages: [],
    })
    expect(review.overdue).toEqual([])
    expect(review.upcoming).toEqual([])
  })

  test("an archived Project is never stalled and empty input gives empty sections", () => {
    const review = weeklyReview({
      now,
      tasks: [],
      events: [],
      threads: [],
      projects: [{ id: "p", name: "Old", status: "archived" }],
      pages: [],
    })
    expect(review).toEqual({ completed: [], overdue: [], upcoming: [], threads: [], stalled: [], pages: [] })
  })
})
