import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import { subagentBar, subagentContexts } from "./subagent-context"
import { threadSubagents } from "./subagent-list"

const user = (id: string) => ({ id, role: "user", time: { created: 0 } }) as unknown as Message
const assistant = (id: string, parentID: string) =>
  ({ id, role: "assistant", parentID, time: { created: 0 } }) as unknown as Message
const part = (id: string, tool: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    sessionID: "ses_parent",
    type: "tool",
    tool,
    state: { status: "completed", input: { description: id }, time: { start: 1000, end: 10_400 } },
    ...extra,
  }) as unknown as Part

describe("subagentContexts", () => {
  const messages = [user("u1"), assistant("a1", "u1"), user("u2"), assistant("a2", "u2")]
  const parts: Record<string, Part[]> = {
    a1: [
      part("t1", "task", {
        state: { status: "completed", input: {}, metadata: { sessionId: "ses_child" }, time: { start: 0, end: 2000 } },
      }),
    ],
    a2: [
      part("s1", "acp_subagent", {
        metadata: { acpSubagent: { usage: { used: 14_212, size: 200_000, inputTokens: 900, outputTokens: 162 } } },
      }),
      part("s2", "acp_subagent", {
        state: {
          status: "completed",
          input: { description: "s2", prompt: "x".repeat(40) },
          time: { start: 0, end: 1000 },
        },
        metadata: { acpSubagent: { transcript: [{ type: "text", text: "y".repeat(400) }] } },
      }),
    ],
  }
  const rows = subagentContexts(
    threadSubagents(messages, (id) => parts[id]),
    (id) =>
      id === "ses_child"
        ? { tokens: { input: 5000, output: 300, reasoning: 0, cache: { read: 1000 } }, cost: 0.01 }
        : undefined,
  )

  test("a harness subagent carries its own context window and usage, by turn, newest first", () => {
    expect(rows.map((row) => [row.id, row.turn, row.turnID])).toEqual([
      ["s1", 2, "u2"],
      ["s2", 2, "u2"],
      ["t1", 1, "u1"],
    ])
    expect(rows[0]!.context).toEqual({ used: 14_212, size: 200_000, percent: 7 })
    expect(rows[0]!.usage.output).toBe(162)
    expect(rows[0]!.seconds).toBe(9)
    expect(rows[1]!.context).toBeUndefined()
    // OpenCode reports no usage for its subagents: the transcript gives a rough count instead.
    expect(rows[1]!.estimate).toBe(110)
    expect(rows[0]!.estimate).toBeUndefined()
  })

  test("a built-in task agent takes its child session's totals and has no context figure", () => {
    expect(rows[2]!.context).toBeUndefined()
    expect(rows[2]!.usage).toEqual({ input: 5000, output: 300, reasoning: 0, cacheRead: 1000, cost: 0.01 })
  })

  test("bars are relative to the busiest subagent", () => {
    expect(subagentBar(rows[0]!, rows)).toBe(100)
    expect(subagentBar(rows[2]!, rows)).toBeCloseTo((6000 / 14_212) * 100)
    expect(subagentBar(rows[1]!, rows)).toBeCloseTo((110 / 14_212) * 100)
  })
})
