import { describe, expect, test } from "bun:test"
import { heaviestContextItems } from "./context-heaviest"

const thread = () => {
  const messages = [
    { id: "u1", role: "user" },
    { id: "a1", role: "assistant" },
    { id: "u2", role: "user" },
    { id: "a2", role: "assistant" },
  ]
  const parts = {
    u1: [{ id: "u1t", type: "text", text: "Check the build\nand the tests".padEnd(400, ".") }],
    a1: [
      { id: "a1t", type: "text", text: "Looking now".padEnd(80, ".") },
      {
        id: "a1x",
        type: "tool",
        tool: "bash",
        state: { status: "completed", input: { command: "bun test" }, output: "x".repeat(4000), title: "Ran bun test" },
      },
    ],
    u2: [{ id: "u2t", type: "text", text: "Next" }],
    a2: [
      {
        id: "a2x",
        type: "tool",
        tool: "task",
        state: {
          status: "completed",
          input: { description: "PR-3" },
          output: "y".repeat(1200),
          title: "PR-3 implementor",
        },
      },
    ],
  }
  return { messages: messages as never, parts: parts as never }
}

describe("heaviestContextItems", () => {
  test("ranks the biggest items first with their turn", () => {
    const items = heaviestContextItems({ ...thread(), limit: 3 })
    expect(items.map((item) => [item.name, item.kind, item.turn, item.turnID])).toEqual([
      ["Ran bun test", "tool", 1, "u1"],
      ["PR-3 implementor", "subagent", 2, "u2"],
      ["Check the build", "message", 1, "u1"],
    ])
    // 4000 output chars plus one input key (16) at four characters a token.
    expect(items[0]!.tokens).toBe(1004)
  })

  test("keeps to the limit and skips what came before the first message", () => {
    expect(heaviestContextItems({ ...thread() }).length).toBe(4)
    const lone = heaviestContextItems({
      messages: [{ id: "a0", role: "assistant" }] as never,
      parts: { a0: [{ id: "a0t", type: "text", text: "orphan" }] } as never,
    })
    expect(lone).toEqual([])
  })
})
