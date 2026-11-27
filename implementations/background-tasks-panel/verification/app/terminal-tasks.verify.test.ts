import { describe, expect, test } from "bun:test"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import {
  commandTitle,
  stopTarget,
  taskElapsed,
  taskStatus,
  terminalID,
} from "../../../../tenon/packages/app/src/components/session/background-tasks"

const tool = (id: string, name: string, state: Record<string, unknown>) =>
  ({ id, type: "tool", tool: name, state: { input: {}, ...state } }) as unknown as ToolPart
const task = (part: ToolPart) => ({ kind: "command" as const, turn: 1, part })

describe("AC-9 boundaries", () => {
  test("a harness-prefixed tool name still counts, with the id in metadata", () => {
    const part = tool("a", "tenon_terminal_start", {
      status: "completed",
      input: { command: "npm start" },
      output: "started",
      metadata: { terminalId: "pty_meta1" },
      time: { start: 1, end: 2 },
    })
    expect(terminalID(part)).toBe("pty_meta1")
    expect(taskStatus(part, new Set(["pty_meta1"]))).toBe("running")
  })

  test("a call still in flight is running and has no terminal id yet", () => {
    const part = tool("a", "terminal_start", { status: "running", input: { command: "x" }, time: { start: 5 } })
    expect(terminalID(part)).toBeUndefined()
    expect(taskStatus(part, new Set())).toBe("running")
    expect(stopTarget(task(part), "ses_thread", new Set())).toEqual({ sessionID: "ses_thread", scope: "turn" })
  })

  test("a failed call is failed, whatever terminals are open", () => {
    const part = tool("a", "terminal_start", {
      status: "error",
      input: { command: "x" },
      error: "This thread already runs 6 terminals",
      time: { start: 1, end: 2 },
    })
    expect(terminalID(part)).toBeUndefined()
    expect(taskStatus(part, new Set(["pty_other"]))).toBe("failed")
    expect(stopTarget(task(part), "ses_thread", new Set(["pty_other"]))).toBeUndefined()
  })

  test("a completed call with no id in it is done and cannot be stopped", () => {
    const part = tool("a", "terminal_start", {
      status: "completed",
      input: { command: "x" },
      output: "ok",
      time: { start: 1, end: 2 },
    })
    expect(terminalID(part)).toBeUndefined()
    expect(taskStatus(part, new Set(["pty_any"]))).toBe("done")
    expect(taskElapsed(part, 500, new Set(["pty_any"]))).toBeUndefined()
  })

  test("another tool that mentions a terminal id is not an agent terminal", () => {
    const part = tool("a", "bash", {
      status: "completed",
      input: { command: "echo pty_fake1" },
      output: "pty_fake1",
      time: { start: 1, end: 9 },
    })
    expect(terminalID(part)).toBeUndefined()
    expect(taskStatus(part, new Set(["pty_fake1"]))).toBe("done")
    expect(taskElapsed(part, 500, new Set(["pty_fake1"]))).toBe(8)
  })

  test("the title falls back when the command is missing", () => {
    const part = tool("a", "terminal_start", { status: "completed", output: "pty_x1", time: { start: 1, end: 2 } })
    expect(commandTitle(part)).toBeUndefined()
  })

  test("a running shell command's elapsed time runs to now; a pending one has none", () => {
    expect(taskElapsed(tool("a", "bash", { status: "running", time: { start: 100 } }), 350)).toBe(250)
    expect(taskElapsed(tool("a", "bash", { status: "pending" }), 350)).toBeUndefined()
  })
})

describe("AC-10 boundaries", () => {
  const part = tool("a", "terminal_start", {
    status: "completed",
    input: { command: "bun dev" },
    output: '{"terminalId":"pty_abc9","title":"bun dev"}',
    time: { start: 1, end: 2 },
  })

  test("the terminal stop needs no thread id", () => {
    expect(stopTarget(task(part), undefined, new Set(["pty_abc9"]))).toEqual({
      terminalID: "pty_abc9",
      scope: "terminal",
    })
  })

  test("an empty set of open terminals means nothing to stop", () => {
    expect(stopTarget(task(part), "ses_thread", new Set())).toBeUndefined()
  })
})
