import { parseCommentNote, readCommentMetadata } from "@/utils/comment-note"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { AssistantMessage, Part, SessionStatus, UserMessage } from "@opencode-ai/sdk/v2"
import { renderable } from "@tenon/session-ui/message-part"
import { groupParts, type PartGroup, type PartRef } from "@tenon/session-ui/part-group"
import { isDeclined, isStopped } from "@tenon/session-ui/step-kind"
import { TimelineRow, type SummaryDiff } from "./timeline-row"
import { uniqueSummaryDiffs } from "./summary-diffs"
import { compareMessages } from "@/utils/session-message"

export { TimelineRow, type SummaryDiff } from "./timeline-row"

export type TimelineRowMap = {
  TurnGap: { userMessageID: string }
  CommentStrip: {
    userMessageID: string
  }
  UserMessage: {
    userMessageID: string
    anchor: boolean
  }
  TurnDivider: {
    userMessageID: string
    label: "compaction" | "interrupted"
  }
  AssistantPart: {
    userMessageID: string
    group: PartGroup
    previousAssistantPart: boolean
    step?: true
  }
  TurnSteps: { userMessageID: string; segment: number; steps: PartRef[]; failed: boolean }
  Thinking: { userMessageID: string; reasoningHeading?: string }
  Retry: { userMessageID: string }
  DiffSummary: { userMessageID: string; diffs: SummaryDiff[] }
  Error: { userMessageID: string; text: string }
}

export namespace Timeline {
  export type Turn = { user: UserMessage; assistants: AssistantMessage[]; shell?: true }

  export function constructSessionMessageRows(
    messages: SessionMessageInfo[],
    getMessage: (messageID: string) => UserMessage | AssistantMessage | undefined,
    getMessageParts: (messageID: string) => Part[],
    showReasoning: boolean,
    status: SessionStatus["type"],
    inlineComments: boolean,
    projectedUserMessages: UserMessage[],
  ) {
    const turns = constructSessionTurns(messages, getMessage, projectedUserMessages)
    const activeMessageID = turns.at(-1)?.user.id
    return {
      activeMessageID,
      rows: turns.flatMap((turn, index) =>
        constructTurnRows(turn, getMessageParts, index, showReasoning, status, activeMessageID, inlineComments),
      ),
    }
  }

  /**
   * What a turn's rows read from its assistant parts. A streamed character almost never changes it, so
   * the rows only rebuild when it does. `thinking` is whether the turn is active and busy.
   */
  export function turnPartsSignature(
    assistantMessages: AssistantMessage[],
    getMessageParts: (messageID: string) => Part[],
    showReasoning: boolean,
    thinking: boolean,
  ) {
    let signature = ""
    let shown = false
    for (const message of assistantMessages) {
      for (const part of getMessageParts(message.id)) {
        const visible = renderable(part, showReasoning)
        shown ||= visible
        const tool = part.type === "tool" ? `${part.tool}:${part.state.status}` : ""
        signature += `${message.id} ${part.id} ${part.type} ${tool} ${visible}\n`
      }
    }
    if (thinking && (!showReasoning || !shown)) signature += thinkingHeading(assistantMessages, getMessageParts) ?? ""
    return signature
  }

  /** Groups messages into turns. It reads messages only, so streamed parts don't re-run it. */
  export function constructSessionTurns(
    messages: SessionMessageInfo[],
    getMessage: (messageID: string) => UserMessage | AssistantMessage | undefined,
    projectedUserMessages: UserMessage[],
  ) {
    const turns: Turn[] = []
    const turnByUserID = new Map<string, (typeof turns)[number]>()
    messages.forEach((message) => {
      const projected = getMessage(message.id)
      if (message.type === "shell" && projected?.role === "user") {
        const assistant = getMessage(`${message.id}:assistant`)
        const turn = {
          user: projected,
          assistants: assistant?.role === "assistant" ? [assistant] : [],
          shell: true as const,
        }
        turns.push(turn)
        turnByUserID.set(projected.id, turn)
        return
      }
      if (projected?.role === "user") {
        if (turnByUserID.has(projected.id)) return
        const turn = { user: projected, assistants: [] }
        turns.push(turn)
        turnByUserID.set(projected.id, turn)
        return
      }
      if (projected?.role !== "assistant") return
      const existing = turnByUserID.get(projected.parentID)
      if (existing) {
        existing.assistants.push(projected)
        return
      }
      const user = getMessage(projected.parentID)
      if (user?.role !== "user") return
      const turn = { user, assistants: [projected] }
      turns.push(turn)
      turnByUserID.set(user.id, turn)
    })
    projectedUserMessages.forEach((user) => {
      if (turnByUserID.has(user.id)) return
      const turn = { user, assistants: [] }
      const index = turns.findIndex((item) => compareMessages(user, item.user) < 0)
      if (index < 0) turns.push(turn)
      if (index >= 0) turns.splice(index, 0, turn)
      turnByUserID.set(user.id, turn)
    })
    return turns
  }

