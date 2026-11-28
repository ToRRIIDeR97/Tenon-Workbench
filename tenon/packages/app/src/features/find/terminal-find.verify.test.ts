import { describe, expect, test } from "bun:test"
import { terminalMatches } from "./terminal-find"

describe("AC-5 terminalMatches (verification)", () => {
  test("empty rows are skipped and row numbers stay absolute", () => {
    expect(terminalMatches(["", "", "ok", "", "OK"], "ok")).toEqual([
      { row: 2, column: 0, length: 2 },
      { row: 4, column: 0, length: 2 },
    ])
  })

  test("special characters in the query are literal", () => {
    expect(terminalMatches(["a*b a+b"], "a+b")).toEqual([{ row: 0, column: 4, length: 3 }])
  })
})
