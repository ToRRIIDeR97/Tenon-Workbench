import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createVisibleInterval } from "./visible-interval"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function setHidden(value: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => value })
  document.dispatchEvent(new Event("visibilitychange"))
}

describe("createVisibleInterval", () => {
  test("skips ticks while hidden, catches up when shown, and stops on cleanup", async () => {
    let ticks = 0
    const dispose = createRoot((dispose) => {
      createVisibleInterval(() => ticks++, 10)
      return dispose
    })
    try {
      await wait(35)
      expect(ticks).toBeGreaterThan(0)

      setHidden(true)
      const before = ticks
      await wait(35)
      expect(ticks).toBe(before)

      setHidden(false)
      expect(ticks).toBe(before + 1)

      dispose()
      const stopped = ticks
      await wait(35)
      setHidden(false)
      expect(ticks).toBe(stopped)
    } finally {
      dispose()
      setHidden(false)
    }
  })
})
