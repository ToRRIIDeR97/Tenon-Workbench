import { describe, expect, test } from "bun:test"
import { capCut } from "./panel-cap"

describe("capCut", () => {
  test("no caption buttons: the band runs to the panel's edge", () => {
    expect(capCut(1200, undefined)).toBe(0)
  })
  test("a panel that ends before the buttons keeps its whole band", () => {
    expect(capCut(1000, 1142)).toBe(0)
  })
  test("a panel under the buttons stops its band where they begin", () => {
    expect(capCut(1224, 1142)).toBe(82)
  })
})
