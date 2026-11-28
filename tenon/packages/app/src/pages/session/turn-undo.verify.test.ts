import { describe, expect, test } from "bun:test"
import { turnUndoPlan, turnUndoSummary } from "./turn-undo"

describe("AC-28 turn undo (verification)", () => {
  test("a file listed twice is planned once, the last diff winning", () => {
    const plan = turnUndoPlan({
      diffs: [
        { file: "a.ts", patch: "first", status: "modified", additions: 1, deletions: 0 },
        { file: "a.ts", patch: "second", status: "modified", additions: 2, deletions: 0 },
      ],
      writes: [],
    })
    expect(plan.files).toEqual([{ file: "a.ts", patch: "second", status: "modified" }])
  })

  test("a diff without a status counts as modified; one without a file is ignored", () => {
    const plan = turnUndoPlan({
      diffs: [
        { file: "x.ts", patch: "p", additions: 1, deletions: 1 },
        { patch: "p", additions: 1, deletions: 1 },
      ],
      writes: [],
    })
    expect(plan.files).toEqual([{ file: "x.ts", patch: "p", status: "modified" }])
  })

  test("writes still in progress or pending undo are not planned", () => {
    const plan = turnUndoPlan({
      diffs: [],
      writes: [
        { id: "a", undo: "u", undoState: "pending", failed: false, phase: "done" },
        { id: "b", undo: "u", undoState: "idle", failed: false, phase: "started" },
      ],
    })
    expect(plan.writes).toEqual([])
    expect(plan.empty).toBe(true)
  })

  test("nothing done sums to zero", () => {
    expect(turnUndoSummary([], [])).toEqual({ reverted: 0, changed: 0, failed: 0 })
  })
})
