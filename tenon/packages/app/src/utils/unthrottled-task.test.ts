import { afterEach, describe, expect, test } from "bun:test"
import { soon } from "./unthrottled-task"

// Acceptance test for implementations/harness-ux-batch-2 (AC-17, added mid-run): while the window is hidden, live
// event work runs as message-channel tasks, which the browser doesn't throttle, instead of on timers.

const setHidden = (hidden: boolean) => Object.defineProperty(document, "hidden", { value: hidden, configurable: true })

describe("AC-17 soon", () => {
  afterEach(() => setHidden(false))

  test("a hidden page runs the task without a timer", async () => {
    setHidden(true)
    const realTimeout = globalThis.setTimeout
    let timers = 0
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      timers++
      return realTimeout(...args)
    }) as typeof setTimeout
    try {
      const ran = await new Promise<boolean>((resolve) => soon(() => resolve(true), 16))
      expect(ran).toBe(true)
      expect(timers).toBe(0)
    } finally {
      globalThis.setTimeout = realTimeout
    }
  })

  test("a visible page waits the given time on a timer, and cancelling stops it", async () => {
    let ran = false
    const cancel = soon(() => (ran = true), 5)
    cancel()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(ran).toBe(false)
  })

  test("cancelling a hidden-page task stops it", async () => {
    setHidden(true)
    let ran = false
    const cancel = soon(() => (ran = true))
    cancel()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ran).toBe(false)
  })
})
