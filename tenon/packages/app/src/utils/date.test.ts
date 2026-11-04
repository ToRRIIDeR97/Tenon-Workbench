import { expect, test } from "bun:test"
import { formatDateTimeMedium, parseISODate, previousLocalDay, sameLocalDay, withinMonths } from "./date"

const now = new Date(2026, 10, 1, 10, 0, 0).getTime()

test("same local day and the day before", () => {
  expect(sameLocalDay(new Date(2026, 10, 1, 0, 1).getTime(), now)).toBe(true)
  expect(sameLocalDay(new Date(2026, 9, 31, 23, 59).getTime(), now)).toBe(false)
  expect(sameLocalDay(new Date(2026, 9, 31, 23, 59).getTime(), previousLocalDay(now))).toBe(true)
})

test("medium date-time format and invalid input", () => {
  // ICU versions differ in the date-time joiner (", " or " at ") and the space before PM (U+0020 or U+202F).
  expect(formatDateTimeMedium(new Date(2026, 7, 31, 16, 18).getTime(), "en-US")).toMatch(
    /^Aug 31, 2026(,| at) 4:18\sPM$/,
  )
  expect(formatDateTimeMedium("not a date", "en-US")).toBeUndefined()
})

test("release window counts 30-day months and reads date-only values as local", () => {
  expect(withinMonths("2026-06-01", 6, now)).toBe(true)
  expect(withinMonths("2026-05-02", 6, now)).toBe(false)
  expect(withinMonths("bad", 6, now)).toBe(false)
  expect(parseISODate("2026-06-01")).toBe(new Date(2026, 5, 1).getTime())
  expect(Number.isNaN(parseISODate(undefined))).toBe(true)
})