  export function constructTurnRows(
    turn: Turn,
    getMessageParts: (messageID: string) => Part[],
    index: number,
    showReasoning: boolean,
    status: SessionStatus["type"],
    activeMessageID: string | undefined,
    inlineComments: boolean,
  ) {
    return constructMessageRows(
      turn.user,
      getMessageParts,
      turn.assistants,
      index,
      showReasoning,
      status,
      turn.user.id === activeMessageID,
      inlineComments,
      !turn.shell,
    )
  }

  export function constructMessageRows(
    userMessage: UserMessage,
    getMessageParts: (messageID: string) => Part[],
    assistantMessages: AssistantMessage[],
    index: number,
    showReasoning: boolean,
    status: SessionStatus["type"],
    isActive: boolean,
    // v2 renders comments inside the user message attachments row instead of a strip row
    inlineComments: boolean,
    // A user-run shell command shows its output directly instead of folding it as an agent step.
    foldSteps = true,
  ) {
    const rows: TimelineRow.TimelineRow[] = []

    const previousUserMessage = index > 0
    const userParts = getMessageParts(userMessage.id)
    const comments = userParts.flatMap((p) => MessageComment.fromPart(p) ?? [])
    const compaction = userParts.some((p) => p.type === "compaction")
    const interruptedMessageIndex = assistantMessages.findIndex((m) => m.error?.name === "MessageAbortedError")
    const interrupted = interruptedMessageIndex !== -1
    const latestError = assistantMessages.at(-1)?.error
    const error = latestError?.name === "MessageAbortedError" ? undefined : latestError

    const assistantPartRefs = assistantMessages.flatMap((message, messageIndex) =>
      getMessageParts(message.id)
        .filter((part) => renderable(part, showReasoning))
        .map((part) => ({ messageID: message.id, messageIndex, part })),
    )
    const segments =
      interrupted && !compaction
        ? [
            assistantPartRefs.filter((ref) => ref.messageIndex <= interruptedMessageIndex),
            assistantPartRefs.filter((ref) => ref.messageIndex > interruptedMessageIndex),
          ]
        : [assistantPartRefs]
    if (previousUserMessage) rows.push(new TimelineRow.TurnGap({ userMessageID: userMessage.id }))

    if (comments.length > 0 && !inlineComments)
      rows.push(
        new TimelineRow.CommentStrip({
          userMessageID: userMessage.id,
        }),
      )

    rows.push(
      new TimelineRow.UserMessage({
        userMessageID: userMessage.id,
        anchor: inlineComments || comments.length === 0,
      }),
    )

    if (compaction) {
      rows.push(
        new TimelineRow.TurnDivider({
          userMessageID: userMessage.id,
          label: "compaction",
        }),
      )
    }

    let assistantGroupIndex = 0
    // Cards are numbered across the turn: an interrupt or an update from the agent between steps starts a new one.
    let card = 0
    segments.forEach((refs, segment) => {
      if (segment > 0)
        rows.push(
          new TimelineRow.TurnDivider({
            userMessageID: userMessage.id,
            label: "interrupted",
          }),
        )
      const partByID = new Map(refs.map((ref) => [ref.part.id, ref.part] as const))
      const groups = groupParts(refs).map((group) => {
        const type = group.type === "part" ? partByID.get(group.ref.partID)?.type : "tool"
        return { group, step: foldSteps && (type === "tool" || type === "reasoning") }
      })
      // A run of tool and reasoning groups folds under one TurnSteps card; text and other parts stay visible in
      // order and close the card, so the steps after an update to the user start a fresh one.
      groups.forEach(({ group, step }, index) => {
        if (step && !groups[index - 1]?.step) {
          const end = groups.findIndex((item, at) => at > index && !item.step)
          const run = groups.slice(index, end === -1 ? undefined : end)
          const steps = run.flatMap((item) => (item.group.type === "part" ? [item.group.ref] : item.group.refs))
          // A call the user declined or stopped isn't a failure, so it doesn't hold the card open.
          const failed = steps.some((ref) => {
            const part = partByID.get(ref.partID)
            return part?.type === "tool" && part.state.status === "error" && !isDeclined(part) && !isStopped(part)
          })
          // Text after the run settles it only once every step has finished: a shell still running stays open.
          const running = steps.some((ref) => {
            const part = partByID.get(ref.partID)
            return part?.type === "tool" && (part.state.status === "pending" || part.state.status === "running")
          })
          rows.push(
            new TimelineRow.TurnSteps({
              userMessageID: userMessage.id,
              segment: card++,
              steps,
              failed,
              settled: end !== -1 && !running,
              previousAssistantPart: assistantGroupIndex > 0,
            }),
          )
        }
        rows.push(
          new TimelineRow.AssistantPart({
            userMessageID: userMessage.id,
            group,
            previousAssistantPart: assistantGroupIndex > 0,
            ...(step ? { step: true as const } : {}),
          }),
        )
        assistantGroupIndex += 1
      })
    })

    if (isActive && status === "busy" && !error && (showReasoning ? assistantPartRefs.length === 0 : true)) {
      rows.push(
        new TimelineRow.Thinking({
          userMessageID: userMessage.id,
          reasoningHeading: thinkingHeading(assistantMessages, getMessageParts),
        }),
      )
    }

    if (isActive && status === "retry") rows.push(new TimelineRow.Retry({ userMessageID: userMessage.id }))

    const diffs = uniqueSummaryDiffs(userMessage.summary?.diffs)
    if (diffs.length > 0 && (status === "idle" || !isActive)) {
      rows.push(
        new TimelineRow.DiffSummary({
          userMessageID: userMessage.id,
          diffs,
        }),
      )
    }

    if (error) {
      const data = error.data?.message
      const text = unwrapErrorMessage(
        typeof data === "string" ? data : data === undefined || data === null ? "" : String(data),
      )
      rows.push(
        new TimelineRow.Error({
          userMessageID: userMessage.id,
          text,
          // Core reports a model whose API the runtime can't drive as raw text; the row shows friendly copy instead.
          ...(/^Unsupported API for [^\s/]+\/\S+: \S+$/.test(text) ? { unsupportedModel: true as const } : {}),
        }),
      )
    }

    return rows
  }

