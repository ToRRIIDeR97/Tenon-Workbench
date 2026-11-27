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

const user = (id: string, created: number) => ({ id, role: "user", time: { created } }) as unknown as Message
const assistant = (id: string, parentID: string) =>
  ({ id, role: "assistant", parentID, modelID: "model-a", time: { created: 0 } }) as unknown as Message
const tool = (id: string, name: string, state: Record<string, unknown>) =>
  ({ id, type: "tool", tool: name, state: { input: {}, ...state } }) as unknown as ToolPart
const done = (start: number, end: number, extra: Record<string, unknown> = {}) => ({
  status: "completed",
  output: "",
  time: { start, end },
  ...extra,
})

const messages = [user("u1", 10), assistant("a1", "u1"), user("u2", 20), assistant("a2", "u2")]
const parts: Record<string, Part[]> = {
  a1: [
    tool("cmd-old", "bash", done(100, 200, { input: { command: "bun run typecheck" }, metadata: { exit: 0 } })),
    tool("read-1", "read", done(200, 210, { input: { filePath: "a.ts" } })),
    tool("agent-old", "task", done(210, 900, { input: { description: "Review" }, metadata: { sessionId: "ses_c1" } })),
    tool("cmd-fail", "bash", done(900, 950, { input: { command: "git fetch" }, metadata: { exit: 128 } })),
  ],
  a2: [
    tool("cmd-live", "bash", {
      status: "running",
      input: { command: "bun test" },
      metadata: { output: "\u001b[32m✓ one\u001b[0m\r\n✓ two\r\n" },
      time: { start: 1000 },
    }),
    tool("agent-live", "task", {
      status: "running",
      input: { description: "Explore" },
      metadata: { sessionId: "ses_c2" },
      time: { start: 1100 },
    }),
    tool("acp-live", "acp_subagent", { status: "running", input: { description: "Scan" }, time: { start: 1200 } }),
    tool("edit-1", "edit", done(1200, 1210)),
  ],
}
const tasks = threadBackgroundTasks(messages, (id) => parts[id])
const ids = (list: readonly { part: ToolPart }[]) => list.map((task) => task.part.id)

describe("AC-1 the thread's subagents and shell commands are one list", () => {
  test("lists both kinds in call order with the turn that started them, and nothing else", () => {
    expect(tasks.map((task) => [task.part.id, task.kind, task.turn])).toEqual([
      ["cmd-old", "command", 1],
      ["agent-old", "agent", 1],
      ["cmd-fail", "command", 1],
      ["cmd-live", "command", 2],
      ["agent-live", "agent", 2],
      ["acp-live", "agent", 2],
    ])
  })

  test("finds a task by its part id", () => {
    expect(findTask(tasks, "agent-old")?.kind).toBe("agent")
    expect(findTask(tasks, "read-1")).toBeUndefined()
    expect(findTask(tasks, undefined)).toBeUndefined()
  })
})

describe("AC-2 each task has one state", () => {
  test("running, done, failed by exit code, failed by error, stopped", () => {
    expect(taskStatus(findTask(tasks, "cmd-live")!.part)).toBe("running")
    expect(taskStatus(tool("p", "bash", { status: "pending" }))).toBe("running")
    expect(taskStatus(findTask(tasks, "cmd-old")!.part)).toBe("done")
    expect(taskStatus(findTask(tasks, "cmd-fail")!.part)).toBe("failed")
    expect(taskStatus(tool("e", "task", { status: "error", error: "boom", time: { start: 1, end: 2 } }))).toBe("failed")
    expect(
      taskStatus(tool("s", "bash", { status: "error", error: "Tool execution interrupted", time: { start: 1, end: 2 } })),
    ).toBe("stopped")
  })

  test("reads a command's exit code", () => {
    expect(commandExit(findTask(tasks, "cmd-fail")!.part)).toBe(128)
    expect(commandExit(findTask(tasks, "cmd-live")!.part)).toBeUndefined()
  })
})

describe("AC-3 Running and Finished sections with a kind filter", () => {
  test("running tasks are newest first; finished tasks are latest-ended first", () => {
    const sections = taskSections(tasks, "all")
    expect(ids(sections.running)).toEqual(["acp-live", "agent-live", "cmd-live"])
    expect(ids(sections.finished)).toEqual(["cmd-fail", "agent-old", "cmd-old"])
  })

  test("Agents and Commands filter both sections", () => {
    expect(ids(taskSections(tasks, "agent").running)).toEqual(["acp-live", "agent-live"])
    expect(ids(taskSections(tasks, "agent").finished)).toEqual(["agent-old"])
    expect(ids(taskSections(tasks, "command").running)).toEqual(["cmd-live"])
    expect(ids(taskSections(tasks, "command").finished)).toEqual(["cmd-fail", "cmd-old"])
  })
})

describe("AC-4 counts for the filters and the rail badge", () => {
  test("counts every task, each kind, and what is running", () => {
    expect(taskCounts(tasks)).toEqual({ all: 6, agent: 3, command: 3, running: 3 })
  })
})

describe("AC-5 a command's output", () => {
  test("live output while running, without colour codes or carriage returns", () => {
    const live = findTask(tasks, "cmd-live")!.part
    expect(commandOutput(live)).toBe("✓ one\n✓ two\n")
    expect(lastOutputLine(commandOutput(live))).toBe("✓ two")
  })

  test("final output when done, the error when it failed", () => {
    expect(commandOutput(tool("d", "bash", done(1, 2, { output: "all good\n" })))).toBe("all good\n")
    expect(commandOutput(tool("e", "bash", { status: "error", error: "spawn failed", time: { start: 1, end: 2 } }))).toBe(
      "spawn failed",
    )
    expect(lastOutputLine("")).toBeUndefined()
  })
})

describe("AC-6 what Stop stops", () => {
  test("a built-in subagent stops its own session", () => {
    expect(stopTarget(findTask(tasks, "agent-live")!, "ses_thread")).toEqual({ sessionID: "ses_c2", scope: "task" })
  })

  test("a command or an ACP subagent can only stop the thread's turn", () => {
    expect(stopTarget(findTask(tasks, "cmd-live")!, "ses_thread")).toEqual({ sessionID: "ses_thread", scope: "turn" })
    expect(stopTarget(findTask(tasks, "acp-live")!, "ses_thread")).toEqual({ sessionID: "ses_thread", scope: "turn" })
  })

  test("a finished task has nothing to stop", () => {
    expect(stopTarget(findTask(tasks, "cmd-old")!, "ses_thread")).toBeUndefined()
    expect(stopTarget(findTask(tasks, "agent-old")!, "ses_thread")).toBeUndefined()
  })
})
