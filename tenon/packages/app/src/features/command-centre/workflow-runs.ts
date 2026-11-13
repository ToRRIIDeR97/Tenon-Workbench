/**
 * What a started workflow run has reported so far, and when it must stop. Pure: the run tracker
 * (`workflow-tracker.ts`) feeds it the director thread's text and the synced thread costs, and the run view draws
 * the result. A director reports on lines shaped `[[round N | role | status]] summary` (see `directorBrief`).
 */
import { REPORT_STATUSES } from "./workflows"

export type ReportStatus = (typeof REPORT_STATUSES)[number]

export type Report = { round: number; role: string; status: ReportStatus; summary: string }

export type RoundEntry = { role: string; status: ReportStatus; summary: string }

export type Round = {
  n: number
  entries: RoundEntry[]
  outcome: "in-progress" | "sent-back" | "approved"
}

export type RunStatus = "running" | "paused" | "stopped" | "done" | "over-budget" | "out-of-rounds"

export type Run = {
  id: string
  workflowID: string
  /** The director thread. */
  sessionID: string
  /** The Project's ID. */
  project: string
  startedAt: number
  maxRounds: number
  budgetUSD?: number
  status: RunStatus
  rounds: Round[]
}

/** What Resume sends a paused director. It is an instruction to an agent, not UI text, so it stays English. */
export const RESUME_TEXT =
  "The run was paused. Carry on from where you stopped: finish the current step, keep reporting each step as [[round N | role | status]] summary, and follow the same rules."

const REPORT_LINE = /\[\[\s*round\s+(\d+)\s*\|([^|\]]*)\|([^|\]]*)\]\]([^\n]*)/gi

/** Every well-formed report line in `text`, in order. Malformed lines and unknown statuses are skipped. */
export function parseReports(text: string): Report[] {
  return Array.from(text.matchAll(REPORT_LINE)).flatMap((match) => {
    const round = Number(match[1])
    const role = match[2].trim().toLowerCase()
    const status = REPORT_STATUSES.find((item) => item === match[3].trim().toLowerCase())
    if (!Number.isSafeInteger(round) || round < 1 || !role || !status) return []
    return [{ round, role, status, summary: match[4].trim() }]
  })
}

/**
 * `run` with `reports` merged into its rounds. The run passed in is not changed. A running run whose round was
 * approved is done; a run in any other status keeps it.
 */
export function applyReports(run: Run, reports: ReadonlyArray<Report>): Run {
  const rounds = new Map(run.rounds.map((round) => [round.n, round.entries.map((entry) => ({ ...entry }))] as const))
  reports.forEach((report) => {
    const entries = rounds.get(report.round) ?? []
    rounds.set(report.round, entries)
    const entry = { role: report.role, status: report.status, summary: report.summary }
    const index = entries.findIndex((item) => item.role === report.role)
    if (index === -1) entries.push(entry)
    if (index !== -1) entries[index] = entry
  })
  const next = Array.from(rounds, ([n, entries]): Round => ({ n, entries, outcome: outcome(entries) })).sort(
    (left, right) => left.n - right.n,
  )
  const approved = next.some((round) => round.outcome === "approved")
  return { ...run, rounds: next, status: run.status === "running" && approved ? "done" : run.status }
}

function outcome(entries: ReadonlyArray<RoundEntry>): Round["outcome"] {
  if (entries.some((entry) => entry.status === "approved")) return "approved"
  if (entries.some((entry) => entry.status === "sent-back")) return "sent-back"
  return "in-progress"
}

/**
 * What the thread `rootID` and every thread under it (by `parentID`) have cost. Unrelated threads, missing costs and
 * parent cycles add nothing, and a root that is not listed costs 0.
 */
export function runSpend(sessions: ReadonlyArray<{ id: string; parentID?: string; cost?: number }>, rootID: string) {
  const children = new Map<string, string[]>()
  const costs = new Map<string, number>()
  sessions.forEach((session) => {
    if (costs.has(session.id)) return
    costs.set(session.id, typeof session.cost === "number" && Number.isFinite(session.cost) ? session.cost : 0)
    if (session.parentID) children.set(session.parentID, [...(children.get(session.parentID) ?? []), session.id])
  })
  const seen = new Set<string>()
  const queue = [rootID]
  let total = 0
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (seen.has(id)) continue
    seen.add(id)
    total += costs.get(id) ?? 0
    queue.push(...(children.get(id) ?? []))
  }
  return total
}

/** Why a running run must stop now: its budget is spent (that wins), or a round past its cap was reported. */
export function stopReason(run: Run, spend: number): "budget" | "rounds" | undefined {
  if (run.status !== "running") return undefined
  if (run.budgetUSD !== undefined && spend >= run.budgetUSD) return "budget"
  if (run.rounds.some((round) => round.n > run.maxRounds)) return "rounds"
  return undefined
}
