import { describe, expect, test } from "bun:test"
import { createHarnessSwitchQueue } from "./harness-switch"

// Acceptance test for implementations/harness-ux-batch-2 (AC-2): a thread's harness switch shows at once and a
// send waits for it instead of being refused.

describe("AC-2 createHarnessSwitchQueue", () => {
  test("shows the pick at once, sends picks in order and settles after the last one", async () => {
    const sent: string[] = []
    const releases: Array<() => void> = []
    const queue = createHarnessSwitchQueue<string>({
      send: (choice) =>
        new Promise<void>((resolve) => {
          sent.push(choice)
          releases.push(resolve)
        }),
    })

    queue.switch("codex")
    expect(queue.pending()).toBe("codex")
    queue.switch("claude")
    expect(queue.pending()).toBe("claude")

    let settled = false
    void queue.settled().then(() => (settled = true))
    await Promise.resolve()
    expect(sent).toEqual(["codex"])

    releases[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sent).toEqual(["codex", "claude"])
    expect(settled).toBe(false)

    releases[1]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(true)
    expect(queue.pending()).toBeUndefined()
  })

  test("with nothing pending, settled resolves straight away", async () => {
    const queue = createHarnessSwitchQueue<string>({ send: async () => {} })
    expect(queue.pending()).toBeUndefined()
    await queue.settled()
  })
})
