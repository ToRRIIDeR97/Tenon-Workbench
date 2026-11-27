import { describe, expect, test } from "bun:test"
import type { Message, Part, ToolPart } from "@opencode-ai/sdk/v2"
import { runningOverview, threadBackgroundTasks } from "./background-tasks"

const user = (id: string) => ({ id, role: "user", time: { created: 1 } }) as unknown as Message
const assistant = (id: string, parentID: string) =>
  ({ id, role: "assistant", parentID, modelID: "model-a", time: { created: 2 } }) as unknown as Message
const tool = (id: string, name: string, state: Record<string, unknown>) =>
  ({ id, type: "tool", tool: name, state: { input: {}, ...state } }) as unknown as ToolPart

const tasksOf = (parts: Part[]) =>
  threadBackgroundTasks([user("u1"), assistant("a1", "u1")], (id) => (id === "a1" ? parts : undefined))

describe("runningOverview", () => {
  test("an empty thread has nothing running", () => {
    expect(runningOverview([])).toEqual({ total: 0, running: 0, done: 0, commands: [] })
  })

  test("counts running and done tasks and lists the commands still running", () => {
    const overview = runningOverview(
      tasksOf([
        tool("cmd-done", "bash", {
          status: "completed",
          output: "",
          time: { start: 1, end: 2 },
          input: { command: "bun run lint" },
          metadata: { exit: 0 },
        }),
        tool("cmd-failed", "bash", {
          status: "completed",
          output: "",
          time: { start: 1, end: 2 },
          input: { command: "bun run build" },
          metadata: { exit: 1 },
        }),
        tool("cmd-live", "bash", { status: "running", time: { start: 3 }, input: { command: "bun run dev" } }),
        tool("agent-live", "task", { status: "running", time: { start: 4 }, input: { description: "Explore" } }),
      ]),
    )
    expect(overview.total).toBe(4)
    expect(overview.running).toBe(2)
    expect(overview.done).toBe(1)
    expect(overview.commands.map((task) => task.part.id)).toEqual(["cmd-live"])
  })

  test("a terminal command counts as running only while its terminal is open", () => {
    const tasks = tasksOf([
      tool("term", "terminal_start", {
        status: "completed",
        output: "started pty_abc123",
        time: { start: 1, end: 2 },
        input: { command: "bun run dev" },
        metadata: { terminalId: "pty_abc123" },
      }),
    ])
    expect(runningOverview(tasks, new Set(["pty_abc123"])).commands.map((task) => task.part.id)).toEqual(["term"])
    expect(runningOverview(tasks, new Set()).commands).toEqual([])
    expect(runningOverview(tasks, new Set()).done).toBe(1)
  })
})
