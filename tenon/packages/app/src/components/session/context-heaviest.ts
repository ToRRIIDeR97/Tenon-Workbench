import type { Message, Part } from "@opencode-ai/sdk/v2/client"

export type HeavyItemKind = "message" | "reply" | "file" | "tool" | "subagent"

export type HeavyItem = {
  key: string
  kind: HeavyItemKind
  name: string
  tokens: number
  turn: number
  turnID: string
}

const estimateTokens = (chars: number) => Math.ceil(chars / 4)
const firstLine = (text: string) => text.trim().split("\n")[0]?.trim() ?? ""

export function heaviestContextItems(args: {
  messages: Message[]
  parts: Record<string, Part[] | undefined>
  limit?: number
}): HeavyItem[] {
  const items: HeavyItem[] = []
  let turn = 0
  let turnID = ""
  for (const message of args.messages) {
    if (message.role === "user") {
      turn += 1
      turnID = message.id
    }
    if (!turnID) continue
    for (const part of args.parts[message.id] ?? []) {
      const item = measure(part, message.role)
      if (item && item.tokens > 0) items.push({ ...item, key: part.id, turn, turnID })
    }
  }
  return items.sort((left, right) => right.tokens - left.tokens).slice(0, args.limit ?? 4)
}

function measure(part: Part, role: Message["role"]): Omit<HeavyItem, "key" | "turn" | "turnID"> | undefined {
  if (part.type === "text")
    return {
      kind: role === "user" ? "message" : "reply",
      name: firstLine(part.text),
      tokens: estimateTokens(part.text.length),
    }
  if (part.type === "file" && role === "user")
    return {
      kind: "file",
      name: part.filename ?? part.url,
      tokens: estimateTokens(part.source?.text.value.length ?? 0),
    }
  if (part.type !== "tool") return
  const state = part.state
  const input = Object.keys(state.input ?? {}).length * 16
  const body =
    state.status === "completed"
      ? state.output.length
      : state.status === "error"
        ? state.error.length
        : state.status === "pending"
          ? state.raw.length
          : 0
  const title = "title" in state && typeof state.title === "string" ? state.title : ""
  const subagent = part.tool === "task" || part.tool === "acp_subagent"
  return {
    kind: subagent ? "subagent" : "tool",
    name: title || part.tool,
    tokens: estimateTokens(input + body),
  }
}
