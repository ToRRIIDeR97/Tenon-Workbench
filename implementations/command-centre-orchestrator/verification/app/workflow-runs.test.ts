import { describe, expect, test } from "bun:test"
import {
  applyReports,
  parseReports,
  runSpend,
  stopReason,
  type Report,
  type Run,
} from "../../../../tenon/packages/app/src/features/command-centre/workflow-runs"

const base = (extra: Partial<Run> = {}): Run => ({
  id: "r",
  workflowID: "w",
  sessionID: "root",
  project: "P",
  startedAt: 0,
  maxRounds: 2,
  status: "running",
  rounds: [],
  ...extra,
})
const report = (round: number, role: string, status: Report["status"], summary = "s"): Report => ({
  round,
  role,
  status,
  summary,
})

describe("AC-4.1 boundaries", () => {
  test("AC-4.1 spacing and case inside the brackets do not matter; the summary is trimmed", () => {
    expect(parseReports("[[ROUND 3|  Lead Writer  |DONE]]    Draft ready   ")).toEqual([
      { round: 3, role: "lead writer", status: "done", summary: "Draft ready" },
    ])
  })

  test("AC-4.1 a report can sit mid-line, several per text, with an empty summary", () => {
    const reports = parseReports("ok [[round 1 | a | started]]\n> [[round 1 | b | approved]] fine\n")
    expect(reports.map((item) => [item.role, item.status, item.summary])).toEqual([
      ["a", "started", ""],
      ["b", "approved", "fine"],
    ])
  })

  test("AC-4.1 empty text, round zero and negative rounds give nothing", () => {
    expect(parseReports("")).toEqual([])
    expect(parseReports("[[round 0 | a | done]] x\n[[round -1 | a | done]] y")).toEqual([])
  })
})

describe("AC-4.2 boundaries", () => {
  test("AC-4.2 rounds are ordered by number even when reported out of order", () => {
    const next = applyReports(base(), [report(2, "a", "started"), report(1, "a", "done")])
    expect(next.rounds.map((round) => round.n)).toEqual([1, 2])
  })

  test("AC-4.2 the last report of a role in a round wins, and roles keep first-seen order", () => {
    const next = applyReports(base(), [
      report(1, "impl", "started", "begin"),
      report(1, "rev", "sent-back", "no"),
      report(1, "impl", "done", "end"),
    ])
    expect(next.rounds[0].entries).toEqual([
      { role: "impl", status: "done", summary: "end" },
      { role: "rev", status: "sent-back", summary: "no" },
    ])
  })

  test("AC-4.2 approved outranks sent-back in the same round; no reports leaves the run as it was", () => {
    const mixed = applyReports(base(), [report(1, "rev-a", "sent-back"), report(1, "rev-b", "approved")])
    expect(mixed.rounds[0].outcome).toBe("approved")
    expect(mixed.status).toBe("done")
    const untouched = base()
    expect(applyReports(untouched, [])).toEqual(untouched)
  })

  test("AC-4.2 a stopped or paused run keeps its status even when a round is approved", () => {
    for (const status of ["paused", "stopped", "over-budget", "out-of-rounds"] as const)
      expect(applyReports(base({ status }), [report(1, "rev", "approved")]).status).toBe(status)
  })

  test("AC-4.2 the run passed in is not changed, and later reports extend earlier rounds", () => {
    const first = applyReports(base(), [report(1, "impl", "done")])
    const copy = structuredClone(first)
    const second = applyReports(first, [report(1, "impl", "done"), report(1, "rev", "sent-back"), report(2, "impl", "started")])
    expect(first).toEqual(copy)
    expect(second.rounds.map((round) => [round.n, round.outcome])).toEqual([
      [1, "sent-back"],
      [2, "in-progress"],
    ])
  })
})

describe("AC-4.3 boundaries", () => {
  test("AC-4.3 a root that is not listed costs nothing; missing costs count as zero", () => {
    expect(runSpend([{ id: "x", cost: 4 }], "root")).toBe(0)
    expect(runSpend([{ id: "root" }, { id: "child", parentID: "root" }], "root")).toBe(0)
  })

  test("AC-4.3 deep chains and several children are all counted once", () => {
    const sessions = [
      { id: "root", cost: 1 },
      { id: "a", parentID: "root", cost: 1 },
      { id: "b", parentID: "root", cost: 1 },
      { id: "a1", parentID: "a", cost: 1 },
      { id: "a2", parentID: "a1", cost: 1 },
      { id: "stranger", parentID: "elsewhere", cost: 50 },
    ]
    expect(runSpend(sessions, "root")).toBe(5)
  })

  test("AC-4.3 a parent cycle does not hang or double count", () => {
    const sessions = [
      { id: "root", parentID: "loop", cost: 2 },
      { id: "loop", parentID: "root", cost: 3 },
    ]
    expect(runSpend(sessions, "root")).toBe(5)
  })
})

describe("AC-4.4 boundaries", () => {
  test("AC-4.4 without a budget only the round cap can stop a run", () => {
    expect(stopReason(base(), 1_000_000)).toBeUndefined()
    const atCap = applyReports(base(), [report(2, "impl", "started")])
    expect(stopReason(atCap, 0)).toBeUndefined()
    const pastCap = applyReports(base(), [report(3, "impl", "started")])
    expect(stopReason(pastCap, 0)).toBe("rounds")
  })

  test("AC-4.4 spend above the budget stops it, and finished runs never report a reason", () => {
    expect(stopReason(base({ budgetUSD: 2 }), 2.01)).toBe("budget")
    expect(stopReason(base({ budgetUSD: 2 }), 0)).toBeUndefined()
    for (const status of ["stopped", "over-budget", "out-of-rounds", "done"] as const)
      expect(stopReason(base({ status, budgetUSD: 1 }), 5)).toBeUndefined()
  })
})
