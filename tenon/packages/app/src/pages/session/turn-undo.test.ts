import { describe, expect, test } from "bun:test"
import { turnUndoPlan, turnUndoSummary } from "./turn-undo"

const write = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  undo: `undo-${id}`,
  undoState: "idle" as const,
  failed: false,
  phase: "done" as const,
  ...extra,
})

describe("AC-28 turnUndoPlan", () => {
  test("collects the turn's file changes with patches and its undoable writes", () => {
    const plan = turnUndoPlan({
      diffs: [
        { file: "a.ts", patch: "p-a", status: "modified", additions: 1, deletions: 1 },
        { file: "b.ts", status: "added", additions: 3, deletions: 0 },
        { file: "c.ts", patch: "p-c", status: "deleted", additions: 0, deletions: 2 },
      ],
      writes: [
        write("w1"),
        write("w2", { undo: undefined }),
        write("w3", { undoState: "undone" }),
        write("w4", { failed: true }),
      ],
    })
    expect(plan.files).toEqual([
      { file: "a.ts", patch: "p-a", status: "modified" },
      { file: "c.ts", patch: "p-c", status: "deleted" },
    ])
    expect(plan.skipped).toEqual(["b.ts"])
    expect(plan.writes).toEqual(["w1"])
    expect(plan.empty).toBe(false)
  })

  test("a turn with nothing to undo is empty", () => {
    expect(turnUndoPlan({ diffs: [], writes: [] }).empty).toBe(true)
  })
})

describe("AC-28 turnUndoSummary", () => {
  test("counts reverted, changed and failed across files and writes", () => {
    expect(
      turnUndoSummary(
        [
          { file: "a", result: "reverted" },
          { file: "b", result: "changed" },
        ],
        ["undone", "failed", "changed"],
      ),
    ).toEqual({ reverted: 2, changed: 2, failed: 1 })
  })
})
