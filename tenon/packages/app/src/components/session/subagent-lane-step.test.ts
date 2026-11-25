import { describe, expect, test } from "bun:test"
import { steadyStep } from "./subagent-lane"

describe("AC-11 steadyStep", () => {
  test("an equal step rebuilt from new progress keeps the previous object", () => {
    const before = { tool: "acp_execute", status: "in_progress", title: "bun test" }
    const rebuilt = { tool: "acp_execute", status: "in_progress", title: "bun test" }
    expect(steadyStep(before, rebuilt)).toBe(before)
  })

  test("a new status or title is a new step", () => {
    const before = { tool: "acp_execute", status: "in_progress", title: "bun test" }
    const done = { ...before, status: "completed" }
    expect(steadyStep(before, done)).toBe(done)
    const next = { ...before, title: "bun run lint" }
    expect(steadyStep(before, next)).toBe(next)
  })

  test("no step is no step", () => {
    expect(steadyStep({ tool: "a", status: "pending" }, undefined)).toBeUndefined()
  })
})
