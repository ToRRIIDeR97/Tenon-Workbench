import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { estimateSessionContextBreakdown } from "./session-context-breakdown"

export type ContextPartKey = "system" | "messages" | "tools" | "other" | "free"

export function contextBreakdown(args: {
  messages: Message[]
  parts: Record<string, Part[] | undefined>
  used: number
  limit: number | undefined
}): { key: ContextPartKey; tokens: number; percent: number }[] {
  if (!args.used || !args.limit) return []
  const system = args.messages.findLast(
    (message): message is Message & { system?: string } =>
      message.role === "user" && typeof (message as { system?: unknown }).system === "string",
  )?.system
  const segments = estimateSessionContextBreakdown({
    messages: args.messages,
    parts: args.parts,
    input: args.used,
    systemPrompt: system?.trim() || undefined,
  })
  const sum = (keys: string[]) =>
    segments.filter((segment) => keys.includes(segment.key)).reduce((total, segment) => total + segment.tokens, 0)
  const parts: { key: ContextPartKey; tokens: number }[] = [
    { key: "system", tokens: sum(["system"]) },
    { key: "messages", tokens: sum(["user", "assistant"]) },
    { key: "tools", tokens: sum(["tool"]) },
    { key: "other", tokens: sum(["other"]) },
    { key: "free", tokens: Math.max(0, args.limit - args.used) },
  ]
  return parts
    .filter((part) => part.tokens > 0)
    .map((part) => ({ ...part, percent: (part.tokens / args.limit!) * 100 }))
}
