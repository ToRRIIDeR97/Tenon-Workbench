import { describe, expect, test } from "bun:test"
import { AgentAppTools } from "../../../../tenon/packages/tenon/src/agents/app-tools"
import { CommandActions } from "../../../../tenon/packages/tenon/src/agents/command-actions"

const make = (id: string, at: number, text?: string): CommandActions.Action => ({
  id,
  at,
  kind: "stop",
  sessionID: `ses_${id}`,
  title: id,
  by: "ses_cc",
  ...(text === undefined ? {} : { text }),
})

describe("AC-2.2 boundaries", () => {
  test("AC-2.2 appending to an empty log, and an action without text", () => {
    const next = CommandActions.append([], make("only", 5))
    expect(next).toHaveLength(1)
    expect(next[0].text).toBeUndefined()
  })

  test("AC-2.2 text at the limit is kept whole; the action passed in is not changed", () => {
    const exact = make("exact", 1, "a".repeat(CommandActions.TEXT_LIMIT))
    const long = make("long", 2, "b".repeat(CommandActions.TEXT_LIMIT * 3))
    const log = CommandActions.append(CommandActions.append([], exact), long)
    expect(log[1].text).toHaveLength(CommandActions.TEXT_LIMIT)
    expect(log[0].text).toHaveLength(CommandActions.TEXT_LIMIT)
    expect(long.text).toHaveLength(CommandActions.TEXT_LIMIT * 3)
  })

  test("AC-2.2 the cap drops the oldest entries, one over the limit and well under it", () => {
    const grow = (count: number) =>
      Array.from({ length: count }, (_, index) => make(`n${index}`, index)).reduce<CommandActions.Action[]>(
        (log, item) => CommandActions.append(log, item),
        [],
      )
    const over = grow(CommandActions.LIMIT + 1)
    expect(over).toHaveLength(CommandActions.LIMIT)
    expect(over[0].id).toBe(`n${CommandActions.LIMIT}`)
    expect(over.at(-1)?.id).toBe("n1")
    expect(grow(3).map((item) => item.id)).toEqual(["n2", "n1", "n0"])
  })

  test("AC-2.2 since with nothing recent, with everything recent, and without changing the log", () => {
    const log = [make("c", 300), make("b", 200), make("a", 100)]
    const copy = structuredClone(log)
    expect(CommandActions.since(log, 301)).toEqual([])
    expect(CommandActions.since(log, 0).map((item) => item.id)).toEqual(["c", "b", "a"])
    expect(CommandActions.since([], 0)).toEqual([])
    expect(log).toEqual(copy)
  })
})

describe("AC-2.3 boundaries", () => {
  const command = AgentAppTools.COMMAND_TOOLS

  test("AC-2.3 the tools that act name the thread they act on, and messaging needs text", () => {
    for (const name of ["thread_read", "thread_message", "thread_stop"]) {
      const schema = command.find((item) => item.name === name)?.inputSchema as {
        properties?: Record<string, unknown>
        required?: string[]
      }
      expect(Object.keys(schema?.properties ?? {}).length).toBeGreaterThan(0)
      expect((schema?.required ?? []).length).toBeGreaterThan(0)
    }
    const message = command.find((item) => item.name === "thread_message")?.inputSchema as { required?: string[] }
    expect((message.required ?? []).length).toBeGreaterThanOrEqual(2)
  })

  test("AC-2.3 tool names are unique and the earlier Command Centre tools are still there", () => {
    const names = command.map((item) => item.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain("memory_search")
    expect(names).toContain("project_setup")
  })

  test("AC-2.3 the catalog for a Project folder has none of the thread tools", () => {
    const names = AgentAppTools.catalogFor("C:/work/projects/site").map((item) => item.name)
    expect(names.filter((name) => /^thread(s_overview|_read|_message|_stop)$/.test(name))).toEqual([])
  })
})
