import type { ToolPart } from "@opencode-ai/sdk/v2"
import { subagentDetail } from "./subagent-detail"
import type { SubagentGroup } from "./subagent-list"

export type SubagentContext = {
  id: string
  sessionID: string
  turn: number
  turnID: string
  status: ToolPart["state"]["status"]
  input: Record<string, unknown>
  childID?: string
  seconds?: number
  context?: { used: number; size?: number; percent?: number }
  estimate?: number
  usage: { input?: number; output?: number; reasoning?: number; cacheRead?: number; cost?: number }
}

type ChildSession = {
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number } }
  cost?: number
}

export function subagentContexts(
  groups: readonly SubagentGroup[],
  child: (sessionID: string) => ChildSession | undefined,
) {
  return groups.flatMap((group) =>
    group.items.map(({ part }): SubagentContext => {
      const state = part.state
      const time = "time" in state ? (state.time as { start?: number; end?: number }) : undefined
      const seconds =
        time?.start !== undefined && time.end !== undefined
          ? Math.max(0, Math.round((time.end - time.start) / 1000))
          : undefined
      const base = {
        id: part.id,
        sessionID: part.sessionID,
        turn: group.turn,
        turnID: group.userMessageID,
        status: state.status,
        input: (state.input ?? {}) as Record<string, unknown>,
        seconds,
      }
      if (part.tool === "acp_subagent") {
        const detail = subagentDetail(part)
        const chars =
          (detail.prompt?.length ?? 0) +
          detail.transcript.reduce(
            (total, entry) =>
              total +
              (entry.type === "tool" ? (entry.title?.length ?? 0) + (entry.output?.length ?? 0) : entry.text.length),
            0,
          )
        return {
          ...base,
          context: detail.context,
          usage: detail.usage,
          ...(detail.context || detail.usage.input !== undefined || chars === 0
            ? {}
            : { estimate: Math.ceil(chars / 4) }),
        }
      }
      const metadata = ("metadata" in state ? state.metadata : undefined) ?? {}
      const session = typeof metadata.sessionId === "string" ? child(metadata.sessionId) : undefined
      return {
        ...base,
        childID: typeof metadata.sessionId === "string" ? metadata.sessionId : undefined,
        usage: session?.tokens
          ? {
              input: session.tokens.input,
              output: session.tokens.output,
              reasoning: session.tokens.reasoning,
              cacheRead: session.tokens.cache.read,
              cost: session.cost,
            }
          : {},
      }
    }),
  )
}

export function subagentBar(row: SubagentContext, rows: readonly SubagentContext[]) {
  const size = (item: SubagentContext) =>
    item.context?.used ?? (item.estimate || (item.usage.input ?? 0) + (item.usage.cacheRead ?? 0))
  const largest = Math.max(0, ...rows.map(size))
  return largest > 0 ? (size(row) / largest) * 100 : 0
}
