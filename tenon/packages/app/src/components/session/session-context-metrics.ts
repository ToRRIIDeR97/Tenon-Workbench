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
  /** Tokens in the context window: the harness's live report, else the last step's token counts. */
  total: number
  usage: number | null
  /** A compaction finished after this message, so its figures describe the context before it. */
  compacted: boolean
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
    // A compaction's summary reply measures the old context it summarised, not the one that follows.
    if (msg.summary) continue
    if (selectedHarness && harnessID(msg) !== selectedHarness) continue
    // A harness's live context report counts before the step's tokens arrive.
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
  const model = provider ? provider.models[message.modelID] : sharedModel(providers, message.modelID)
  // A harness's own report wins: it names the window it ran with, and its model id may be an alias.
  const limit = (message as HarnessAssistant).contextWindow || model?.limit.context
  // A harness's reported context in use wins: its token counts add up every model call in the turn.
  const total = (message as HarnessAssistant).contextUsed || tokenTotal(message)

  return {
    message,
    provider,
    model,
    providerLabel: provider?.name ?? message.providerID,
    modelLabel: model?.name ?? message.modelID,
    limit,
    input: message.tokens.input,
    total,
    usage: limit ? Math.round((total / limit) * 100) : null,
    compacted: compactedAfter(messages, message, parts),
  }
}

/**
 * True when a compaction finished after `message`. A compaction carries no tokens; it shows as a `compaction` part
 * on the turn's user message, its ID (`<compaction message ID>:compaction`) ordered like message IDs.
 */
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

/**
 * An external harness reports itself, not a provider, as the source. When the known providers that list
 * the same model id all agree on its context window, that window applies; otherwise it stays unknown.
 */
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
