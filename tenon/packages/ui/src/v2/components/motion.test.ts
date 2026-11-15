import { describe, expect, test } from "bun:test"
import { cssDuration } from "./motion"

describe("cssDuration", () => {
  test("reads milliseconds and the minified seconds form alike", () => {
    expect(cssDuration("200ms")).toBe(200)
    expect(cssDuration(" .2s")).toBe(200)
    expect(cssDuration("0.12s")).toBe(120)
    expect(cssDuration("300")).toBe(300)
  })

  test("anything else falls back to the caller's default", () => {
    expect(cssDuration("")).toBeUndefined()
    expect(cssDuration("fast")).toBeUndefined()
  })
})
