import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { getSessionContext } from "./session-context-metrics"

// Acceptance test for implementations/harness-ux-batch-2 (AC-13, added mid-run): a running OpenCode turn showed
// "Used 528,890 of 200,000 (264%)", the turn's token total. Context in use can't exceed the window.

const assistant = (
  id: string,
  input: { harness?: string; contextUsed?: number; contextWindow?: number; cacheRead?: number },
) =>
  ({
    id,
    role: "assistant",
    providerID: "opencode",
    modelID: "deepseek-v4.1-flash-free",
    harnessInstanceID: input.harness,
    contextUsed: input.contextUsed,
    contextWindow: input.contextWindow,
    cost: 0,
    tokens: { input: 40_000, output: 890, reasoning: 0, cache: { read: input.cacheRead ?? 488_000, write: 0 } },
    time: { created: 1 },
  }) as unknown as Message

describe("AC-13 context over the window", () => {
  test("a figure above the window is not shown as context in use", () => {
    const context = getSessionContext(
      [assistant("a1", { harness: "opencode-acp", contextUsed: 528_890, contextWindow: 200_000 })],
      [],
    )
    expect(context?.reported).toBe(false)
    expect(context?.usage).toBeNull()
  })

  test("it falls back to the harness's last real report", () => {
    const context = getSessionContext(
      [
        assistant("a1", { harness: "opencode-acp", contextUsed: 61_000, contextWindow: 200_000 }),
        assistant("a2", { harness: "opencode-acp", contextUsed: 528_890, contextWindow: 200_000 }),
      ],
      [],
    )
    expect(context?.reported).toBe(true)
    expect(context?.total).toBe(61_000)
    expect(context?.usage).toBe(31)
  })

  test("a figure within the window is kept", () => {
    const context = getSessionContext(
      [assistant("a1", { harness: "opencode-acp", contextUsed: 150_000, contextWindow: 200_000 })],
      [],
    )
    expect(context?.total).toBe(150_000)
    expect(context?.usage).toBe(75)
  })
})
