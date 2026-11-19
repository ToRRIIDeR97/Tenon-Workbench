import { describe, expect, test } from "bun:test"
import { commandBriefing } from "./command-briefing"

const now = Date.UTC(2026, 10, 19, 12)
const thread = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  project: "Wickfall",
  updated: now - 60_000,
  waiting: 0,
  subagents: 0,
  ...extra,
})

describe("commandBriefing", () => {
  test("counts running, needs you and finished today, and gives each running thread its checklist step", () => {
    const brief = commandBriefing(
      [
        thread("hand", { status: "running" }),
        thread("plates", { status: "running", waiting: 1 }),
        thread("notes"),
        thread("old", { updated: now - 3 * 24 * 60 * 60 * 1000 }),
      ],
      (id) =>
        id === "hand"
          ? [
              { content: "Measure the hand", status: "completed" },
              { content: "Clamp the width", status: "in_progress" },
              { content: "Run the layout test", status: "pending" },
              { content: "Dropped idea", status: "cancelled" },
            ]
          : undefined,
      now,
    )
    expect(brief.counts).toEqual({ running: 1, needsYou: 1, done: 1 })
    expect(brief.running.map((run) => [run.thread.id, run.step, run.done, run.total])).toEqual([
      ["hand", "Clamp the width", 1, 3],
    ])
  })

  test("a running thread without a checklist has no step", () => {
    const brief = commandBriefing([thread("x", { status: "running" })], () => undefined, now)
    expect(brief.running[0]).toMatchObject({ step: undefined, done: 0, total: 0 })
  })
})
