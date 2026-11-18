import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { getSessionContext } from "./session-context-metrics"

// Acceptance test for implementations/harness-ux-batch-2 (AC-9): OpenCode reports its context only when a turn
// ends, so a running turn shows the last report instead of "Not reported".

const assistant = (id: string, input: { harness?: string; contextUsed?: number; contextWindow?: number }) =>
  ({
    id,
    role: "assistant",
    providerID: "opencode",
    modelID: "deepseek-v4.1-flash-free",
    harnessInstanceID: input.harness,
    contextUsed: input.contextUsed,
    contextWindow: input.contextWindow,
    cost: 0,
    tokens: { input: 2_457, output: 169, reasoning: 17, cache: { read: 16_512, write: 0 } },
    time: { created: 1 },
  }) as unknown as Message

describe("AC-9 running external turn", () => {
  test("uses the context the same harness reported at the end of its last turn", () => {
    const context = getSessionContext(
      [
        assistant("a1", { harness: "opencode-acp", contextUsed: 30_416, contextWindow: 200_000 }),
        assistant("a2", { harness: "opencode-acp" }),
      ],
      [],
    )
    expect(context?.reported).toBe(true)
    expect(context?.total).toBe(30_416)
    expect(context?.limit).toBe(200_000)
    expect(context?.usage).toBe(15)
  })

  test("a first turn with no report yet stays not reported", () => {
    const context = getSessionContext([assistant("a1", { harness: "opencode-acp" })], [])
    expect(context?.reported).toBe(false)
  })
})