  function thinkingHeading(assistantMessages: AssistantMessage[], getMessageParts: (messageID: string) => Part[]) {
    for (const message of assistantMessages) {
      for (const part of getMessageParts(message.id)) {
        if (part.type !== "reasoning" || !part.text) continue
        const heading = reasoningHeading(part.text)
        if (heading) return heading
      }
    }
  }

  function reasoningHeading(text: string) {
    const markdown = text.replace(/\r\n?/g, "\n")
    const html = markdown.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
    if (html?.[1]) {
      const value = cleanHeading(html[1].replace(/<[^>]+>/g, " "))
      if (value) return value
    }

    const atx = markdown.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m)
    if (atx?.[1]) {
      const value = cleanHeading(atx[1])
      if (value) return value
    }

    const setext = markdown.match(/^([^\n]+)\n(?:=+|-+)\s*$/m)
    if (setext?.[1]) {
      const value = cleanHeading(setext[1])
      if (value) return value
    }

    const strong = markdown.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/m)
    if (strong?.[1]) {
      const value = cleanHeading(strong[1])
      if (value) return value
    }
  }

  function cleanHeading(value: string) {
    return value
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_~]+/g, "")
      .trim()
  }

  function unwrapErrorMessage(message: string) {
    const text = message.replace(/^Error:\s*/, "").trim()

    const parse = (value: string) => {
      try {
        return JSON.parse(value) as unknown
      } catch {
        return undefined
      }
    }

    const read = (value: string) => {
      const first = parse(value)
      if (typeof first !== "string") return first
      return parse(first.trim())
    }

    let json = read(text)

    if (json === undefined) {
      const start = text.indexOf("{")
      const end = text.lastIndexOf("}")
      if (start !== -1 && end > start) json = read(text.slice(start, end + 1))
    }

    if (!record(json)) return message

    const err = record(json.error) ? json.error : undefined
    if (err) {
      const type = typeof err.type === "string" ? err.type : undefined
      const msg = typeof err.message === "string" ? err.message : undefined
      if (type && msg) return `${type}: ${msg}`
      if (msg) return msg
      if (type) return type
      const code = typeof err.code === "string" ? err.code : undefined
      if (code) return code
    }

    const msg = typeof json.message === "string" ? json.message : undefined
    if (msg) return msg

    const reason = typeof json.error === "string" ? json.error : undefined
    if (reason) return reason

    return message
  }

  function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
  }
}

export namespace MessageComment {
  export type MessageComment = {
    path: string
    comment: string
    selection?: {
      startLine: number
      endLine: number
    }
  }

  export const fromPart = (part: Part): MessageComment | undefined => {
    if (part.type !== "text" || !part.synthetic) return
    const next = readCommentMetadata(part.metadata) ?? parseCommentNote(part.text)
    if (!next) return
    return {
      path: next.path,
      comment: next.comment,
      selection: next.selection
        ? {
            startLine: next.selection.startLine,
            endLine: next.selection.endLine,
          }
        : undefined,
    }
  }
}
