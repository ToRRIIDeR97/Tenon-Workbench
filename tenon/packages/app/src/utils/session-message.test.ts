import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { isTurnStart, normalizeSessionMessages } from "./session-message"

describe("normalizeSessionMessages partsFor", () => {
  test("builds only the requested parts but still carries the turn's model to its user", () => {
    const { messages, parts } = normalizeSessionMessages(
      "ses_1",
      [
        { id: "msg_1", type: "user", text: "hi", time: { created: 1 } },
        {
          id: "msg_2",
          type: "assistant",
          agent: "build",
          model: { id: "next", providerID: "provider" },
          content: [{ type: "text", text: "answer" }],
          time: { created: 2 },
        },
      ] as SessionMessageInfo[],
      0,
      new Set(["msg_2"]),
    )

    expect([...parts.keys()]).toEqual(["msg_2"])
    expect(messages[0]).toMatchObject({ id: "msg_1", model: { modelID: "next" } })
  })
})

describe("streaming tool input", () => {
  const input = (raw: string) =>
    normalizeSessionMessages("ses_1", [
      { id: "msg_1", type: "user", text: "hi", time: { created: 1 } },
      {
        id: "msg_2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          { type: "tool", id: "call", name: "write", state: { status: "streaming", input: raw }, time: { created: 2 } },
        ],
        time: { created: 2 },
      },
    ] as SessionMessageInfo[]).parts.get("msg_2")?.[0] as { state: { input: unknown } }

  test.each([
    ['{"content":"par', {}],
    ['{"content":"}', {}],
    ['{"content":"done"}  ', { content: "done" }],
  ])("%s", (raw, expected) => {
    expect(input(raw).state.input).toEqual(expected)
  })
})

