import { describe, expect, test } from "bun:test"
import {
  applyReports,
  parseReports,
  runSpend,
  stopReason,
  type Run,
} from "../../../../tenon/packages/app/src/features/command-centre/workflow-runs"

const run = (extra: Partial<Run> = {}): Run => ({
  id: "run_1",
  workflowID: "build-review",
  sessionID: "ses_director",
  project: "Tenon",
  startedAt: 1,
  maxRounds: 5,
  budgetUSD: 5,
  status: "running",
  rounds: [],
  ...extra,
})

describe("AC-4.1 reading reports", () => {
  test("AC-4.1 reads report lines out of the director's text", () => {
    const text = [
      "Starting the work.",
      "[[round 1 | implementor | started]] Changing the tab model",
      "Some prose in between.",
      "[[round 1 | Reviewer | sent-back]] Missing a test for the empty list",
    ].join("\n")
    expect(parseReports(text)).toEqual([
      { round: 1, role: "implementor", status: "started", summary: "Changing the tab model" },
      { round: 1, role: "reviewer", status: "sent-back", summary: "Missing a test for the empty list" },
    ])
  })

  test("AC-4.1 skips malformed lines and unknown statuses", () => {
    const text = "[[round x | reviewer | approved]] no\n[[round 2 | reviewer | maybe]] no\n[[round 2 | reviewer]] no"
    expect(parseReports(text)).toEqual([])
  })
})

describe("AC-4.2 applying reports", () => {
  const reports = parseReports(
    [
      "[[round 1 | implementor | done]] Changed 9 files",
      "[[round 1 | reviewer | sent-back]] Crash on thread switch",
      "[[round 2 | implementor | started]] Fixing the crash",
    ].join("\n"),
  )

  test("AC-4.2 builds rounds with an outcome each", () => {
    const next = applyReports(run(), reports)
    expect(next.rounds.map((round) => [round.n, round.outcome])).toEqual([
      [1, "sent-back"],
      [2, "in-progress"],
    ])
    expect(next.rounds[0].entries.map((entry) => entry.role)).toEqual(["implementor", "reviewer"])
    expect(next.status).toBe("running")
  })

  test("AC-4.2 an approved round finishes the run, and applying twice changes nothing", () => {
    const approved = [...reports, ...parseReports("[[round 2 | reviewer | approved]] Looks right")]
    const once = applyReports(run(), approved)
    expect(once.rounds[1].outcome).toBe("approved")
    expect(once.status).toBe("done")
    expect(applyReports(once, approved)).toEqual(once)
  })
})

describe("AC-4.3 spend", () => {
  test("AC-4.3 adds the director thread and everything under it", () => {
    const sessions = [
      { id: "ses_director", cost: 0.5 },
      { id: "ses_impl", parentID: "ses_director", cost: 1.25 },
      { id: "ses_sub", parentID: "ses_impl", cost: 0.25 },
      { id: "ses_other", cost: 9 },
    ]
    expect(runSpend(sessions, "ses_director")).toBeCloseTo(2)
  })
})

describe("AC-4.4 stop reason", () => {
  test("AC-4.4 stops at the budget and past the round cap", () => {
    expect(stopReason(run(), 4.99)).toBeUndefined()
    expect(stopReason(run(), 5)).toBe("budget")
    const sixth = applyReports(run(), parseReports("[[round 6 | implementor | started]] again"))
    expect(stopReason(sixth, 1)).toBe("rounds")
    expect(stopReason(sixth, 5)).toBe("budget")
  })

  test("AC-4.4 a run that is not running has no stop reason", () => {
    expect(stopReason(run({ status: "paused" }), 100)).toBeUndefined()
    expect(stopReason(run({ status: "done" }), 100)).toBeUndefined()
  })
})
