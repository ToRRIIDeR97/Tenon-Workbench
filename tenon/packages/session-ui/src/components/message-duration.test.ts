import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { messageDurationMs, stoppedComputerUse, toolDurationMs } from "./message-duration"

describe("AC-3 each assistant row shows its own time", () => {
  test("a finished message's duration is its own created-to-completed span", () => {
    expect(messageDurationMs({ role: "assistant", time: { created: 1_000, completed: 4_500 } })).toBe(3_500)
  })

  test("an unfinished, user or clock-skewed message has no duration", () => {
    expect(messageDurationMs({ role: "assistant", time: { created: 1_000 } })).toBeUndefined()
    expect(messageDurationMs({ role: "user", time: { created: 1_000, completed: 2_000 } })).toBeUndefined()
    expect(messageDurationMs({ role: "assistant", time: { created: 5_000, completed: 4_000 } })).toBeUndefined()
  })

  test("rows no longer take the turn's total", () => {
    const part = readFileSync(join(import.meta.dir, "message-part.tsx"), "utf8")
    const turn = readFileSync(join(import.meta.dir, "session-turn.tsx"), "utf8")
    expect(part).not.toContain("turnDurationMs")
    expect(turn).not.toContain("turnDurationMs={")
    expect(part).toContain("messageDurationMs(")
  })
})

describe("AC-3 each tool card shows its own call's time", () => {
  test("a finished call's time is its own start-to-end span", () => {
    expect(toolDurationMs({ status: "completed", time: { start: 1_000, end: 13_000 } })).toBe(12_000)
    expect(toolDurationMs({ status: "error", time: { start: 1_000, end: 2_500 } })).toBe(1_500)
  })

  test("running, instant or untimed calls show no time", () => {
    expect(toolDurationMs({ status: "running", time: { start: 1_000 } })).toBeUndefined()
    expect(toolDurationMs({ status: "completed", time: { start: 1_000, end: 1_400 } })).toBeUndefined()
    expect(toolDurationMs({ status: "pending" })).toBeUndefined()
  })
})

describe("AC-23 a thread says when the user stopped computer use", () => {
  test("only the call Stop cut off carries the note", () => {
    const proxy = readFileSync(join(import.meta.dir, "../../../core/src/harness/computer-proxy.ts"), "utf8")
    const stopped = proxy.match(/"(Stopped: the user shut computer use down with Stop[^"]*)"/)?.[1] ?? ""
    expect(stoppedComputerUse({ status: "error", error: stopped })).toBe(true)
    expect(stoppedComputerUse({ status: "error", error: "Computer use was turned off for this Project" })).toBe(false)
    expect(stoppedComputerUse({ status: "running" })).toBe(false)
  })
})
