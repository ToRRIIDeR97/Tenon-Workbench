import { describe, expect, test } from "bun:test"
import type { Message, Part, ToolPart } from "@opencode-ai/sdk/v2"
import {
  commandTitle,
  findTask,
  stopTarget,
  taskCounts,
  taskElapsed,
  taskSections,
  taskStatus,
  terminalID,
  threadBackgroundTasks,
} from "../../../../tenon/packages/app/src/components/session/background-tasks"

const user = (id: string) => ({ id, role: "user", time: { created: 1 } }) as unknown as Message
const assistant = (id: string, parentID: string) =>
  ({ id, role: "assistant", parentID, time: { created: 0 } }) as unknown as Message
const tool = (id: string, name: string, state: Record<string, unknown>) =>
  ({ id, type: "tool", tool: name, state: { input: {}, ...state } }) as unknown as ToolPart
const started = (id: string, command: string, terminal: string, start: number) =>
  tool(id, "terminal_start", {
    status: "completed",
    input: { command, title: "Dev server" },
    output: JSON.stringify({ terminalId: terminal, title: "Dev server", folder: "C:/repo" }),
    time: { start, end: start + 40 },
  })

const parts: Record<string, Part[]> = {
  a1: [
    started("term-dev", "bun run dev", "pty_dev111", 1000),
    tool("read-term", "terminal_read", { status: "completed", output: "lines", time: { start: 1100, end: 1101 } }),
    started("term-watch", "bun run watch", "pty_watch222", 2000),
    tool("cmd", "bash", { status: "completed", input: { command: "ls" }, output: "", time: { start: 3000, end: 3100 } }),
  ],
}
const tasks = threadBackgroundTasks([user("u1"), assistant("a1", "u1")], (id) => parts[id])
const live = new Set(["pty_dev111", "pty_user999"])
const ids = (list: readonly { part: ToolPart }[]) => list.map((task) => task.part.id)

describe("AC-9 an agent terminal is a command task", () => {
  test("terminal_start calls are listed as commands; terminal_read is not a task", () => {
    expect(tasks.map((task) => [task.part.id, task.kind])).toEqual([
      ["term-dev", "command"],
      ["term-watch", "command"],
      ["cmd", "command"],
    ])
  })

  test("its terminal id and title come from the call", () => {
    const dev = findTask(tasks, "term-dev")!.part
    expect(terminalID(dev)).toBe("pty_dev111")
    expect(commandTitle(dev)).toBe("bun run dev")
    expect(terminalID(findTask(tasks, "cmd")!.part)).toBeUndefined()
    expect(commandTitle(findTask(tasks, "cmd")!.part)).toBe("ls")
  })

  test("it runs while its terminal is open and is done once the terminal is gone", () => {
    expect(taskStatus(findTask(tasks, "term-dev")!.part, live)).toBe("running")
    expect(taskStatus(findTask(tasks, "term-watch")!.part, live)).toBe("done")
    expect(taskStatus(findTask(tasks, "term-dev")!.part)).toBe("done")
  })

  test("sections and counts follow the open terminals", () => {
    expect(ids(taskSections(tasks, "all", live).running)).toEqual(["term-dev"])
    expect(ids(taskSections(tasks, "all", live).finished)).toEqual(["cmd", "term-watch"])
    expect(taskCounts(tasks, live)).toEqual({ all: 3, agent: 0, command: 3, running: 1 })
    expect(taskCounts(tasks)).toEqual({ all: 3, agent: 0, command: 3, running: 0 })
  })

  test("elapsed time counts from the start while open, and is unknown once closed", () => {
    expect(taskElapsed(findTask(tasks, "term-dev")!.part, 61_000, live)).toBe(60_000)
    expect(taskElapsed(findTask(tasks, "term-watch")!.part, 61_000, live)).toBeUndefined()
    expect(taskElapsed(findTask(tasks, "cmd")!.part, 61_000, live)).toBe(100)
  })
})

describe("AC-10 Stop closes the one terminal", () => {
  test("an open terminal is its own stop target", () => {
    expect(stopTarget(findTask(tasks, "term-dev")!, "ses_thread", live)).toEqual({
      terminalID: "pty_dev111",
      scope: "terminal",
    })
  })

  test("a closed terminal has nothing to stop", () => {
    expect(stopTarget(findTask(tasks, "term-watch")!, "ses_thread", live)).toBeUndefined()
    expect(stopTarget(findTask(tasks, "term-dev")!, "ses_thread")).toBeUndefined()
  })
})
