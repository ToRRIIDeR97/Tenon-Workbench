import { describe, expect, test } from "bun:test"
import type { Message, Part, ToolPart } from "@opencode-ai/sdk/v2"
import {
  commandExit,
  commandOutput,
  findTask,
  lastOutputLine,
  stopTarget,
  taskCounts,
  taskSections,
  taskStatus,
  threadBackgroundTasks,
} from "../../../../tenon/packages/app/src/components/session/background-tasks"

const user = (id: string) => ({ id, role: "user", time: { created: 1 } }) as unknown as Message
const assistant = (id: string, parentID: string, extra: Record<string, unknown> = {}) =>
  ({ id, role: "assistant", parentID, time: { created: 0 }, ...extra }) as unknown as Message
const tool = (id: string, name: string, state: Record<string, unknown>) =>
  ({ id, type: "tool", tool: name, state: { input: {}, ...state } }) as unknown as ToolPart

describe("AC-1 boundaries", () => {
  test("an empty thread, and a thread with no subagents or commands, have no tasks", () => {
    expect(threadBackgroundTasks([], () => undefined)).toEqual([])
    const parts: Record<string, Part[]> = {
      a1: [tool("r", "read", { status: "completed", output: "", time: { start: 1, end: 2 } })],
    }
    const tasks = threadBackgroundTasks([user("u1"), assistant("a1", "u1")], (id) => parts[id])
    expect(tasks).toEqual([])
    expect(taskCounts(tasks)).toEqual({ all: 0, agent: 0, command: 0, running: 0 })
    expect(taskSections(tasks, "all")).toEqual({ running: [], finished: [] })
  })

  test("every shell-command tool name counts as a command, across harnesses", () => {
    const parts: Record<string, Part[]> = {
      a1: ["bash", "shell", "acp_execute", "command_execution"].map((name) =>
        tool(`c-${name}`, name, { status: "completed", output: "", time: { start: 1, end: 2 } }),
      ),
    }
    const tasks = threadBackgroundTasks([user("u1"), assistant("a1", "u1")], (id) => parts[id])
    expect(tasks.map((task) => task.kind)).toEqual(["command", "command", "command", "command"])
  })

  test("a task keeps the harness and model of the message that called it", () => {
    const parts: Record<string, Part[]> = {
      a1: [tool("t", "task", { status: "running", time: { start: 5 } })],
    }
    const tasks = threadBackgroundTasks(
      [user("u1"), assistant("a1", "u1", { harnessInstanceID: "codex", modelID: "gpt-x", variant: "high" })],
      (id) => parts[id],
    )
    expect(tasks[0]!.harness).toBe("codex")
    expect(tasks[0]!.parent).toEqual({ id: "gpt-x", reasoning: "high" })
  })

  test("an assistant message whose user message is missing joins the latest turn", () => {
    const parts: Record<string, Part[]> = {
      a9: [tool("c", "bash", { status: "running", time: { start: 5 } })],
    }
    const tasks = threadBackgroundTasks([user("u1"), user("u2"), assistant("a9", "gone")], (id) => parts[id])
    expect(tasks.map((task) => task.turn)).toEqual([2])
  })
})

describe("AC-2 boundaries", () => {
  test("exit code 0 is done; an exit code reported as structured output counts", () => {
    const ok = tool("a", "bash", { status: "completed", output: "", structured: { exit: 0 }, time: { start: 1, end: 2 } })
    const bad = tool("b", "bash", { status: "completed", output: "", structured: { exit: 2 }, time: { start: 1, end: 2 } })
    expect(commandExit(ok)).toBe(0)
    expect(taskStatus(ok)).toBe("done")
    expect(commandExit(bad)).toBe(2)
    expect(taskStatus(bad)).toBe("failed")
  })

  test("a completed command with no exit code is done; a non-numeric exit is ignored", () => {
    const part = tool("a", "acp_execute", {
      status: "completed",
      output: "",
      metadata: { exit: "1" },
      time: { start: 1, end: 2 },
    })
    expect(commandExit(part)).toBeUndefined()
    expect(taskStatus(part)).toBe("done")
  })

  test("a subagent's exit-like metadata never fails it", () => {
    const part = tool("a", "task", { status: "completed", output: "", metadata: { exit: 3 }, time: { start: 1, end: 2 } })
    expect(taskStatus(part)).toBe("done")
  })
})

