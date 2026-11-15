import { describe, expect, test } from "bun:test"
import { AgentAppTools } from "../../../../tenon/packages/tenon/src/agents/app-tools"
import { CommandActions } from "../../../../tenon/packages/tenon/src/agents/command-actions"

const action = (id: string, at: number, extra: Partial<CommandActions.Action> = {}): CommandActions.Action => ({
  id,
  at,
  kind: "message",
  sessionID: "ses_target",
  title: "Sync engine",
  by: "ses_command",
  ...extra,
})

describe("AC-2.2 action log", () => {
  test("AC-2.2 append puts the newest action first and returns a new list", () => {
    const log = [action("a", 1)]
    const next = CommandActions.append(log, action("b", 2, { kind: "stop" }))
    expect(next.map((item) => item.id)).toEqual(["b", "a"])
    expect(log.map((item) => item.id)).toEqual(["a"])
  })

  test("AC-2.2 append caps the log and the text", () => {
    const full = Array.from({ length: CommandActions.LIMIT }, (_, index) => action(`old-${index}`, index))
    const next = CommandActions.append(full, action("new", 9_999, { text: "x".repeat(CommandActions.TEXT_LIMIT + 20) }))
    expect(next).toHaveLength(CommandActions.LIMIT)
    expect(next[0].id).toBe("new")
    expect(next[0].text).toHaveLength(CommandActions.TEXT_LIMIT)
  })

  test("AC-2.2 since keeps actions at or after the given time", () => {
    const log = [action("c", 30), action("b", 20), action("a", 10)]
    expect(CommandActions.since(log, 20).map((item) => item.id)).toEqual(["c", "b"])
  })
})

describe("AC-2.3 Command Centre thread tools", () => {
  const tool = (name: string) => AgentAppTools.COMMAND_TOOLS.find((item) => item.name === name)

  test("AC-2.3 the four thread tools exist, with the read-only ones marked", () => {
    expect(tool("threads_overview")?.annotations?.readOnlyHint).toBe(true)
    expect(tool("thread_read")?.annotations?.readOnlyHint).toBe(true)
    expect(tool("thread_message")).toBeDefined()
    expect(tool("thread_stop")).toBeDefined()
    expect(tool("thread_message")?.annotations?.readOnlyHint).not.toBe(true)
    expect(tool("thread_stop")?.annotations?.readOnlyHint).not.toBe(true)
  })

  test("AC-2.3 a Project thread is not offered them", () => {
    const names = AgentAppTools.TOOLS.map((item) => item.name)
    for (const name of ["threads_overview", "thread_read", "thread_message", "thread_stop"])
      expect(names).not.toContain(name)
  })

  test("AC-2.3 no tool answers approvals or questions", () => {
    const names = [...AgentAppTools.TOOLS, ...AgentAppTools.COMMAND_TOOLS].map((item) => item.name)
    expect(names.filter((name) => /approve|permission|allow|answer/i.test(name))).toEqual([])
  })
})
