import { describe, expect, test } from "bun:test"
import { followupPreference } from "./submit"

describe("followupPreference", () => {
  test("an external harness with running subagents queues, so sending doesn't stop them", () => {
    expect(followupPreference({ preference: "steer", external: true, runningSubagents: 2 })).toBe("queue")
  })

  test("the built-in agent, or no running subagents, keeps the setting", () => {
    expect(followupPreference({ preference: "steer", external: false, runningSubagents: 2 })).toBe("steer")
    expect(followupPreference({ preference: "steer", external: true, runningSubagents: 0 })).toBe("steer")
    expect(followupPreference({ preference: "queue", external: false, runningSubagents: 0 })).toBe("queue")
  })
})
