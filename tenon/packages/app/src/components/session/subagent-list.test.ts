import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2"
import { childTranscript, splitResult, subagentCounts, taskResult, threadSubagents } from "./subagent-list"
import { childLaneSteps, laneElapsed, laneTokens } from "./subagent-lane"

const user = (id: string, created: number) => ({ id, role: "user", time: { created } }) as unknown as Message
const assistant = (id: string, parentID: string) =>
  ({ id, role: "assistant", parentID, time: { created: 0 } }) as unknown as Message
const tool = (id: string, name: string, status: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: "tool",
    tool: name,
    state: { status, input: { description: id }, time: { start: 1000, end: 4000 }, ...extra },
  }) as unknown as Part

describe("threadSubagents", () => {
  const messages = [user("u1", 10), assistant("a1", "u1"), user("u2", 20), assistant("a2", "u2"), user("u3", 30)]
  const parts: Record<string, Part[]> = {
    a1: [tool("t1", "task", "completed"), tool("r1", "read", "completed")],
    a2: [tool("s1", "acp_subagent", "running"), tool("t2", "task", "error", { error: "boom" })],
  }
  const groups = threadSubagents(messages, (id) => parts[id])

  test("groups both subagent kinds by the turn that started them, newest first", () => {
    expect(groups.map((group) => [group.turn, group.userMessageID, group.items.map((item) => item.part.id)])).toEqual([
      [2, "u2", ["s1", "t2"]],
      [1, "u1", ["t1"]],
    ])
    expect(groups[0]!.createdAt).toBe(20)
  })

  test("counts running and failed subagents", () => {
    expect(subagentCounts(groups)).toEqual({ all: 3, running: 1, failed: 1 })
  })
})

describe("lane helpers", () => {
  test("times a running lane to now and a finished one to its end", () => {
    const running = { state: { status: "running", time: { start: 1000 } } } as never
    expect(laneElapsed(running, 6000)).toBe(5000)
    expect(laneElapsed(tool("t", "task", "completed") as never, 99_000)).toBe(3000)
    expect(laneElapsed({ state: { status: "pending" } } as never, 5000)).toBeUndefined()
  })

  test("reads tokens from the ACP report or the child session", () => {
    const acp = {
      tool: "acp_subagent",
      state: { status: "completed", input: {} },
      metadata: { acpSubagent: { transcript: [], usage: { inputTokens: 10, outputTokens: 5 } } },
    } as never
    expect(laneTokens(acp)).toBe(15)
    const task = tool("t", "task", "completed") as never
    expect(laneTokens(task, { tokens: { input: 3, output: 4, reasoning: 1, cache: { read: 0, write: 0 } } })).toBe(8)
    expect(laneTokens(task)).toBeUndefined()
  })

  test("maps a child session's tool calls to lane steps", () => {
    expect(childLaneSteps([tool("a", "read", "running"), tool("b", "bash", "error")]).map((s) => s.status)).toEqual([
      "in_progress",
      "failed",
    ])
  })
})

describe("detail helpers", () => {
  test("unwraps the task tool's result", () => {
    expect(taskResult('<task id="ses" state="completed">\n<task_result>\nAll done.\n</task_result>\n</task>')).toBe(
      "All done.",
    )
    expect(taskResult("plain")).toBe("plain")
  })

  test("takes a finished agent's last text as its result", () => {
    const entries = [
      { type: "tool" as const, tool: "read", status: "completed" },
      { type: "text" as const, text: "Answer" },
    ]
    expect(splitResult(entries, true)).toEqual({ steps: [entries[0]!], result: "Answer" })
    expect(splitResult(entries, false)).toEqual({ steps: entries, result: undefined })
  })

  test("builds a child session transcript from assistant parts", () => {
    const messages = [user("u", 1), assistant("a", "u")]
    const parts: Record<string, Part[]> = {
      a: [
        { id: "x", type: "text", text: "Looking" } as unknown as Part,
        tool("r", "read", "completed", { input: { filePath: "src/a.ts" }, output: "ok" }),
      ],
    }
    expect(childTranscript(messages, (id) => parts[id])).toEqual([
      { type: "text", text: "Looking" },
      { type: "tool", tool: "read", status: "completed", title: "src/a.ts", output: "ok" },
    ])
  })
})
