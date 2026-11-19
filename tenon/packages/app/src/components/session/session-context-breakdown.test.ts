import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { estimateSessionContextBreakdown } from "./session-context-breakdown"

const user = (id: string) => {
  return {
    id,
    role: "user",
    time: { created: 1 },
  } as unknown as Message
}

const assistant = (id: string) => {
  return {
    id,
    role: "assistant",
    time: { created: 1 },
  } as unknown as Message
}

describe("estimateSessionContextBreakdown", () => {
  test("estimates tokens and keeps remaining tokens as other", () => {
    const messages = [user("u1"), assistant("a1")]
    const parts = {
      u1: [{ type: "text", text: "hello world" }] as unknown as Part[],
      a1: [{ type: "text", text: "assistant response" }] as unknown as Part[],
    }

    const output = estimateSessionContextBreakdown({
      messages,
      parts,
      input: 20,
      systemPrompt: "system prompt",
    })

    const map = Object.fromEntries(output.map((segment) => [segment.key, segment.tokens]))
    expect(map.system).toBe(4)
    expect(map.user).toBe(3)
    expect(map.assistant).toBe(5)
    expect(map.other).toBe(8)
  })

  test("scales segments when estimates exceed input", () => {
    const messages = [user("u1"), assistant("a1")]
    const parts = {
      u1: [{ type: "text", text: "x".repeat(400) }] as unknown as Part[],
      a1: [{ type: "text", text: "y".repeat(400) }] as unknown as Part[],
    }

    const output = estimateSessionContextBreakdown({
      messages,
      parts,
      input: 10,
      systemPrompt: "z".repeat(200),
    })

    const total = output.reduce((sum, segment) => sum + segment.tokens, 0)
    expect(total).toBeLessThanOrEqual(10)
    expect(output.every((segment) => segment.width <= 100)).toBeTrue()
  })

  test("counts only what is still in the window: after the last compaction, and only the newest turn's reasoning", () => {
    const messages = [user("u0"), assistant("a0"), user("u1"), assistant("a1"), user("u2"), assistant("a2")]
    const parts = {
      u0: [{ type: "text", text: "x".repeat(4000) }] as unknown as Part[],
      a0: [{ type: "text", text: "x".repeat(4000) }] as unknown as Part[],
      u1: [{ type: "compaction" }] as unknown as Part[],
      a1: [
        { type: "text", text: "s".repeat(40) },
        { type: "reasoning", text: "r".repeat(400) },
      ] as unknown as Part[],
      u2: [{ type: "text", text: "q".repeat(40) }] as unknown as Part[],
      a2: [{ type: "reasoning", text: "t".repeat(40) }] as unknown as Part[],
    }
    const map = Object.fromEntries(
      estimateSessionContextBreakdown({ messages, parts, input: 1000 }).map((segment) => [segment.key, segment.tokens]),
    )
    // Before the compaction: gone. The older turn's reasoning: dropped. The summary, the prompt and the newest
    // reasoning: counted.
    expect(map.user).toBe(10)
    expect(map.assistant).toBe(20)
  })

  test("a tool's arguments count at their written size", () => {
    const content = "c".repeat(4000)
    const parts = {
      a1: [
        { type: "tool", state: { status: "completed", input: { path: "a.ts", content }, output: "ok" } },
      ] as unknown as Part[],
    }
    const map = Object.fromEntries(
      estimateSessionContextBreakdown({ messages: [assistant("a1")], parts, input: 5000 }).map((segment) => [
        segment.key,
        segment.tokens,
      ]),
    )
    expect(map.tool).toBeGreaterThan(1000)
  })
})
