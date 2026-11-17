import { describe, expect, test } from "bun:test"
import { AcpHarness } from "@tenon/core/harness/acp"
import { SessionTodo } from "@tenon/core/session/todo"

describe("SessionTodo.fromPlan", () => {
  test("reads the todowrite call a harness plan becomes", () => {
    const events = AcpHarness.planEvents({ plans: 0 }, [
      { content: "Read the code", status: "completed" },
      { content: "Fix the bug", status: "in_progress" },
      { content: "", status: "pending" },
      { content: "Run the tests", status: "pending" },
    ])
    const call = events.find((event) => event.type === "tool-call")
    expect(call?.type === "tool-call" && call.providerExecuted && call.name).toBe("todowrite")
    expect(SessionTodo.fromPlan(call?.type === "tool-call" ? call.input : undefined)).toEqual([
      { content: "Read the code", status: "completed", priority: "medium" },
      { content: "Fix the bug", status: "in_progress", priority: "medium" },
      { content: "Run the tests", status: "pending", priority: "medium" },
    ])
  })

  test("keeps a given priority and reads unknown statuses as pending", () => {
    expect(SessionTodo.fromPlan({ todos: [{ content: "Ship", status: "blocked", priority: "high" }, 3] })).toEqual([
      { content: "Ship", status: "pending", priority: "high" },
    ])
  })

  test("ignores input that is not a todo list", () => {
    expect(SessionTodo.fromPlan(undefined)).toBeUndefined()
    expect(SessionTodo.fromPlan({ value: "x" })).toBeUndefined()
    expect(SessionTodo.fromPlan({ todos: [] })).toEqual([])
  })
})
