import { boardByState, type BoardThread } from "./mission-board"

type Todo = { content: string; status: string }

export type BriefingRun<T extends BoardThread> = {
  thread: T
  /** The checklist step in progress, when the thread keeps one. */
  step?: string
  done: number
  total: number
}

/** How many running rows the Ctrl+J card lists before "N more". */
export const BRIEFING_RUNNING = 2

/**
 * What the Ctrl+J card briefs: the board's counts (running, needs you, finished today) and the running threads
 * newest first, each with its checklist progress when it keeps one.
 */
export function commandBriefing<T extends BoardThread>(
  threads: readonly T[],
  todos: (sessionID: string) => readonly Todo[] | undefined,
  now: number,
) {
  const board = boardByState(threads, now)
  return {
    counts: { running: board.running.length, needsYou: board.needsYou.length, done: board.finished.length },
    running: board.running.map((thread): BriefingRun<T> => {
      const list = todos(thread.id) ?? []
      return {
        thread,
        step: list.find((todo) => todo.status === "in_progress")?.content,
        done: list.filter((todo) => todo.status === "completed").length,
        total: list.filter((todo) => todo.status !== "cancelled").length,
      }
    }),
  }
}