describe("normalizeSessionMessages", () => {
  test("projects current turns into stable legacy rendering records", () => {
    const source = [
      { id: "msg_1", type: "agent-switched", agent: "build", time: { created: 1 } },
      {
        id: "msg_2",
        type: "model-switched",
        model: { id: "claude", providerID: "anthropic", variant: "high" },
        time: { created: 2 },
      },
      {
        id: "msg_3",
        type: "user",
        text: "inspect @src/client.ts",
        files: [
          {
            data: "aGVsbG8=",
            mime: "text/plain",
            name: "note.txt",
            source: { type: "inline" },
          },
          {
            data: "ZXhwb3J0IHt9",
            mime: "text/plain",
            name: "client.ts",
            source: { type: "inline" },
            mention: { text: "@src/client.ts", start: 8, end: 22 },
          },
        ],
        agents: [{ name: "review", mention: { text: "@review", start: 0, end: 7 } }],
        time: { created: 3 },
      },
      {
        id: "msg_4",
        type: "assistant",
        agent: "build",
        model: { id: "claude", providerID: "anthropic", variant: "high" },
        content: [
          { type: "reasoning", text: "Thinking", time: { created: 4, completed: 5 } },
          { type: "text", text: "Result" },
          {
            type: "tool",
            id: "call_1",
            name: "read",
            state: {
              status: "completed",
              input: { filePath: "note.txt" },
              metadata: { title: "note.txt" },
              content: [{ type: "text", text: "hello" }],
            },
            time: { created: 5, ran: 6, completed: 7 },
          },
        ],
        cost: 0.1,
        tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 1, write: 0 } },
        time: { created: 4, completed: 7 },
      },
      {
        id: "msg_5",
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary: "summary",
        recent: "recent",
        time: { created: 8 },
      },
    ] satisfies SessionMessageInfo[]

    const result = normalizeSessionMessages("ses_1", source)

    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]).toMatchObject({
      id: "msg_3",
      role: "user",
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude", variant: "high" },
    })
    expect(result.messages[1]).toMatchObject({ id: "msg_4", role: "assistant", parentID: "msg_3", cost: 0.1 })
    expect(result.parts.get("msg_3")?.map((part) => part.id)).toEqual([
      "msg_3:text:0",
      "msg_3:file:0",
      "msg_3:file:1",
      "msg_3:agent:0",
      "msg_5:compaction",
    ])
    expect(result.parts.get("msg_3")?.[2]).toMatchObject({
      type: "file",
      source: {
        type: "file",
        path: "src/client.ts",
        text: { value: "@src/client.ts", start: 8, end: 22 },
      },
    })
    expect(result.parts.get("msg_4")?.map((part) => part.id)).toEqual(["msg_4:00000", "msg_4:00001", "msg_4:00002"])
    expect(result.parts.get("msg_4")?.[2]).toMatchObject({
      type: "tool",
      tool: "read",
      state: { status: "completed", output: "hello" },
    })
  })

  test("keeps a harness turn's reasoning and tool calls in order when sorted by ID", () => {
    const tool = (id: string) => ({
      type: "tool",
      id,
      name: "acp_execute",
      state: { status: "completed", input: {}, content: [] },
      time: { created: 2, ran: 2, completed: 3 },
    })
    const source = [
      { id: "msg_u", type: "user", text: "scan", time: { created: 1 } },
      {
        id: "msg_a",
        type: "assistant",
        agent: "build",
        model: { id: "opencode", providerID: "opencode-acp" },
        // The IDs an ACP agent gives: its reasoning blocks are numbered, its tool calls are UUIDs.
        content: [
          { type: "reasoning", text: "Look at the structure.", time: { created: 2 } },
          tool("f3a1c0de-0000-4000-8000-000000000001"),
          { type: "reasoning", text: "Small repo.", time: { created: 3 } },
          tool("0b7e2a11-0000-4000-8000-000000000002"),
          { type: "text", text: "Done." },
        ],
        time: { created: 2 },
      },
    ] as unknown as SessionMessageInfo[]

    const parts = normalizeSessionMessages("ses_1", source).parts.get("msg_a") ?? []
    const sorted = [...parts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    expect(sorted.map((part) => (part.type === "tool" ? part.callID : part.type))).toEqual([
      "reasoning",
      "f3a1c0de-0000-4000-8000-000000000001",
      "reasoning",
      "0b7e2a11-0000-4000-8000-000000000002",
      "text",
    ])
  })

  test("does not invent a parent for an assistant-only page", () => {
    const source = [
      {
        id: "msg_2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "orphan" }],
        time: { created: 2 },
      },
    ] satisfies SessionMessageInfo[]

    expect(normalizeSessionMessages("ses_1", source).messages).toEqual([])
  })

  test("projects a current shell message into a renderable standalone turn", () => {
    const source = [
      {
        id: "msg_shell",
        type: "shell",
        shellID: "shell_1",
        command: "printf hello",
        status: "exited",
        exit: 0,
        output: { output: "hello", cursor: 5, size: 5, truncated: false },
        time: { created: 1, completed: 2 },
      },
    ] satisfies SessionMessageInfo[]

    const result = normalizeSessionMessages("ses_1", source)

    expect(result.messages).toEqual([
      expect.objectContaining({ id: "msg_shell", role: "user" }),
      expect.objectContaining({ id: "msg_shell:assistant", role: "assistant", parentID: "msg_shell" }),
    ])
    expect(result.parts.get("msg_shell")).toEqual([expect.objectContaining({ type: "text", text: "printf hello" })])
    expect(result.parts.get("msg_shell:assistant")).toEqual([
      expect.objectContaining({
        type: "tool",
        tool: "bash",
        state: expect.objectContaining({
          status: "completed",
          input: { command: "printf hello" },
          output: "hello",
          title: "Shell",
        }),
      }),
    ])
  })

  test("adapts current edit fields for the legacy edit renderer", () => {
    const source = [
      { id: "msg_user", type: "user", text: "edit it", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          {
            type: "tool",
            id: "call_edit",
            name: "edit",
            state: {
              status: "completed",
              input: { path: "/repo/README.md", oldString: "old", newString: "new" },
              content: [{ type: "text", text: "Edited file successfully" }],
              metadata: {
                files: [
                  {
                    file: "README.md",
                    patch: "@@ -1 +1 @@\n-old\n+new",
                    additions: 1,
                    deletions: 1,
                    status: "modified",
                  },
                ],
                replacements: 1,
              },
            },
            time: { created: 2, ran: 3, completed: 4 },
          },
        ],
        time: { created: 2, completed: 4 },
      },
    ] satisfies SessionMessageInfo[]

    const result = normalizeSessionMessages("ses_1", source)

    expect(result.parts.get("msg_assistant")).toEqual([
      expect.objectContaining({
        type: "tool",
        tool: "edit",
        state: expect.objectContaining({
          status: "completed",
          input: expect.objectContaining({ path: "/repo/README.md", filePath: "/repo/README.md" }),
          metadata: expect.objectContaining({
            filediff: {
              file: "README.md",
              patch: "@@ -1 +1 @@\n-old\n+new",
              additions: 1,
              deletions: 1,
            },
          }),
        }),
      }),
    ])
  })

  test("maps an ACP subagent's transcript and usage from the result, or from the live checkpoint", () => {
    const transcript = [
      { type: "reasoning", text: "Plan" },
      { type: "tool", tool: "acp_search", title: "grep", status: "completed", output: "14 hits" },
      { type: "text", text: "Found 3." },
    ]
    const subagent = (id: string, state: Record<string, unknown>, provider?: Record<string, unknown>) => ({
      type: "tool",
      id,
      name: "acp_subagent",
      state: { input: { description: "Find usages" }, content: [], ...state },
      ...(provider ? { provider } : {}),
      time: { created: 2, ran: 2 },
    })
    const source = [
      { id: "msg_user", type: "user", text: "audit", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "opencode", providerID: "opencode-acp" },
        content: [
          subagent(
            "done",
            { status: "completed" },
            {
              executed: true,
              resultMetadata: { acp: { steps: [], transcript, usage: { used: 41000, size: 200000 }, truncated: true } },
            },
          ),
          subagent("live", {
            status: "running",
            structured: { acp: { steps: [], transcript: transcript.slice(0, 1) } },
          }),
          {
            type: "tool",
            id: "plain",
            name: "acp_read",
            state: { status: "running", input: {}, structured: {}, content: [] },
            time: { created: 2 },
          },
        ],
        time: { created: 2 },
      },
    ] as unknown as SessionMessageInfo[]

    const parts = normalizeSessionMessages("ses_1", source).parts.get("msg_assistant") ?? []
    const metadata = (id: string) => {
      const part = parts.find((item) => item.type === "tool" && item.callID === id)
      return part?.type === "tool" ? part.metadata : undefined
    }

    expect(metadata("done")?.acpSubagent).toEqual({ transcript, usage: { used: 41000, size: 200000 }, truncated: true })
    expect(metadata("done")?.acpSteps).toEqual([])
    expect(metadata("live")?.acpSubagent).toEqual({ transcript: transcript.slice(0, 1) })
    expect(metadata("plain")?.acpSubagent).toBeUndefined()
  })

  test("keeps Tenon's blocked note on a harness call it refused without asking", () => {
    const failed = (id: string, provider?: Record<string, unknown>) => ({
      type: "tool",
      id,
      name: "acp_execute",
      state: {
        status: "error",
        input: { command: "echo hello" },
        error: { type: "unknown", message: "Blocked by permission rules: bash" },
        content: [],
        structured: {},
      },
      ...(provider ? { provider } : {}),
      time: { created: 2, ran: 2, completed: 3 },
    })
    const source = [
      { id: "msg_user", type: "user", text: "run it", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "claude-code", providerID: "claude-code" },
        content: [
          failed("blocked", {
            executed: true,
            resultMetadata: { tenon: { blocked: { reason: "rules", action: "bash" } } },
          }),
          failed("declined", { executed: true }),
        ],
        time: { created: 2 },
      },
    ] as unknown as SessionMessageInfo[]

    const parts = normalizeSessionMessages("ses_1", source).parts.get("msg_assistant") ?? []
    const state = (id: string) => {
      const part = parts.find((item) => item.type === "tool" && item.callID === id)
      return part?.type === "tool" ? part.state : undefined
    }
    expect(state("blocked")).toMatchObject({
      status: "error",
      metadata: { blocked: { reason: "rules", action: "bash" } },
    })
    expect(state("declined")).toMatchObject({ status: "error" })
    expect(state("declined")).not.toHaveProperty("metadata.blocked")
  })
  test("normalizing from a turn start matches the full projection for that turn on", () => {
    const assistant = (id: string, created: number, agent: string, model: string, text: string) => ({
      id,
      type: "assistant",
      agent,
      model: { id: model, providerID: "anthropic" },
      content: [{ type: "text", text }],
      time: { created, completed: created + 1 },
    })
    const source = [
      { id: "m1", type: "agent-switched", agent: "build", time: { created: 1 } },
      { id: "m2", type: "user", text: "first", time: { created: 2 } },
      assistant("m3", 3, "plan", "opus", "one"),
      { id: "m4", type: "model-switched", model: { id: "sonnet", providerID: "anthropic" }, time: { created: 5 } },
      { id: "m5", type: "user", text: "second", time: { created: 6 } },
      { id: "m6", type: "compaction", reason: "auto", time: { created: 7 } },
      assistant("m7", 8, "build", "sonnet", "two"),
      { id: "m8", type: "user", text: "third", time: { created: 9 } },
    ] as unknown as SessionMessageInfo[]
    const full = normalizeSessionMessages("ses_1", source)
    source.forEach((entry, from) => {
      if (!isTurnStart(entry)) return
      const sliced = normalizeSessionMessages("ses_1", source, from)
      const ids = new Set(sliced.messages.map((message) => message.id))
      expect(sliced.messages).toEqual(full.messages.filter((message) => ids.has(message.id)))
      expect(ids.size).toBe(full.messages.filter((message) => message.time.created >= entry.time.created).length)
      for (const id of ids) expect(sliced.parts.get(id)).toEqual(full.parts.get(id))
    })
  })
})

describe("stopped turns", () => {
  test("a turn the user stopped reads as interrupted, not as an error", () => {
    const { messages } = normalizeSessionMessages("ses_1", [
      { id: "msg_1", type: "user", text: "hi", time: { created: 1 } },
      {
        id: "msg_2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [],
        error: { type: "unknown", message: "Provider turn interrupted" },
        time: { created: 2 },
      },
      {
        id: "msg_3",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [],
        error: { type: "unknown", message: "Rate limited" },
        time: { created: 3 },
      },
    ] as SessionMessageInfo[])

    expect(messages[1]).toMatchObject({ error: { name: "MessageAbortedError" } })
    expect(messages[2]).toMatchObject({ error: { name: "UnknownError" } })
  })
})
