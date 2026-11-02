import { describe, expect, test } from "bun:test"
import { TOOLTIP_OPEN_DELAY, tooltipOpenDelay } from "./tooltip-delay"

describe("tooltipOpenDelay", () => {
  test("waits the open delay when no tooltip has closed yet", () => {
    expect(tooltipOpenDelay(undefined, 1000)).toBe(TOOLTIP_OPEN_DELAY)
  })

  test("opens at once within the skip window after a tooltip closed", () => {
    expect(tooltipOpenDelay(1000, 1000)).toBe(0)
    expect(tooltipOpenDelay(1000, 1399)).toBe(0)
  })

  test("waits again once the skip window has passed", () => {
    expect(tooltipOpenDelay(1000, 1400)).toBe(TOOLTIP_OPEN_DELAY)
    expect(tooltipOpenDelay(1000, 5000)).toBe(TOOLTIP_OPEN_DELAY)
  })
})
