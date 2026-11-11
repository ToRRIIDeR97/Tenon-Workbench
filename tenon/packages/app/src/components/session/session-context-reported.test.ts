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

// AC-10: a turn total summed over every model call is not the context in use.
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
