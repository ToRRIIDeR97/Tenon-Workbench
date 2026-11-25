import { describe, expect, test } from "bun:test"
import { SessionTodo } from "@tenon/core/session/todo"

describe("verify SessionTodo.planFromToolCall", () => {
  test("a call titled todowrite without a todo list is not a plan", () => {
    expect(SessionTodo.planFromToolCall("acp_other", { title: "todowrite" })).toBeUndefined()
  })

  test("a todo list under another title is not taken for a plan", () => {
    expect(
      SessionTodo.planFromToolCall("acp_other", { title: "notes", todos: [{ content: "x", status: "pending" }] }),
    ).toBeUndefined()
  })

  test("an emptied plan clears the list", () => {
    expect(SessionTodo.planFromToolCall("acp_other", { title: "todowrite", todos: [] })).toEqual([])
  })
})
