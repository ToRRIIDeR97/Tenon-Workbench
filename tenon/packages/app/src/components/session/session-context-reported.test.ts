import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { getSessionContext } from "./session-context-metrics"

const assistant = (input: { harness?: string; contextUsed?: number; contextWindow?: number }) =>
  ({
    id: "a1",
    role: "assistant",
    providerID: "opencode-go",
    modelID: "deepseek-v4.1-flash",
    harnessInstanceID: input.harness,
    contextUsed: input.contextUsed,
    contextWindow: input.contextWindow,
    cost: 0,
    tokens: { input: 300_000, output: 7_140, reasoning: 0, cache: { read: 80_000, write: 0 } },
    time: { created: 1 },
  }) as unknown as Message

describe("getSessionContext reported", () => {
  test("an external harness without a live context report is not reported", () => {
    const context = getSessionContext([assistant({ harness: "opencode-acp" })], [])
    expect(context?.reported).toBe(false)
    expect(context?.usage).toBeNull()
  })

  test("an external harness that reports its context is reported", () => {
    const context = getSessionContext(
      [assistant({ harness: "opencode-acp", contextUsed: 52_000, contextWindow: 200_000 })],
      [],
    )
    expect(context?.reported).toBe(true)
    expect(context?.total).toBe(52_000)
    expect(context?.usage).toBe(26)
  })

  test("the built-in loop's per-step tokens count as reported", () => {
    const context = getSessionContext([assistant({})], [])
    expect(context?.reported).toBe(true)
  })
})

describe("latestSubagentContexts", () => {
  test("lists the latest turn's subagents with the context each reported", async () => {
    const { latestSubagentContexts } = await import("./session-usage")
    const tool = (id: string, tool: string, extra: Record<string, unknown>) =>
      ({
        id,
        type: "tool",
        tool,
        state: { status: "running", input: { description: id }, ...extra },
        metadata: {},
      }) as Record<string, unknown>
    const messages = [
      { id: "u1", role: "user" },
      { id: "a1", role: "assistant" },
    ] as unknown as Message[]
    const parts = () => [
      {
        ...tool("review", "acp_subagent", {}),
        metadata: { acpSubagent: { usage: { used: 50_000, size: 200_000 } } },
      },
      tool("tests", "task", { metadata: { sessionId: "ses_child" } }),
    ]
    const list = latestSubagentContexts(messages, parts as never, (id) =>
      id === "ses_child" ? { used: 10_000 } : undefined,
    )
    expect(list.map((item) => [item.name, item.running, item.used, item.size])).toEqual([
      ["review", true, 50_000, 200_000],
      ["tests", true, 10_000, undefined],
    ])
  })
})

describe("getSessionContext alias model ids", () => {
  const live = { harness: "opencode-acp", contextUsed: 64_000 }
  const providers = [
    { id: "opencode-go", models: { "deepseek/deepseek-v4.1-flash": { limit: { context: 128_000 } } } },
    { id: "deepseek", models: { "deepseek-v4.1-flash": { limit: { context: 128_000 } } } },
  ]

  test("a model id without its provider prefix resolves to the prefixed one", () => {
    const context = getSessionContext([assistant(live)], providers)
    expect(context?.limit).toBe(128_000)
    expect(context?.usage).toBe(50)
  })

  test("a provider/model id resolves through the named provider", () => {
    const message = { ...(assistant(live) as object), providerID: "harness", modelID: "deepseek/deepseek-v4.1-flash" }
    const context = getSessionContext([message as Message], [providers[1]])
    expect(context?.limit).toBe(128_000)
  })

  test("aliases that disagree on the window leave it unknown, and the tokens still show", () => {
    const context = getSessionContext(
      [{ ...(assistant(live) as object), providerID: "harness" } as Message],
      [
        { id: "a", models: { "x/deepseek-v4.1-flash": { limit: { context: 64_000 } } } },
        { id: "b", models: { "y/deepseek-v4.1-flash": { limit: { context: 128_000 } } } },
      ],
    )
    expect(context?.limit).toBeUndefined()
    expect(context?.reported).toBe(true)
    expect(context?.total).toBe(64_000)
    expect(context?.usage).toBeNull()
  })

  test("the message's own provider wins over the provider named in a provider/model id", () => {
    const message = { ...(assistant(live) as object), modelID: "deepseek/deepseek-v4.1-flash" }
    const context = getSessionContext(
      [message as Message],
      [
        { id: "opencode-go", models: { "deepseek-v4.1-flash": { limit: { context: 128_000 } } } },
        { id: "deepseek", models: { "deepseek-v4.1-flash": { limit: { context: 64_000 } } } },
      ],
    )
    expect(context?.limit).toBe(128_000)
  })
})
