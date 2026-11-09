import type { Message, Part, ToolPart } from "@opencode-ai/sdk/v2"
import type { SubagentTranscriptEntry } from "./subagent-detail"
import { isSubagentPart, subagentRunning } from "./subagent-lane"
import { stepOf } from "@tenon/session-ui/step-kind"

export interface ThreadSubagent {
  readonly part: ToolPart
  /** The harness instance that ran the assistant message holding the part. */
  readonly harness?: string
}

export interface SubagentGroup {
  /** 1-based position of the user turn that started these subagents. */
  readonly turn: number
  readonly userMessageID: string
  readonly createdAt?: number
  readonly items: ThreadSubagent[]
}

export type SubagentFilter = "all" | "running" | "failed"

export const subagentFailed = (part: ToolPart) => part.state.status === "error"

export function matchesFilter(part: ToolPart, filter: SubagentFilter) {
  if (filter === "running") return subagentRunning(part)
  if (filter === "failed") return subagentFailed(part)
  return true
}

/**
 * Every subagent call in the thread (built-in `task` and harness `acp_subagent`), grouped by the user turn that
 * started it, newest turn first. Turns without subagents are left out.
 */
export function threadSubagents(
  messages: readonly Message[],
  parts: (messageID: string) => readonly Part[] | undefined,
): SubagentGroup[] {
  const groups: { turn: number; userMessageID: string; createdAt?: number; items: ThreadSubagent[] }[] = []
  const byUser = new Map<string, (typeof groups)[number]>()
  for (const message of messages) {
    if (message.role === "user") {
      const group = { turn: groups.length + 1, userMessageID: message.id, createdAt: message.time.created, items: [] }
      groups.push(group)
      byUser.set(message.id, group)
      continue
    }
    const group = byUser.get(message.parentID) ?? groups.at(-1)
    if (!group) continue
    const harness = (message as Message & { harnessInstanceID?: string }).harnessInstanceID
    for (const part of parts(message.id) ?? []) {
      if (isSubagentPart(part)) group.items.push({ part, harness })
    }
  }
  return groups.filter((group) => group.items.length > 0).reverse()
}

/** How many subagents match each filter, for the filter pills and the tab's running badge. */
export function subagentCounts(groups: readonly SubagentGroup[]) {
  const all = groups.flatMap((group) => group.items)
  return {
    all: all.length,
    running: all.filter((item) => subagentRunning(item.part)).length,
    failed: all.filter((item) => subagentFailed(item.part)).length,
  }
}

export function findSubagent(groups: readonly SubagentGroup[], partID: string | undefined) {
  if (!partID) return undefined
  for (const group of groups) {
    const found = group.items.find((item) => item.part.id === partID)
    if (found) return found
  }
  return undefined
}

/** A `task` agent's child session as transcript entries: its text, reasoning and tool calls in order. */
export function childTranscript(
  messages: readonly Message[],
  parts: (messageID: string) => readonly Part[] | undefined,
): SubagentTranscriptEntry[] {
  return messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => parts(message.id) ?? [])
    .flatMap((part): SubagentTranscriptEntry[] => {
      if ((part.type === "text" || part.type === "reasoning") && part.text.trim())
        return [{ type: part.type, text: part.text }]
      if (part.type !== "tool") return []
      const state = part.state
      const output = state.status === "completed" ? state.output : state.status === "error" ? state.error : undefined
      return [
        {
          type: "tool",
          tool: part.tool,
          status: state.status,
          ...(stepOf(part).target ? { title: stepOf(part).target } : {}),
          ...(output ? { output: output.slice(0, 20_000) } : {}),
        },
      ]
    })
}

/** The text a `task` tool returned, without the `<task>` wrapper the tool adds for the parent agent. */
export function taskResult(output: string) {
  const match = output.match(/<task_(?:result|error)>\n?([\s\S]*?)\n?<\/task_(?:result|error)>/)
  return (match ? match[1] : output).trim() || undefined
}

/**
 * Splits a finished agent's transcript into its steps and its final message: the last text entry when the agent
 * ended on one. A running agent's text is still in progress, so it stays a step.
 */
export function splitResult(entries: readonly SubagentTranscriptEntry[], finished: boolean) {
  const last = entries.at(-1)
  if (!finished || last?.type !== "text") return { steps: [...entries], result: undefined }
  return { steps: entries.slice(0, -1), result: last.text }
}
