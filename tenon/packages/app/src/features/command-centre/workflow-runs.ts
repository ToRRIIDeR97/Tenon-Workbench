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
  sessionID: string
  project: string
  startedAt: number
  maxRounds: number
  budgetUSD?: number
  status: RunStatus
  rounds: Round[]
}

export const RESUME_TEXT =
  "The run was paused. Carry on from where you stopped: finish the current step, keep reporting each step as [[round N | role | status]] summary, and follow the same rules."

const REPORT_LINE = /\[\[\s*round\s+(\d+)\s*\|([^|\]]*)\|([^|\]]*)\]\]([^\n]*)/gi

export function parseReports(text: string): Report[] {
  return Array.from(text.matchAll(REPORT_LINE)).flatMap((match) => {
    const round = Number(match[1])
    const role = match[2].trim().toLowerCase()
    const status = REPORT_STATUSES.find((item) => item === match[3].trim().toLowerCase())
    if (!Number.isSafeInteger(round) || round < 1 || !role || !status) return []
    return [{ round, role, status, summary: match[4].trim() }]
  })
}

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

type Priced = { id: string; parentID?: string; cost?: number }

export function runThreads(sessions: ReadonlyArray<Pick<Priced, "id" | "parentID">>, rootID: string) {
  const children = new Map<string, string[]>()
  sessions.forEach((session) => {
    if (session.parentID) children.set(session.parentID, [...(children.get(session.parentID) ?? []), session.id])
  })
  const seen = new Set<string>()
  const queue = [rootID]
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (seen.has(id)) continue
    seen.add(id)
    queue.push(...(children.get(id) ?? []))
  }
  return Array.from(seen)
}

export function runSpend(sessions: ReadonlyArray<Priced>, rootID: string) {
  const costs = new Map<string, number>()
  sessions.forEach((session) => {
    if (costs.has(session.id)) return
    costs.set(session.id, typeof session.cost === "number" && Number.isFinite(session.cost) ? session.cost : 0)
  })
  return runThreads(sessions, rootID).reduce((total, id) => total + (costs.get(id) ?? 0), 0)
}

export function stopReason(run: Run, spend: number): "budget" | "rounds" | undefined {
  if (run.status !== "running") return undefined
  if (run.budgetUSD !== undefined && spend >= run.budgetUSD) return "budget"
  if (run.rounds.some((round) => round.n > run.maxRounds)) return "rounds"
  return undefined
}
