import type { AgentRunStatus } from "@/pages/activity-runs"

export type BoardThread = {
  id: string
  title: string
  project: string
  projectID?: string
  updated: number
  status?: AgentRunStatus
  waiting: number
  subagents: number
  model?: string
}

export const FINISHED_WINDOW_MS = 24 * 60 * 60 * 1000
export const STEER_LIMIT = 4000

export type BoardByState<T extends BoardThread> = { needsYou: T[]; running: T[]; finished: T[] }

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

export function steerText(text: string) {
  const value = text.trim()
  if (!value) return undefined
  return value.slice(0, STEER_LIMIT)
}

function ordered<T extends BoardThread>(threads: readonly T[], now: number) {
  const board = boardByState(threads, now)
  return [...board.needsYou, ...board.running, ...board.finished]
}
