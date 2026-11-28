import { describe, expect, test } from "bun:test"
import { threadFindMatches, threadFindTurns } from "./thread-find"

describe("AC-2 thread find (verification)", () => {
  test("an assistant message whose parent is missing is not attached to another turn", () => {
    const turns = threadFindTurns(
      [
        { id: "u1", role: "user" },
        { id: "a9", role: "assistant", parentID: "gone" },
      ],
      { u1: [{ type: "text", text: "hello" }], a9: [{ type: "text", text: "hello orphan" }] },
    )
    expect(turns).toEqual([{ turnID: "u1", texts: ["hello"] }])
  })

  test("a turn without parts loaded is kept with no texts and has no matches", () => {
    const turns = threadFindTurns([{ id: "u1", role: "user" }], {})
    expect(turns).toEqual([{ turnID: "u1", texts: [] }])
    expect(threadFindMatches(turns, "x")).toEqual([])
  })

  test("ignored parts are skipped and occurrences count across a turn's texts", () => {
    const turns = threadFindTurns(
      [
        { id: "u1", role: "user" },
        { id: "a1", role: "assistant", parentID: "u1" },
      ],
      {
        u1: [
          { type: "text", text: "Deploy" },
          { type: "text", text: "deploy ignored", ignored: true },
        ],
        a1: [{ type: "text", text: "deploy deploy" }],
      },
    )
    expect(threadFindMatches(turns, "DEPLOY")).toEqual([
      { turnID: "u1", occurrence: 0 },
      { turnID: "u1", occurrence: 1 },
      { turnID: "u1", occurrence: 2 },
    ])
  })
})
