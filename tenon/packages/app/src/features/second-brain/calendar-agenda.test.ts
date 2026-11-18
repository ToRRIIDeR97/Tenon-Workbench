import { describe, expect, test } from "bun:test"
import { scheduleBounds } from "./calendar-domain"

// Acceptance test for implementations/harness-ux-batch-2 (AC-10): the agenda lists today and later, not days
// that have passed.

describe("AC-10 scheduleBounds", () => {
  const week = { start: "2026-11-16", end: "2026-11-22" }

  test("the agenda starts today and has no end", () => {
    expect(scheduleBounds("agenda", "2026-11-01", week, "2026-11-18")).toEqual({
      start: "2026-11-18",
      end: "9999-12-31",
    })
  })

  test("day and week keep their own range", () => {
    expect(scheduleBounds("today", "2026-11-10", week, "2026-11-18")).toEqual({
      start: "2026-11-10",
      end: "2026-11-10",
    })
    expect(scheduleBounds("week", "2026-11-18", week, "2026-11-18")).toEqual(week)
  })
})
