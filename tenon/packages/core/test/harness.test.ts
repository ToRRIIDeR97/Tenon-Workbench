import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Scope, Stream } from "effect"
import { LLM, LLMEvent, Message, Model, ToolCallPart, ToolResultPart } from "@tenon/llm"
import { route } from "@tenon/llm/protocols/openai-chat"
import { Harness } from "@tenon/schema/harness"
import { SessionID } from "@tenon/schema/session-id"
import {
  codexInputItems,
  codexState,
  codexStream,
  codexTurnNotification,
  continuationFor,
  lowestEffort,
  onTurnSuccess,
  parseCodexNotification,
  renderCodexInstructions,
  renderCodexPrompt,
  renderHandoffHistory,
  renderHarnessPrompt,
} from "@tenon/core/harness"
import { ChatDisplay } from "@tenon/core/chat-display"
import { AcpHarness } from "@tenon/core/harness/acp"
import { ProtocolError } from "@tenon/core/harness/codex-app-server"
import { Token } from "@tenon/core/util/token"

describe("Codex subagents", () => {
  // Trimmed from a live Codex 0.164 turn that spawned one subagent (`subAgentActivity`, then its own thread).
  const main = "thread-main"
  const child = "thread-child"
  const notifications = [
    { method: "turn/started", params: { threadId: main, turnId: "t1" } },
    {
      method: "item/started",
      params: {
        threadId: main,
        turnId: "t1",
        item: {
          type: "subAgentActivity",
          id: "call_1",
          kind: "started",
          agentThreadId: child,
          agentPath: "/root/single_word",
          model: "gpt-6-luna",
        },
      },
    },
    { method: "turn/started", params: { threadId: child, turnId: "c1" } },
    {
      method: "item/completed",
      params: { threadId: child, turnId: "c1", item: { type: "agentMessage", id: "m1", text: "OK" } },
    },
    {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: child,
        turnId: "c1",
        tokenUsage: {
          total: {
            totalTokens: 18067,
            inputTokens: 18062,
            cachedInputTokens: 0,
            cacheWriteInputTokens: 0,
            outputTokens: 5,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 18067,
            inputTokens: 18062,
            cachedInputTokens: 0,
            cacheWriteInputTokens: 0,
            outputTokens: 5,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 258400,
        },
      },
    },
    { method: "turn/completed", params: { threadId: child, turnId: "c1", turn: { status: "completed" } } },
    { method: "thread/status/changed", params: { threadId: "someone-else" } },
    { method: "turn/completed", params: { threadId: main, turnId: "t1", turn: { status: "completed" } } },
  ]

  test("a subagent becomes a row with its own thread's reply and token use, and only the turn's thread ends it", () => {
    const state = codexState()
    // One at a time, as the stream does: a subagent's thread is let through once its start has been read.
    const events = notifications.flatMap((n) =>
      codexTurnNotification(n, main, "t1", state) ? parseCodexNotification(n, state) : [],
    )
    const types = events.map((event) => event.type)
    expect(types).toEqual(["tool-call", "tool-progress", "tool-progress", "tool-result", "step-finish", "finish"])
    expect(events[0]).toMatchObject({
      name: "acp_subagent",
      input: { description: "Single word", subagent_type: "gpt-6-luna" },
    })
    expect(events[3]).toMatchObject({
      type: "tool-result",
      id: child,
      result: { type: "text", value: "OK" },
      providerMetadata: {
        acp: {
          transcript: [{ type: "text", text: "OK" }],
          usage: { used: 18067, size: 258400, inputTokens: 18062, outputTokens: 5, cachedReadTokens: 0 },
        },
      },
    })
  })

  test("a subagent still open when the turn ends settles with what it has", () => {
    const state = codexState()
    const events = [notifications[1]!, notifications.at(-1)!].flatMap((n) => parseCodexNotification(n, state))
    expect(events.map((event) => event.type)).toEqual(["tool-call", "tool-result", "step-finish", "finish"])
  })
})