describe("AC-3 and AC-4 after things change", () => {
  const parts: Record<string, Part[]> = {
    a1: [
      tool("first", "bash", { status: "completed", output: "", time: { start: 10, end: 500 } }),
      tool("second", "task", { status: "completed", output: "", time: { start: 20, end: 100 } }),
      tool("third", "bash", { status: "error", error: "Tool execution interrupted", time: { start: 30, end: 300 } }),
      tool("waiting", "bash", { status: "pending" }),
    ],
  }
  const tasks = threadBackgroundTasks([user("u1"), assistant("a1", "u1")], (id) => parts[id])

  test("finished order follows when each ended, not when it was called", () => {
    expect(taskSections(tasks, "all").finished.map((task) => task.part.id)).toEqual(["first", "third", "second"])
  })

  test("a pending task is running and is counted", () => {
    expect(taskSections(tasks, "all").running.map((task) => task.part.id)).toEqual(["waiting"])
    expect(taskCounts(tasks)).toEqual({ all: 4, agent: 1, command: 3, running: 1 })
  })

  test("a filter with no match leaves both sections empty", () => {
    const only = tasks.filter((task) => task.kind === "command")
    expect(taskSections(only, "agent")).toEqual({ running: [], finished: [] })
  })
})

describe("AC-5 boundaries", () => {
  test("no output yet is an empty string", () => {
    expect(commandOutput(tool("a", "bash", { status: "pending" }))).toBe("")
    expect(commandOutput(tool("a", "bash", { status: "running", time: { start: 1 } }))).toBe("")
  })

  test("a finished command falls back to the output streamed while it ran", () => {
    const part = tool("a", "bash", {
      status: "completed",
      output: "",
      metadata: { output: "partial\r\nlines" },
      time: { start: 1, end: 2 },
    })
    expect(commandOutput(part)).toBe("partial\nlines")
  })

  test("the last line skips trailing blank lines", () => {
    expect(lastOutputLine("one\ntwo\n\n  \n")).toBe("two")
    expect(lastOutputLine("\n\n")).toBeUndefined()
  })
})

describe("AC-6 boundaries", () => {
  const live = (id: string, name: string, metadata?: Record<string, unknown>) => ({
    kind: name === "bash" ? ("command" as const) : ("agent" as const),
    turn: 1,
    part: tool(id, name, { status: "running", time: { start: 1 }, ...(metadata ? { metadata } : {}) }),
  })

  test("a built-in subagent whose session hasn't started yet stops the turn", () => {
    expect(stopTarget(live("t", "task"), "ses_thread")).toEqual({ sessionID: "ses_thread", scope: "turn" })
  })

  test("with no thread there is nothing to stop a command with", () => {
    expect(stopTarget(live("c", "bash"), undefined)).toBeUndefined()
  })

  test("a built-in subagent with its own session can be stopped even without the thread id", () => {
    expect(stopTarget(live("t", "task", { sessionId: "ses_child" }), undefined)).toEqual({
      sessionID: "ses_child",
      scope: "task",
    })
  })

  test("a stopped or failed task has nothing to stop", () => {
    const stopped = {
      kind: "command" as const,
      turn: 1,
      part: tool("s", "bash", { status: "error", error: "Tool execution interrupted", time: { start: 1, end: 2 } }),
    }
    expect(stopTarget(stopped, "ses_thread")).toBeUndefined()
    expect(findTask([stopped], "s")).toBe(stopped)
  })
})
