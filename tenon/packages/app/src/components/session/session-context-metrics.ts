import type { AssistantMessage, Message, Part } from "@opencode-ai/sdk/v2/client"
import { Harness } from "@tenon/schema/harness"

type HarnessAssistant = AssistantMessage & { harnessInstanceID?: string; contextWindow?: number; contextUsed?: number }

type Provider = {
  id: string
  name?: string
  models: Record<string, Model | undefined>
}

type Model = {
  name?: string
  limit: {
    context: number
  }
}

type Context = {
  message: AssistantMessage
  provider?: Provider
  model?: Model
  providerLabel: string
  modelLabel: string
  limit: number | undefined
  input: number
  total: number
  usage: number | null
  compacted: boolean
  reported: boolean
}

export type ContextReadout =
  | { kind: "none" }
  | { kind: "compacted" }
  | { kind: "unreported"; tokens: number }
  | { kind: "tokens"; tokens: number }
  | { kind: "share"; tokens: number; limit: number; percent: number }

export function contextReadout(
  context: Pick<Context, "total" | "limit" | "usage" | "reported" | "compacted"> | undefined,
): ContextReadout {
  if (!context) return { kind: "none" }
  if (context.compacted) return { kind: "compacted" }
  if (context.total <= 0) return { kind: "none" }
  if (!context.reported) return { kind: "unreported", tokens: context.total }
  if (!context.limit || context.usage === null) return { kind: "tokens", tokens: context.total }
  return { kind: "share", tokens: context.total, limit: context.limit, percent: context.usage }
}

const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

const harnessID = (message: AssistantMessage) => (message as HarnessAssistant).harnessInstanceID ?? Harness.OpenCode

export const getSessionHarnesses = (messages: Message[] = []) =>
  [
    ...new Set(messages.flatMap((message) => (message.role === "assistant" ? [harnessID(message)] : [])).reverse()),
  ].reverse()

const lastAssistantWithTokens = (messages: Message[], selectedHarness?: string) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (msg.summary) continue
    if (selectedHarness && harnessID(msg) !== selectedHarness) continue
    if (tokenTotal(msg) <= 0 && ((msg as HarnessAssistant).contextUsed ?? 0) <= 0) continue
    return msg
  }
}

const build = (
  messages: Message[],
  providers: Provider[],
  selectedHarness?: string,
  parts?: (messageID: string) => Part[] | undefined,
): Context | undefined => {
  const message = lastAssistantWithTokens(messages, selectedHarness)
  if (!message) return undefined

  const provider = providers.find((item) => item.id === message.providerID)
  const model = resolveModel(providers, provider, message.modelID)
  const window = (item: AssistantMessage) => (item as HarnessAssistant).contextWindow || model?.limit.context
  const own = contextReport(message, window(message))
  const earlier = own ? undefined : lastReport(messages, message, window)
  const previous = earlier && !compactedAfter(messages, earlier, parts) ? earlier : undefined
  const limit = (own ? window(message) : previous?.contextWindow) || window(message)
  const live = own ?? previous?.contextUsed
  const total = live || tokenTotal(message)
  const reported =
    !!live || (harnessID(message) === Harness.OpenCode && !(limit && total > limit) && !overWindow(message, limit))

  return {
    message,
    provider,
    model,
    providerLabel: provider?.name ?? message.providerID,
    modelLabel: model?.name ?? message.modelID,
    limit,
    input: message.tokens.input,
    total,
    usage: limit && reported ? Math.round((total / limit) * 100) : null,
    compacted: compactedAfter(messages, message, parts),
    reported,
  }
}

const contextReport = (message: AssistantMessage, window: number | undefined) => {
  const used = (message as HarnessAssistant).contextUsed
  if (!used || used <= 0) return undefined
  return window && used > window ? undefined : used
}

const overWindow = (message: AssistantMessage, window: number | undefined) => {
  const used = (message as HarnessAssistant).contextUsed
  return !!used && !!window && used > window
}

const lastReport = (
  messages: Message[],
  message: AssistantMessage,
  window: (item: AssistantMessage) => number | undefined,
) => {
  const harness = harnessID(message)
  if (harness === Harness.OpenCode) return undefined
  return messages
    .slice(0, messages.indexOf(message))
    .findLast(
      (item): item is HarnessAssistant =>
        item.role === "assistant" &&
        !item.summary &&
        harnessID(item) === harness &&
        contextReport(item, window(item)) !== undefined,
    )
}

const compactedAfter = (
  messages: Message[],
  message: AssistantMessage,
  parts: ((messageID: string) => Part[] | undefined) | undefined,
) => {
  if (!parts) return false
  const index = messages.indexOf(message)
  const start = messages.findLastIndex((item, at) => item.role === "user" && at < index)
  return messages
    .slice(Math.max(start, 0))
    .some((item) =>
      (parts(item.id) ?? []).some(
        (part) =>
          part.type === "compaction" &&
          (part.id.endsWith(":compaction") ? part.id.slice(0, -":compaction".length) : part.messageID) > message.id,
      ),
    )
}

const resolveModel = (providers: Provider[], provider: Provider | undefined, modelID: string) => {
  const exact = provider ? provider.models[modelID] : sharedModel(providers, modelID)
  if (exact) return exact
  const bare = modelID.slice(modelID.lastIndexOf("/") + 1)
  const sameBare = (scope: Provider[]) =>
    agreed(
      scope.flatMap((item) =>
        Object.entries(item.models).flatMap(([id, model]) =>
          model && id !== modelID && id.slice(id.lastIndexOf("/") + 1) === bare ? [model] : [],
        ),
      ),
    )
  if (provider) return sameBare([provider])
  const slash = modelID.indexOf("/")
  if (slash > 0) {
    const prefixed = providers.find((item) => item.id === modelID.slice(0, slash))?.models[modelID.slice(slash + 1)]
    if (prefixed) return prefixed
  }
  return sameBare(providers)
}

const agreed = (matches: Model[]) => {
  const first = matches[0]
  if (!first || matches.some((item) => item.limit.context !== first.limit.context)) return undefined
  return first
}

const sharedModel = (providers: Provider[], modelID: string) => {
  const matches = providers.flatMap((item) => {
    const model = item.models[modelID]
    return model ? [model] : []
  })
  const first = matches[0]
  if (!first || matches.some((item) => item.limit.context !== first.limit.context)) return undefined
  return first
}

export function getSessionContext(
  messages: Message[] = [],
  providers: Provider[] = [],
  selectedHarness?: string,
  parts?: (messageID: string) => Part[] | undefined,
) {
  return build(messages, providers, selectedHarness, parts)
}
