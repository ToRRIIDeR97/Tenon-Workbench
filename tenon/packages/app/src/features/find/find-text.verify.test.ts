import { describe, expect, test } from "bun:test"
import { findRanges, stepIndex } from "./find-text"

describe("AC-1 findRanges (verification)", () => {
  test("a query with surrounding spaces keeps its inner text and matches across non-Latin letters", () => {
    expect(findRanges("Ünïcode ÜNÏCODE", "ünï")).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ])
  })

  test("backslashes, dollars and carets are literal", () => {
    expect(findRanges("C:\\temp $HOME ^start", "\\temp")).toEqual([{ start: 2, end: 7 }])
    expect(findRanges("C:\\temp $HOME ^start", "$HOME")).toEqual([{ start: 8, end: 13 }])
    expect(findRanges("C:\\temp $HOME ^start", "^s")).toEqual([{ start: 14, end: 16 }])
  })

  test("no match in empty text", () => {
    expect(findRanges("", "x")).toEqual([])
  })
})

describe("AC-1 stepIndex (verification)", () => {
  test("a single match stays on itself", () => {
    expect(stepIndex(1, 0, 1)).toBe(0)
    expect(stepIndex(1, 0, -1)).toBe(0)
  })

  test("an out-of-range current index starts from the edge", () => {
    expect(stepIndex(4, -1, 1)).toBe(0)
    expect(stepIndex(4, -1, -1)).toBe(3)
    expect(stepIndex(4, 9, 1)).toBe(0)
  })
})
