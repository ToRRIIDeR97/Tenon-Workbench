import type { Message, Part, ToolPart } from "@opencode-ai/sdk/v2"
import type { SubagentTranscriptEntry } from "./subagent-detail"
import { isSubagentPart, subagentRunning } from "./subagent-lane"
import { stepOf } from "@tenon/session-ui/step-kind"

export interface ThreadSubagent {
  readonly part: ToolPart
  readonly harness?: string
  readonly parent?: SubagentModel
}

export interface SubagentModel {
  readonly id: string
  readonly reasoning?: string
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

export function subagentModel(
  item: ThreadSubagent,
  child?: { readonly modelID?: string; readonly variant?: string },
): SubagentModel | undefined {
  const input = item.part.state.input as Record<string, unknown> | undefined
  const reasoning = text(input?.reasoning_effort) ?? text(input?.reasoningEffort) ?? text(input?.effort)
  const asked = text(input?.model)
  if (asked)
    return { id: asked, reasoning: reasoning ?? (asked === item.parent?.id ? item.parent.reasoning : undefined) }
  const own = text(child?.modelID)
  if (own) return { id: own, reasoning: reasoning ?? text(child?.variant) }
  return item.parent ? { id: item.parent.id, reasoning: reasoning ?? item.parent.reasoning } : undefined
}

export function subagentModelLabel(model: SubagentModel | undefined) {
  if (!model) return undefined
  const id = model.id.split("/").at(-1) || model.id
  return model.reasoning ? `${id} · ${model.reasoning}` : id
}

export interface SubagentGroup {
  readonly turn: number
  readonly userMessageID: string
  readonly createdAt?: number
  readonly items: ThreadSubagent[]
}

export const subagentFailed = (part: ToolPart) => part.state.status === "error"

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
    const parent =
      message.role === "assistant" && message.modelID
        ? { id: message.modelID, reasoning: text(message.variant) }
        : undefined
    for (const part of parts(message.id) ?? []) {
      if (isSubagentPart(part)) group.items.push({ part, harness, parent })
    }
  }
  return groups.filter((group) => group.items.length > 0).reverse()
}

export function subagentCounts(groups: readonly SubagentGroup[]) {
  const all = groups.flatMap((group) => group.items)
  return {
    all: all.length,
    running: all.filter((item) => subagentRunning(item.part)).length,
    failed: all.filter((item) => subagentFailed(item.part)).length,
  }
}

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

export function taskResult(output: string) {
  const match = output.match(/<task_(?:result|error)>\n?([\s\S]*?)\n?<\/task_(?:result|error)>/)
  return (match ? match[1] : output).trim() || undefined
}

export function splitResult(entries: readonly SubagentTranscriptEntry[], finished: boolean) {
  const last = entries.at(-1)
  if (!finished || last?.type !== "text") return { steps: [...entries], result: undefined }
  return { steps: entries.slice(0, -1), result: last.text }
}
