import type { AgentRunStatus } from "@/pages/activity-runs"

/** One root thread of a Project (or the workspace's General group) as the Command Centre's board shows it. */
export type BoardThread = {
  id: string
  title: string
  /** Display name of the Project. */
  project: string
  /** Undefined for the workspace's General group. */
  projectID?: string
  /** Last update, in ms. */
  updated: number
  status?: AgentRunStatus
  /** Pending approvals plus pending questions. */
  waiting: number
  subagents: number
  model?: string
}

/** An idle thread stays on the board this long after its last update. */
export const FINISHED_WINDOW_MS = 24 * 60 * 60 * 1000
/** The most a one-line steer sends. */
export const STEER_LIMIT = 4000

export type BoardByState<T extends BoardThread> = { needsYou: T[]; running: T[]; finished: T[] }

/**
 * Sorts threads by what they ask of the user. A thread waiting on the user is under needs you whatever else it
 * does, a running or retrying one is under running, and an idle one is finished while it is recent and left out
 * after that. Each list is newest first (stable on ties); the input is not changed.
 */
export function boardByState<T extends BoardThread>(threads: readonly T[], now: number): BoardByState<T> {
  const running = (thread: BoardThread) => thread.status === "running" || thread.status === "retrying"
  const newest = (list: T[]) => list.toSorted((a, b) => b.updated - a.updated)
  return {
    needsYou: newest(threads.filter((thread) => thread.waiting > 0)),
    running: newest(threads.filter((thread) => thread.waiting <= 0 && running(thread))),
    finished: newest(
      threads.filter((thread) => thread.waiting <= 0 && !running(thread) && now - thread.updated < FINISHED_WINDOW_MS),
    ),
  }
}

/**
 * The threads `boardByState` keeps, grouped by Project: groups by name ignoring case with General last, and
 * inside a group needs you, then running, then finished.
 */
export function boardByProject<T extends BoardThread>(threads: readonly T[], now: number) {
  const kept = boardByState(threads, now)
  const all = [...kept.needsYou, ...kept.running, ...kept.finished]
  const groups = Map.groupBy(all, (thread) => thread.projectID)
  return [...groups.entries()]
    .map(([projectID, items]) => ({ project: items[0].project, projectID, threads: ordered(items, now) }))
    .toSorted(
      (a, b) =>
        Number(a.projectID === undefined) - Number(b.projectID === undefined) ||
        a.project.toLowerCase().localeCompare(b.project.toLowerCase()),
    )
}

/** What a steer sends: trimmed, cut to the limit, and nothing for blank text. */
export function steerText(text: string) {
  const value = text.trim()
  if (!value) return undefined
  return value.slice(0, STEER_LIMIT)
}

function ordered<T extends BoardThread>(threads: readonly T[], now: number) {
  const board = boardByState(threads, now)
  return [...board.needsYou, ...board.running, ...board.finished]
}
