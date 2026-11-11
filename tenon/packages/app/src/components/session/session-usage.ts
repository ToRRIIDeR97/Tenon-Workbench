import type { AssistantMessage, Message, Part, Session, ToolPart } from "@opencode-ai/sdk/v2/client"
import { Harness } from "@tenon/schema/harness"
import { subagentDetail } from "./subagent-detail"

type Tokens = NonNullable<Session["tokens"]>

/** The latest turn's totals: every assistant message since the last user message. */
export function getTurnUsage(messages: Message[]) {
  const start = messages.findLastIndex((message) => message.role === "user")
  return getSessionUsage(messages.slice(start + 1))
}

// Sums the loaded assistant messages, optionally for one harness. Unlike getSessionContext, which reads the
// last message, this adds every message; a thread that hasn't loaded its whole history sums only part of it.
export function getSessionUsage(messages: Message[], options?: { harness?: string }) {
  const counted = messages.filter(
    (message): message is AssistantMessage =>
      message.role === "assistant" &&
      (!options?.harness ||
        ((message as AssistantMessage & { harnessInstanceID?: string }).harnessInstanceID ?? Harness.OpenCode) ===
          options.harness),
  )
  const sum = (pick: (message: AssistantMessage) => number) =>
    counted.reduce((total, message) => total + pick(message), 0)
  // A cost of 0 (or a missing field) means the harness did not report one.
  const reported = counted.filter((message) => typeof message.cost === "number" && message.cost > 0)
  return usageOf(
    {
      input: sum((message) => message.tokens.input),
      output: sum((message) => message.tokens.output),
      reasoning: sum((message) => message.tokens.reasoning),
      cache: {
        read: sum((message) => message.tokens.cache.read),
        write: sum((message) => message.tokens.cache.write),
      },
    },
    reported.length > 0 ? reported.reduce((total, message) => total + message.cost, 0) : undefined,
  )
}

/**
 * Whole-session totals from the session info the server keeps up to date; the loaded messages' sum only when the
 * info carries none.
 */
export function getSessionTotals(info: Pick<Session, "tokens" | "cost"> | undefined, messages: Message[]) {
  if (!info?.tokens) return getSessionUsage(messages)
  return usageOf(info.tokens, info.cost && info.cost > 0 ? info.cost : getSessionUsage(messages).cost)
}

/**
 * What the thread's subagents spent, apart from the parent's context: each ACP subagent's reported usage, plus a
 * built-in `task` child session's totals when its session info is already in the client's cache. `missing` counts
 * the `task` children whose totals aren't loaded, so they're left out.
 */
export function getSubagentUsage(
  messages: Message[],
  parts: (messageID: string) => Part[],
  child: (sessionID: string) => Pick<Session, "tokens" | "cost"> | undefined,
) {
  const tools = messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => parts(message.id))
    .filter((part): part is ToolPart => part.type === "tool" && (part.tool === "acp_subagent" || part.tool === "task"))
  const acp = tools
    .filter((part) => part.tool === "acp_subagent")
    .map((part) => subagentDetail(part).usage)
    .filter((usage) => Object.values(usage).some((value) => value !== undefined))
    .map((usage) => ({
      tokens: {
        input: usage.input ?? 0,
        output: usage.output ?? 0,
        reasoning: usage.reasoning ?? 0,
        cache: { read: usage.cacheRead ?? 0, write: usage.cacheWrite ?? 0 },
      },
      cost: usage.cost,
    }))
  const children = tools
    .filter((part) => part.tool === "task")
    .map((part) => {
      const metadata = ("metadata" in part.state ? part.state.metadata : undefined) ?? {}
      return typeof metadata.sessionId === "string" ? child(metadata.sessionId) : undefined
    })
  const task = children.flatMap((info) => (info?.tokens ? [{ tokens: info.tokens, cost: info.cost }] : []))
  const all = [...acp, ...task]
  if (all.length === 0 && children.length === 0) return undefined
  const sum = (pick: (item: (typeof all)[number]) => number) => all.reduce((total, item) => total + pick(item), 0)
  const costs = all.flatMap((item) => (item.cost && item.cost > 0 ? [item.cost] : []))
  return {
    ...usageOf(
      {
        input: sum((item) => item.tokens.input),
        output: sum((item) => item.tokens.output),
        reasoning: sum((item) => item.tokens.reasoning),
        cache: { read: sum((item) => item.tokens.cache.read), write: sum((item) => item.tokens.cache.write) },
      },
      costs.length > 0 ? costs.reduce((total, cost) => total + cost, 0) : undefined,
    ),
    count: all.length,
    missing: children.length - task.length,
  }
}

function usageOf(tokens: Tokens, cost: number | undefined) {
  const inputSide = tokens.input + tokens.cache.read + tokens.cache.write
  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cacheRead: tokens.cache.read,
    cacheWrite: tokens.cache.write,
    cacheHit: inputSide > 0 ? tokens.cache.read / inputSide : undefined,
    total: inputSide + tokens.output + tokens.reasoning,
    cost,
  }
}

/**
 * The latest turn's subagents with the context each one is using, for the context menu's per-agent list. An ACP
 * subagent's figure is what its harness reported; a `task` agent's comes from its child session's last step.
 * `used` is undefined when nothing was reported.
 */
export function latestSubagentContexts(
  messages: Message[],
  parts: (messageID: string) => Part[],
  childContext: (sessionID: string) => { used: number; size?: number } | undefined,
) {
  const start = messages.findLastIndex((message) => message.role === "user")
  return messages
    .slice(start + 1)
    .filter((message) => message.role === "assistant")
    .flatMap((message) => parts(message.id))
    .filter((part): part is ToolPart => part.type === "tool" && (part.tool === "acp_subagent" || part.tool === "task"))
    .map((part) => {
      const input = part.state.input ?? {}
      const name =
        (typeof input.description === "string" && input.description) ||
        (typeof input.subagent_type === "string" && input.subagent_type) ||
        undefined
      const running = part.state.status === "pending" || part.state.status === "running"
      const metadata = ("metadata" in part.state ? part.state.metadata : undefined) ?? {}
      const context =
        part.tool === "acp_subagent"
          ? subagentDetail(part).context
          : typeof metadata.sessionId === "string"
            ? childContext(metadata.sessionId)
            : undefined
      return { id: part.id, name, running, used: context?.used, size: context?.size }
    })
}