describe("Codex harness", () => {
  test("maps assistant and provider-executed tool items", () => {
    const state = codexState()
    const command = parseCodexNotification(
      {
        method: "item/completed",
        params: {
          item: { id: "tool_1", type: "commandExecution", command: "git status", aggregatedOutput: "clean" },
        },
      },
      state,
    )
    const message = parseCodexNotification(
      { method: "item/completed", params: { item: { id: "message_1", type: "agentMessage", text: "Done" } } },
      state,
    )

    expect(command.map((event) => event.type)).toEqual(["tool-call", "tool-result"])
    expect(command[0]).toMatchObject({ providerExecuted: true, input: { command: "git status" } })
    expect(message.map((event) => event.type)).toEqual(["text-start", "text-delta", "text-end"])
  })

  test("emits each item start once when Codex repeats or reorders item/started", () => {
    const state = codexState()
    const started = (item: Record<string, unknown>) =>
      parseCodexNotification({ method: "item/started", params: { item } }, state).map((event) => event.type)

    const delta = parseCodexNotification(
      { method: "item/agentMessage/delta", params: { itemId: "message_1", delta: "Hi" } },
      state,
    )
    expect(delta.map((event) => event.type)).toEqual(["text-start", "text-delta"])
    expect(started({ id: "message_1", type: "agentMessage" })).toEqual([])
    expect(started({ id: "reasoning_1", type: "reasoning" })).toEqual(["reasoning-start"])
    expect(started({ id: "reasoning_1", type: "reasoning" })).toEqual([])
    expect(started({ id: "tool_1", type: "commandExecution", command: "ls" })).toEqual(["tool-call"])
    expect(started({ id: "tool_1", type: "commandExecution", command: "ls" })).toEqual([])
  })

  test("gives up on an unanswered interrupt so Stop can't hang, and replaces the process", async () => {
    const steps: string[] = []
    const client = {
      request: (method: string, _params?: unknown, timeout?: unknown) => {
        if (method === "turn/start") return Effect.succeed({ turn: { id: "turn_1" } })
        return timeout === undefined ? Effect.never : Effect.fail(new ProtocolError("no answer", { timedOut: true }))
      },
      notify: () => Effect.void,
      notifications: Stream.never,
      closed: Effect.succeed(false),
    }
    const runtime = {
      client,
      scope: Scope.makeUnsafe(),
      threadID: "thread_1",
      name: "Codex",
      askUser: false,
      handoff: "none" as const,
      beginTurn: () => {},
      waiting: () => false,
      endTurn: Effect.sync(() => void steps.push("end turn")),
    }
    const fiber = Effect.runFork(
      Stream.runDrain(
        codexStream(
          Effect.succeed(runtime),
          {
            sessionID: SessionID.make("ses_stop"),
            directory: "/work",
            request: LLM.request({ model, messages: [user("u1", "Go")] }),
          },
          () => Effect.sync(() => void steps.push("discard")),
        ),
      ),
    )
    await Bun.sleep(20)
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(steps).toEqual(["discard", "end turn"])
  })

  test("keeps long items open for the silence check, and records a retry without failing", () => {
    const state = codexState()
    const item = { id: "tool_1", type: "commandExecution", command: "bun test" }
    parseCodexNotification({ method: "item/started", params: { item } }, state)
    parseCodexNotification({ method: "item/started", params: { item: { id: "m1", type: "agentMessage" } } }, state)
    expect([...state.openItems]).toEqual(["tool_1"])
    parseCodexNotification({ method: "item/completed", params: { item } }, state)
    expect(state.openItems.size).toBe(0)
    const retry = { method: "error", params: { willRetry: true, error: { message: "Reconnecting 2/5" } } }
    expect(parseCodexNotification(retry, state)).toEqual([])
    expect(state).toMatchObject({ retry: "Reconnecting 2/5", failed: false })
  })

  test("says where to sign in when Codex reports it is unauthorized", () => {
    const events = parseCodexNotification(
      { method: "error", params: { error: { message: "401", codexErrorInfo: "unauthorized" } } },
      codexState(),
    )
    expect(events[0]).toMatchObject({ message: expect.stringContaining("Settings → Harnesses") })
  })

  test("reads a local image as a path on Windows and macOS", () => {
    const image = (data: string, windows: boolean) =>
      codexInputItems("Look", [{ mediaType: "image/png", data }], windows).slice(1)
    expect(image("file:///D:/My%20Shots/a.png", true)).toEqual([{ type: "localImage", path: "D:\\My Shots\\a.png" }])
    expect(image("file://server/share/a.png", true)).toEqual([{ type: "localImage", path: "\\\\server\\share\\a.png" }])
    expect(image("file:///Users/me/My%20Shots/a.png", false)).toEqual([
      { type: "localImage", path: "/Users/me/My Shots/a.png" },
    ])
    expect(image("file:///a%zz.png", false)).toEqual([])
  })

  test("picks the lowest listed effort for a one-off prompt", () => {
    expect(lowestEffort(["high", "low", "medium"])).toBe("low")
    expect(lowestEffort(["turbo"])).toBeUndefined()
  })

  test("restores what a turn consumed only when it failed before any output", async () => {
    const failure = [LLMEvent.providerError({ message: "refused" }), LLMEvent.finish({ reason: "error" })]
    const run = async (events: ReadonlyArray<LLMEvent>) => {
      const ran: string[] = []
      await Effect.runPromise(
        Stream.runDrain(
          onTurnSuccess(
            Stream.fromIterable(events),
            Effect.sync(() => void ran.push("seen")),
            Effect.sync(() => void ran.push("restore")),
          ),
        ),
      )
      return ran
    }
    expect(await run(failure)).toEqual(["restore"])
    expect(await run([LLMEvent.textDelta({ id: "t", text: "Hi" }), ...failure])).toEqual([])
    expect(await run([LLMEvent.finish({ reason: "stop" })])).toEqual(["seen"])
  })

  test("names the fix for a CLI that can't start, and leaves other failures as they are", () => {
    const failed = (_tag: "NotFound" | "PermissionDenied" | "Unknown") =>
      AcpHarness.startError("codex", { reason: { _tag } } as Parameters<typeof AcpHarness.startError>[1]).message
    expect(failed("NotFound")).toContain("isn't installed")
    expect(failed("PermissionDenied")).toContain("isn't allowed")
    expect(failed("Unknown")).toBe("Could not start codex.")
    expect(AcpHarness.turnError(new ProtocolError("nope", { code: -32000 }))).toContain("isn't signed in")
    expect(AcpHarness.turnError(new Error("Disk full"))).toBe("Disk full")
  })

  test("normalizes turn usage and completes the stream", () => {
    const state = codexState()
    parseCodexNotification(
      {
        method: "thread/tokenUsage/updated",
        params: {
          tokenUsage: {
            last: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, reasoningOutputTokens: 5 },
            modelContextWindow: 258400,
          },
        },
      },
      state,
    )
    const events = parseCodexNotification(
      { method: "turn/completed", params: { turn: { id: "turn_1", status: "completed" } } },
      state,
    )

    expect(state.finished).toBe(true)
    expect(events[0]).toMatchObject({
      type: "step-finish",
      usage: {
        inputTokens: 100,
        nonCachedInputTokens: 60,
        cacheReadInputTokens: 40,
        outputTokens: 20,
        providerMetadata: { harness: { contextSize: 258400 } },
      },
    })
  })

  test("sends the context in use with each token update", () => {
    const events = parseCodexNotification(
      {
        method: "thread/tokenUsage/updated",
        params: {
          tokenUsage: {
            total: { inputTokens: 300, outputTokens: 40 },
            last: { inputTokens: 100, outputTokens: 20 },
            modelContextWindow: 258400,
          },
        },
      },
      codexState(),
    )
    expect(events).toMatchObject([
      { type: "step-usage", usage: { providerMetadata: { harness: { contextSize: 258400, contextUsed: 120 } } } },
    ])
  })

  test("adds the Tenon context block only on handoff turns", () => {
    const model = Model.make({ id: "gpt-test", provider: "test", route })
    const request = LLM.request({
      model,
      system: "Instructions from: /brain/AGENTS.md\nUse tabs.",
      messages: [user("u1", "Old"), assistant("a1", "Answer"), user("u2", "Map the codebase")],
    })
    const workspace = { thread: "/brain/projects/Site", root: "/brain", project: "/brain/projects/Site" }

    for (const handoff of ["full", { since: "u1" }] as const) {
      const prompt = renderHarnessPrompt(request, handoff, { workspace, askUser: true })
      expect(prompt).toStartWith('<tenon-context trust="data">')
      expect(prompt).toContain("Thread folder: /brain/projects/Site")
      expect(prompt).toContain('<agents-md path="/brain/AGENTS.md">\nUse tabs.\n</agents-md>')
      expect(prompt).toContain("```svg")
      expect(prompt).toContain("`ask_user`")
      expect(prompt).toEndWith("Map the codebase")
    }
    const full = renderHarnessPrompt(request, "full", { workspace })
    expect(full.indexOf("</tenon-context>")).toBeLessThan(full.indexOf("<handoff-history>"))
    // No `tenon` MCP server (an ACP agent without HTTP MCP support): ask in the reply.
    expect(full).not.toContain("ask_user")
    expect(full).toContain(ChatDisplay.askGuidance.reply)
    expect(renderHarnessPrompt(request, "none", { workspace })).toBe("Map the codebase")
    expect(renderHarnessPrompt(request, "none", { workspace })).toBe(renderCodexPrompt(request, "none"))
  })

  test("Codex instructions keep the system text but not the native agents' chat abilities", () => {
    const native = ChatDisplay.abilities("native")
    const request = LLM.request({
      model: Model.make({ id: "gpt-test", provider: "test", route }),
      system: [
        { type: "text", text: "You are a coding agent." },
        { type: "text", text: `Today's date: Tue\n\n${native}\n\nInstructions from: /brain/AGENTS.md\nUse tabs.` },
        { type: "text", text: native },
      ],
      prompt: "Hi",
    })
    expect(renderCodexInstructions(request)).toBe(
      "You are a coding agent.\n\nToday's date: Tue\n\nInstructions from: /brain/AGENTS.md\nUse tabs.",
    )
  })

  test("renders only the latest user turn for a persistent Codex thread", () => {
    const prompt = renderCodexPrompt(
      LLM.request({
        model: Model.make({ id: "gpt-test", provider: "test", route }),
        system: "Stay within the workspace.",
        messages: [
          LLM.request({ model: Model.make({ id: "gpt-test", provider: "test", route }), prompt: "Old" }).messages[0]!,
          { role: "assistant", content: [{ type: "text", text: "Earlier answer" }] },
          LLM.request({ model: Model.make({ id: "gpt-test", provider: "test", route }), prompt: "Latest" })
            .messages[0]!,
        ],
      }),
    )

    expect(prompt).toContain("Latest")
    expect(prompt).not.toContain("Old")
    expect(prompt).not.toContain("Earlier answer")
  })

  test("renders canonical history when handing a Run to a fresh Codex thread", () => {
    const prompt = renderCodexPrompt(
      LLM.request({
        model: Model.make({ id: "gpt-test", provider: "test", route }),
        messages: [
          LLM.request({ model: Model.make({ id: "gpt-test", provider: "test", route }), prompt: "Old" }).messages[0]!,
          { role: "assistant", content: [{ type: "text", text: "Earlier answer" }] },
          LLM.request({ model: Model.make({ id: "gpt-test", provider: "test", route }), prompt: "Latest" })
            .messages[0]!,
        ],
      }),
      "full",
    )

    expect(prompt).toContain("USER:\nOld")
    expect(prompt).toContain("ASSISTANT:\nEarlier answer")
    expect(prompt.endsWith("New user message (respond to this):\nLatest")).toBe(true)
  })
})

