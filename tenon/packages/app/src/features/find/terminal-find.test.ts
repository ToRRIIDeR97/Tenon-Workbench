import { describe, expect, test } from "bun:test"
import { terminalMatches } from "./terminal-find"

describe("AC-5 terminalMatches", () => {
  test("finds matches across rows in row order", () => {
    expect(terminalMatches(["$ bun test", "error: boom", "  Error again error"], "error")).toEqual([
      { row: 1, column: 0, length: 5 },
      { row: 2, column: 2, length: 5 },
      { row: 2, column: 14, length: 5 },
    ])
  })

  test("an empty query finds nothing", () => {
    expect(terminalMatches(["anything"], "")).toEqual([])
  })
})
