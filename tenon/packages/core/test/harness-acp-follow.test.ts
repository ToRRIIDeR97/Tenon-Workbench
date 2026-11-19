import { describe, expect, test } from "bun:test"
import { AcpHarness } from "@tenon/core/harness/acp"

// Shapes from OpenCode 2.2.5's `GET /api/session/:id/message`, newest first.
const assistant = (id: string, content: unknown[], completed: number | null = 1) => ({
  id,
  type: "assistant",
  content,
  time: { created: 0, ...(completed === null ? {} : { completed }) },
})
const notice = (id: string, child: string, state = "completed") => ({
  id,
  type: "synthetic",
  description: "Board pass",
  metadata: { source: "subagent", childID: child, state },
  text: `<subagent sessionID="${child}" state="${state}">…</subagent>`,
})
const idle = (id: string) => ({ id, type: "idle", outcome: "succeeded" })

describe("following an OpenCode agent's own turns", () => {
  test("reads the messages of an api answer, and nothing from anything else", () => {
    expect(AcpHarness.openCodeMessages(JSON.stringify({ data: [idle("m2"), { type: "idle" }], cursor: null }))).toEqual(
      [idle("m2")],
    )
    expect(AcpHarness.openCodeMessages("Error: Server process exited")).toBeUndefined()
  })

  test("shows only what it hasn't, oldest first, and is idle once every child reported", () => {
    const seen = new Set(["m1"])
    const pending = new Set(["ses_a", "ses_b"])
    const first = AcpHarness.followProgress([notice("m2", "ses_a"), { id: "m1", type: "idle" }], seen, pending)
    expect(first.fresh.map((message) => message.id)).toEqual(["m2"])
    expect([...pending]).toEqual(["ses_b"])
    expect(first.idle).toBe(false)

    const next = AcpHarness.followProgress(
      [idle("m5"), assistant("m4", []), notice("m3", "ses_b"), notice("m2", "ses_a")],
      seen,
      pending,
    )
    expect(next.fresh.map((message) => message.id)).toEqual(["m3", "m4", "m5"])
    expect(next.idle).toBe(true)
  })

  // A read can land while OpenCode is still writing its reply (reasoning only, no text yet).
  test("leaves a reply that is still streaming for a later read", () => {
    const seen = new Set<string>()
    const pending = new Set<string>()
    expect(AcpHarness.followProgress([assistant("m4", [], null)], seen, pending).fresh).toEqual([])
    expect(AcpHarness.followProgress([assistant("m4", [])], seen, pending).fresh.map((message) => message.id)).toEqual([
      "m4",
    ])
  })

  test("is not idle while a child is out, even when the agent is", () => {
    expect(AcpHarness.followProgress([idle("m2")], new Set(), new Set(["ses_a"])).idle).toBe(false)
  })

  test("turns an assistant message into the updates ACP would have sent live", () => {
    const updates = AcpHarness.openCodeMessageUpdates(
      assistant("m4", [
        { type: "reasoning", text: "The board pass is in." },
        {
          type: "tool",
          id: "call_1",
          name: "shell",
          state: {
            status: "completed",
            input: { command: "git status --short" },
            content: [{ type: "text", text: "?? a" }],
          },
        },
        { type: "tool", id: "call_2", name: "read", state: { status: "running", input: {} } },
        {
          type: "tool",
          id: "call_3",
          name: "edit",
          state: { status: "error", input: {}, error: { message: "denied" } },
        },
        { type: "text", text: "All six passes are in." },
      ]),
    )
    expect(updates).toEqual([
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "m4",
        content: { type: "text", text: "The board pass is in." },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "call_1",
        name: "shell",
        title: "shell",
        kind: "execute",
        rawInput: { command: "git status --short" },
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "?? a" } }],
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "call_3",
        name: "edit",
        title: "edit",
        kind: "edit",
        rawInput: {},
        status: "failed",
        content: [{ type: "content", content: { type: "text", text: "denied" } }],
      },
      {
        sessionUpdate: "agent_message_chunk",
        messageId: "m4",
        content: { type: "text", text: "All six passes are in." },
      },
    ])
  })

  test("a subagent's notice reads as a short note; user and idle markers are not part of the reply", () => {
    expect(AcpHarness.openCodeMessageUpdates(notice("m3", "ses_b", "cancelled"))).toEqual([
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "m3",
        content: { type: "text", text: "Board pass: cancelled" },
      },
    ])
    expect(AcpHarness.openCodeMessageUpdates(idle("m5"))).toEqual([])
    expect(AcpHarness.openCodeMessageUpdates({ id: "m6", type: "user", text: "hi" })).toEqual([])
  })

  test("the updates parse into the same events as a live turn", () => {
    const state = AcpHarness.acpState()
    const events = AcpHarness.openCodeMessageUpdates(assistant("m4", [{ type: "text", text: "Done." }])).flatMap(
      (update) =>
        AcpHarness.parseAcpNotification({ method: "session/update", params: { sessionId: "s", update } }, "s", state),
    )
    expect(events.map((event) => event.type)).toEqual(["text-start", "text-delta"])
  })
})
