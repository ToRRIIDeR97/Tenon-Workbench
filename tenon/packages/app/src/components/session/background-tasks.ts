import type { Message, Part, ToolPart } from "@opencode-ai/sdk/v2"
import { isStopped, plainOutput, stepOf } from "@tenon/session-ui/step-kind"
import { isSubagentPart, laneElapsed, subagentRunning, taskSessionID } from "./subagent-lane"
import type { SubagentModel } from "./subagent-list"

export type TaskKind = "agent" | "command"
export type TaskFilter = "all" | TaskKind
export type TaskStatus = "running" | "done" | "failed" | "stopped"

export interface BackgroundTask {
  readonly kind: TaskKind
  readonly part: ToolPart
  readonly turn: number
  readonly harness?: string
  readonly parent?: SubagentModel
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

export const isTerminalTask = (part: ToolPart) =>
  part.tool === "terminal_start" || part.tool.endsWith("_terminal_start")

const kindOf = (part: Part): TaskKind | undefined => {
  if (part.type !== "tool") return undefined
  if (isSubagentPart(part)) return "agent"
  return isTerminalTask(part) || stepOf(part).kind === "run" ? "command" : undefined
}

export function terminalID(part: ToolPart) {
  if (!isTerminalTask(part) || part.state.status !== "completed") return undefined
  return text(part.state.metadata?.terminalId) ?? part.state.output.match(/pty_[A-Za-z0-9]+/)?.[0]
}

export function commandTitle(part: ToolPart) {
  return isTerminalTask(part) ? text(part.state.input?.command) : stepOf(part).target
}

export function threadBackgroundTasks(
  messages: readonly Message[],
  parts: (messageID: string) => readonly Part[] | undefined,
): BackgroundTask[] {
  const turns = new Map<string, number>()
  return messages.flatMap((message) => {
    if (message.role === "user") {
      turns.set(message.id, turns.size + 1)
      return []
    }
    if (turns.size === 0) return []
    const turn = turns.get(message.parentID) ?? turns.size
    const harness = (message as Message & { harnessInstanceID?: string }).harnessInstanceID
    const parent = message.modelID ? { id: message.modelID, reasoning: text(message.variant) } : undefined
    return (parts(message.id) ?? []).flatMap((part) => {
      const kind = kindOf(part)
      return kind ? [{ kind, part: part as ToolPart, turn, harness, parent }] : []
    })
  })
}

export function commandExit(part: ToolPart) {
  const state = part.state as { metadata?: Record<string, unknown>; structured?: Record<string, unknown> }
  return [state.metadata?.exit, state.structured?.exit].find(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  )
}

export function taskStatus(part: ToolPart, live?: ReadonlySet<string>): TaskStatus {
  if (subagentRunning(part)) return "running"
  if (isStopped(part)) return "stopped"
  if (part.state.status === "error") return "failed"
  if (isSubagentPart(part)) return "done"
  if (isTerminalTask(part)) return live?.has(terminalID(part) ?? "") ? "running" : "done"
  return (commandExit(part) ?? 0) === 0 ? "done" : "failed"
}

export function taskElapsed(part: ToolPart, now: number, live?: ReadonlySet<string>) {
  if (!isTerminalTask(part) || part.state.status !== "completed") return laneElapsed(part, now)
  if (taskStatus(part, live) !== "running") return undefined
  return Math.max(0, now - part.state.time.start)
}

const endedAt = (part: ToolPart) => {
  const time = "time" in part.state ? (part.state.time as { start: number; end?: number }) : undefined
  return time?.end ?? time?.start ?? 0
}

export function taskSections(tasks: readonly BackgroundTask[], filter: TaskFilter, live?: ReadonlySet<string>) {
  const shown = tasks.filter((task) => filter === "all" || task.kind === filter)
  return {
    running: shown.filter((task) => taskStatus(task.part, live) === "running").reverse(),
    finished: shown
      .map((task, index) => ({ task, index }))
      .filter((item) => taskStatus(item.task.part, live) !== "running")
      .sort((a, b) => endedAt(b.task.part) - endedAt(a.task.part) || b.index - a.index)
      .map((item) => item.task),
  }
}

export function taskCounts(tasks: readonly BackgroundTask[], live?: ReadonlySet<string>) {
  return {
    all: tasks.length,
    agent: tasks.filter((task) => task.kind === "agent").length,
    command: tasks.filter((task) => task.kind === "command").length,
    running: tasks.filter((task) => taskStatus(task.part, live) === "running").length,
  }
}

export function findTask(tasks: readonly BackgroundTask[], partID: string | undefined) {
  if (!partID) return undefined
  return tasks.find((task) => task.part.id === partID)
}

export function commandOutput(part: ToolPart) {
  const state = part.state
  const streamed = "metadata" in state && typeof state.metadata?.output === "string" ? state.metadata.output : ""
  if (state.status === "error") return plainOutput(state.error || streamed)
  if (state.status === "completed") return plainOutput(state.output || streamed)
  return plainOutput(streamed)
}

export function lastOutputLine(output: string) {
  return output.split("\n").findLast((line) => line.trim().length > 0)
}

export function stopTarget(
  task: Pick<BackgroundTask, "kind" | "part">,
  threadSessionID: string | undefined,
  live?: ReadonlySet<string>,
) {
  if (taskStatus(task.part, live) !== "running") return undefined
  const terminal = terminalID(task.part)
  if (terminal) return { terminalID: terminal, scope: "terminal" as const }
  const child = taskSessionID(task.part)
  if (child) return { sessionID: child, scope: "task" as const }
  return threadSessionID ? { sessionID: threadSessionID, scope: "turn" as const } : undefined
}