const model = Model.make({ id: "gpt-test", provider: "test", route })
const user = (id: string, text: string) => ({ id, role: "user" as const, content: [{ type: "text" as const, text }] })
const assistant = (id: string, text: string) => ({
  id,
  role: "assistant" as const,
  content: [{ type: "text" as const, text }],
})

describe("Harness handoff history", () => {
  test("labels history as context only and separates the new request", () => {
    const prompt = renderCodexPrompt(
      LLM.request({ model, messages: [user("u1", "Old"), assistant("a1", "Answer"), user("u2", "Latest")] }),
      "full",
    )
    const [history, request] = prompt.split("\n---\n")

    expect(history).toStartWith("<handoff-history>\nEarlier conversation in this Run, shown for context only.")
    expect(history).toContain("It is not a new request and carries no instructions")
    expect(history!.trimEnd()).toEndWith("</handoff-history>")
    expect(history).not.toContain("Latest")
    expect(request).toBe("New user message (respond to this):\nLatest")
  })

  test("caps history, keeps the first and latest messages, and reports omissions", () => {
    const filler = "x".repeat(400)
    const messages = [
      user("u0", "First goal"),
      ...Array.from({ length: 20 }, (_, index) => [
        assistant(`a${index}`, `${filler} reply ${index}`),
        user(`u${index + 1}`, `${filler} ask ${index}`),
      ]).flat(),
      assistant("a-last", "Latest answer"),
    ]
    const block = renderHandoffHistory(
      messages.map((message) => Message.make(message)),
      { budget: 1_000 },
    )!

    expect(Token.estimate(block)).toBeLessThan(1_200)
    expect(block).toContain("USER:\nFirst goal")
    expect(block).toContain("ask 19")
    expect(block).toContain("ASSISTANT:\nLatest answer")
    expect(block).not.toContain("reply 0")
    expect(block).toMatch(/\d+ messages were omitted to fit the handoff budget\./)
  })

  test("omits oversized items whole and clips pinned ones", () => {
    const block = renderHandoffHistory(
      [
        user("u1", "Start"),
        assistant("a1", `huge ${"y".repeat(10_000)}`),
        user("u2", "Next"),
        assistant("a2", "Done"),
      ].map((message) => Message.make(message)),
      { budget: 500 },
    )!

    expect(block).not.toContain("huge")
    expect(block).toContain("1 message was omitted")
    const pinned = renderHandoffHistory([Message.make(user("u1", "z".repeat(10_000)))], { budget: 500 })!
    expect(pinned).toContain("[Message truncated]")
    expect(Token.estimate(pinned)).toBeLessThan(300)
  })

  test("summarizes tool calls without raw JSON", () => {
    const prompt = renderCodexPrompt(
      LLM.request({
        model,
        messages: [
          user("u1", "Check status"),
          Message.make({
            id: "a1",
            role: "assistant",
            content: [
              ToolCallPart.make({ id: "t1", name: "bash", input: { command: "git status --short", cwd: "/repo" } }),
              ToolResultPart.make({ id: "t1", name: "bash", result: { exitCode: 1, output: "fatal: secret" } }),
              ToolCallPart.make({ id: "t2", name: "read", input: { filePath: "src/app.ts" } }),
              ToolResultPart.make({ id: "t2", name: "read", result: "contents", resultType: "error" }),
            ],
          }),
          user("u2", "Latest"),
        ],
      }),
      "full",
    )

    expect(prompt).toContain("[Tool bash: git status --short]")
    expect(prompt).toContain("[Tool bash completed, exit 1]")
    expect(prompt).toContain("[Tool read: src/app.ts]")
    expect(prompt).toContain("[Tool read failed]")
    expect(prompt).not.toContain("{")
    expect(prompt).not.toContain("fatal: secret")
  })

  test("sends only messages since the harness last participated", () => {
    const request = LLM.request({
      model,
      messages: [
        user("u1", "Codex task"),
        assistant("a1", "Codex reply"),
        user("u2", "Claude task"),
        assistant("a2", "Claude reply"),
        user("u3", "Back to Codex"),
      ],
    })
    const delta = renderCodexPrompt(request, { since: "u1" })

    expect(delta).toContain("Messages added to this Run since you last participated")
    expect(delta).toContain("USER:\nClaude task")
    expect(delta).toContain("ASSISTANT:\nClaude reply")
    expect(delta).not.toContain("Codex task")
    expect(delta).not.toContain("Codex reply")
    expect(delta.endsWith("New user message (respond to this):\nBack to Codex")).toBe(true)
    expect(renderCodexPrompt(request, { since: "a2" })).toBe("Back to Codex")
    expect(renderCodexPrompt(request, { since: "missing" })).toContain("USER:\nCodex task")
  })

  test("reads per-instance continuations and the legacy single slot", () => {
    const codex = Harness.InstanceID.make("codex")
    const custom = Harness.InstanceID.make("custom-agent")
    const metadata = {
      harnessContinuations: {
        codex: { nativeID: "thread-1", lastSeenMessageID: "u1" },
        "custom-agent": { nativeID: "session-2" },
      },
    }

    expect(continuationFor(metadata, codex, 3)).toEqual({ nativeID: "thread-1", handoff: { since: "u1" } })
    expect(continuationFor(metadata, custom, 3)).toEqual({ nativeID: "session-2", handoff: "full" })
    const legacy = { harnessContinuation: { instanceID: "codex", value: "thread-0", revision: 2 } }
    expect(continuationFor(legacy, codex, 2)).toEqual({ nativeID: "thread-0", handoff: "none" })
    expect(continuationFor(legacy, codex, 3)).toBeUndefined()
    expect(continuationFor(legacy, custom, 2)).toBeUndefined()
  })
})
