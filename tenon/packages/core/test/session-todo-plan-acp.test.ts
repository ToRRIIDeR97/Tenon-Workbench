import { describe, expect, test } from "bun:test"
import { SessionTodo } from "@tenon/core/session/todo"

const todos = [
  { content: "Add the routes", status: "in_progress", priority: "high" },
  { content: "Write the tests", status: "pending", priority: "medium" },
]

describe("AC-7 SessionTodo.planFromToolCall", () => {
  test("reads a todowrite call", () => {
    expect(SessionTodo.planFromToolCall("todowrite", { todos })).toEqual(todos)
  })

  test("reads OpenCode's acp_other call titled todowrite", () => {
    expect(SessionTodo.planFromToolCall("acp_other", { todos, title: "todowrite" })).toEqual(todos)
  })

  test("ignores other tools", () => {
    expect(SessionTodo.planFromToolCall("acp_execute", { command: "ls", title: "ls" })).toBeUndefined()
    expect(SessionTodo.planFromToolCall("acp_other", { questions: [], title: "question" })).toBeUndefined()
  })
})
