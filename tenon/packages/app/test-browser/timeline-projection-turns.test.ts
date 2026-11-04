import { describe, expect, mock, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import type { Part } from "@opencode-ai/sdk/v2"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { normalizeSessionMessages } from "@/utils/session-message"

mock.module("@tenon/session-ui/message-part", () => ({
  renderable: (part: Part) => part.type !== "text" || /\S/.test(part.text),
}))

const { createTimelineProjection } = await import("@/pages/session/timeline/projection")

describe("createTimelineProjection", () => {
  test("a streamed part rebuilds only its own turn's rows", () => {
    const assistant = (id: string, created: number) => ({
      id,
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content: [{ type: "text", text: "answer" }],
      time: { created, completed: created + 1 },
    })
    const source = [
      { id: "msg_1", type: "user", text: "first", time: { created: 1 } },
      assistant("msg_2", 2),
      { id: "msg_3", type: "user", text: "second", time: { created: 4 } },
      assistant("msg_4", 5),
    ] satisfies SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const [store, setStore] = createStore({ parts: Object.fromEntries(normalized.parts) as Record<string, Part[]> })
    const reads = new Map<string, number>()

    createRoot((dispose) => {
      const projection = createTimelineProjection({
        messages: () => normalized.messages,
        userMessages: () => normalized.messages.filter((message) => message.role === "user"),
        sessionMessages: () => source,
        parts: (messageID) => {
          reads.set(messageID, (reads.get(messageID) ?? 0) + 1)
          return store.parts[messageID] ?? []
        },
        status: () => ({ type: "busy" }),
        showReasoningSummaries: () => true,
        inlineComments: () => true,
      })
      const before = projection.rows()
      const firstTurn = before.filter((row) => "userMessageID" in row && row.userMessageID === "msg_1")
      reads.clear()

      const streamed = { ...store.parts.msg_4![0]!, id: "msg_4:text:1" } as Part
      setStore("parts", "msg_4", (parts) => [...parts, streamed])

      const after = projection.rows()
      expect(after.length).toBe(before.length + 1)
      expect(reads.get("msg_1")).toBeUndefined()
      expect(reads.get("msg_2")).toBeUndefined()
      expect(reads.get("msg_4")).toBeGreaterThan(0)
      const firstAfter = after.filter((row) => "userMessageID" in row && row.userMessageID === "msg_1")
      expect(firstAfter.every((row, index) => row === firstTurn[index])).toBe(true)
      dispose()
    })
  })

  test("streamed text rebuilds a turn's rows only when something they show changes", () => {
    const source = [
      { id: "msg_1", type: "user", text: "first", time: { created: 1 } },
      {
        id: "msg_2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          { type: "reasoning", text: "**Plan**" },
          {
            type: "tool",
            id: "call_1",
            name: "bash",
            state: { status: "running", input: {} },
            time: { created: 2 },
          },
        ],
        time: { created: 2 },
      },
    ] as SessionMessageInfo[]
    const normalized = normalizeSessionMessages("ses_1", source)
    const initial = normalized.parts.get("msg_2")!
    const text = { id: "text", sessionID: "ses_1", messageID: "msg_2", type: "text", text: "  " } as Part
    const [store, setStore] = createStore({ parts: { msg_1: [], msg_2: [text, ...initial] } as Record<string, Part[]> })
    const [settings, setSettings] = createStore({ reasoning: true })
    let userReads = 0

    createRoot((dispose) => {
      const projection = createTimelineProjection({
        messages: () => normalized.messages,
        userMessages: () => normalized.messages.filter((message) => message.role === "user"),
        sessionMessages: () => source,
        parts: (messageID) => {
          if (messageID === "msg_1") userReads++
          return store.parts[messageID] ?? []
        },
        status: () => ({ type: "busy" }),
        showReasoningSummaries: () => settings.reasoning,
        inlineComments: () => true,
      })
      const rows = () => projection.rows()
      const textRow = () => rows().some((row) => row._tag === "AssistantPart" && row.group.key.endsWith(":text"))
      const steps = () => rows().find((row) => row._tag === "TurnSteps")

      expect(textRow()).toBe(false)
      const blank = rows()

      setStore("parts", "msg_2", 0, "text" as never, "   " as never)
      userReads = 0
      expect(rows()).toBe(blank)
      expect(userReads).toBe(0)

      setStore("parts", "msg_2", 0, "text" as never, "   a" as never)
      expect(textRow()).toBe(true)

      const answered = rows()
      setStore("parts", "msg_2", 0, "text" as never, "   a b" as never)
      userReads = 0
      expect(rows()).toBe(answered)
      expect(userReads).toBe(0)

      setStore("parts", "msg_2", 2, "state" as never, "status" as never, "error" as never)
      expect(steps()).toMatchObject({ failed: true })

      setSettings("reasoning", false)
      expect(rows().find((row) => row._tag === "Thinking")).toMatchObject({ reasoningHeading: "Plan" })
      setStore("parts", "msg_2", 1, "text" as never, "**Next**" as never)
      expect(rows().find((row) => row._tag === "Thinking")).toMatchObject({ reasoningHeading: "Next" })
      dispose()
    })
  })
})
