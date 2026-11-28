import { describe, expect, test } from "bun:test"
import { findRanges, stepIndex } from "./find-text"

describe("AC-1 findRanges", () => {
  test("finds every match case-insensitively by default", () => {
    expect(findRanges("Rate limit, then RATE limit again", "rate")).toEqual([
      { start: 0, end: 4 },
      { start: 17, end: 21 },
    ])
  })

  test("case-sensitive search only matches the same case", () => {
    expect(findRanges("Rate rate RATE", "rate", { caseSensitive: true })).toEqual([{ start: 5, end: 9 }])
  })

  test("regex characters are literal text", () => {
    expect(findRanges("a.b axb a.b", "a.b")).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ])
    expect(findRanges("(x) [y] *z*", "[y]")).toEqual([{ start: 4, end: 7 }])
  })

  test("matches do not overlap", () => {
    expect(findRanges("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])
  })

  test("an empty or whitespace query finds nothing", () => {
    expect(findRanges("anything", "")).toEqual([])
    expect(findRanges("anything", "   ")).toEqual([])
  })
})

describe("AC-1 stepIndex", () => {
  test("wraps forward and backward", () => {
    expect(stepIndex(3, 0, 1)).toBe(1)
    expect(stepIndex(3, 2, 1)).toBe(0)
    expect(stepIndex(3, 0, -1)).toBe(2)
  })

  test("returns -1 when there are no matches", () => {
    expect(stepIndex(0, 0, 1)).toBe(-1)
    expect(stepIndex(0, -1, -1)).toBe(-1)
  })
})
