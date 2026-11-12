import { describe, expect, test } from "bun:test"
import { contextBreakdown } from "./context-breakdown-model"

const user = (id: string, text: string, system?: string) => ({
  message: { id, role: "user", ...(system ? { system } : {}) },
  parts: [{ id: `${id}p`, type: "text", text }],
})
const assistant = (id: string, text: string, toolOutput?: string) => ({
  message: { id, role: "assistant" },
  parts: [
    { id: `${id}t`, type: "text", text },
    ...(toolOutput
      ? [{ id: `${id}x`, type: "tool", state: { status: "completed", input: { path: "a" }, output: toolOutput } }]
      : []),
  ],
})

function build(entries: { message: Record<string, unknown>; parts: Record<string, unknown>[] }[]) {
  return {
    messages: entries.map((entry) => entry.message) as never,
    parts: Object.fromEntries(entries.map((entry) => [entry.message.id as string, entry.parts])) as never,
  }
}

describe("contextBreakdown", () => {
  test("splits the reported use by the thread's text and leaves the rest as the agent's own and free", () => {
    // 4,000 chars of messages = 1,000 tokens; 2,000 chars of tool output plus input ≈ 504; system 400 chars = 100.
    const thread = build([
      user("u1", "a".repeat(2000), "s".repeat(400)),
      assistant("a1", "b".repeat(2000), "c".repeat(2000)),
    ])
    const parts = contextBreakdown({ ...thread, used: 20_000, limit: 100_000 })
    const by = Object.fromEntries(parts.map((part) => [part.key, part]))
    expect(by.system?.tokens).toBe(100)
    expect(by.messages?.tokens).toBe(1000)
    expect(by.tools?.tokens).toBe(504)
    expect(by.other?.tokens).toBe(20_000 - 100 - 1000 - 504)
    expect(by.free?.tokens).toBe(80_000)
    expect(parts.reduce((sum, part) => sum + part.percent, 0)).toBeCloseTo(100, 5)
  })

  test("scales the estimate down when the thread's text exceeds the reported use", () => {
    const thread = build([user("u1", "a".repeat(8000)), assistant("a1", "b".repeat(8000))])
    const parts = contextBreakdown({ ...thread, used: 1000, limit: 10_000 })
    const used = parts.filter((part) => part.key !== "free").reduce((sum, part) => sum + part.tokens, 0)
    expect(used).toBe(1000)
  })

  test("is empty without a window or any use", () => {
    const thread = build([user("u1", "hi")])
    expect(contextBreakdown({ ...thread, used: 0, limit: 1000 })).toEqual([])
    expect(contextBreakdown({ ...thread, used: 10, limit: undefined })).toEqual([])
  })
})
