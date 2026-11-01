import { expect, test } from "bun:test"
import {
  formatDateTimeMedium,
  formatRelativeTime,
  parseISODate,
  previousLocalDay,
  sameLocalDay,
  withinMonths,
} from "./date"

const now = new Date(2026, 10, 1, 10, 0, 0).getTime()

test("same local day and the day before", () => {
  expect(sameLocalDay(new Date(2026, 10, 1, 0, 1).getTime(), now)).toBe(true)
  expect(sameLocalDay(new Date(2026, 9, 31, 23, 59).getTime(), now)).toBe(false)
  expect(sameLocalDay(new Date(2026, 9, 31, 23, 59).getTime(), previousLocalDay(now))).toBe(true)
})

test("relative time uses the largest whole unit, without weeks", () => {
  expect(formatRelativeTime(now - 5_000, now, "en-US")).toBe("5 seconds ago")
  expect(formatRelativeTime(now - 10 * 86_400_000, now, "en-US")).toBe("10 days ago")
  expect(formatRelativeTime(now - 45 * 86_400_000, now, "en-US")).toBe("1 month ago")
  expect(formatRelativeTime(now + 2 * 3_600_000, now, "en-US")).toBe("in 2 hours")
})

test("medium date-time format and invalid input", () => {
  expect(formatDateTimeMedium(new Date(2026, 7, 31, 16, 18).getTime(), "en-US")).toBe("Aug 31, 2026, 4:18 PM")
  expect(formatDateTimeMedium("not a date", "en-US")).toBeUndefined()
})

test("release window counts 30-day months and reads date-only values as local", () => {
  expect(withinMonths("2026-06-01", 6, now)).toBe(true)
  expect(withinMonths("2026-05-02", 6, now)).toBe(false)
  expect(withinMonths("bad", 6, now)).toBe(false)
  expect(parseISODate("2026-06-01")).toBe(new Date(2026, 5, 1).getTime())
  expect(Number.isNaN(parseISODate(undefined))).toBe(true)
})
